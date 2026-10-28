// VALENCE — real browser OAuth (Authorization Code + PKCE) for Gmail and Outlook.
// Public-client desktop flow by construction: the authorization page opens in the
// SYSTEM BROWSER and the code returns to a temporary loopback listener (Google
// requires 127.0.0.1/[::1]; Microsoft registers http://localhost for desktop).
// Tokens are sealed with AES-256-GCM before they touch the database; plaintext
// tokens never appear in logs, API responses, or listIntegrations().
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { getDb } from '@/lib/db'
import { sessionSecret } from '@/lib/config'
import { logger } from '@/lib/logger'
import { HttpError } from '@/lib/http'

export type OAuthProvider = 'GMAIL' | 'OUTLOOK'

export interface SealedTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number // epoch ms
  scope: string
}

export type OAuthOutcome =
  | { ok: true; accountEmail: string; connectionId: string }
  | { ok: false; error: string }

// ---------- PKCE + sealing (pure, unit-tested) ----------

export function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function sealKey(): Buffer {
  return createHash('sha256')
    .update(Buffer.concat([sessionSecret(), Buffer.from('valence-integration-oauth-v1')]))
    .digest()
}

export function sealTokens(tokens: SealedTokens): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sealKey(), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()])
  return ['v1', base64url(iv), base64url(cipher.getAuthTag()), base64url(data)].join('.')
}

/** Throws on tampered/foreign seals — a corrupt blob must never decrypt to garbage. */
export function openTokens(sealed: string): SealedTokens {
  const [version, ivB, tagB, dataB] = sealed.split('.')
  if (version !== 'v1' || !ivB || !tagB || !dataB) throw new Error('unsupported token seal')
  const decipher = createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(ivB, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
  const data = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()])
  return JSON.parse(data.toString('utf8')) as SealedTokens
}

// ---------- provider definitions ----------

const SCOPES: Record<OAuthProvider, string> = {
  // Narrowest useful set: read mail for ingestion + account identity. No send scope.
  GMAIL: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
  OUTLOOK: 'openid email profile offline_access Mail.Read',
}

const LABELS: Record<OAuthProvider, string> = {
  GMAIL: 'Google / Gmail',
  OUTLOOK: 'Microsoft Outlook',
}

function envOrSetting(envKey: string, settingKey: string): Promise<string> {
  return getDb()
    .setting.findUnique({ where: { key: settingKey } })
    .then((row) => {
      const fromSetting = typeof row?.value === 'string' ? row.value.trim() : ''
      return (process.env[envKey] || fromSetting || '').trim()
    })
}

export function oauthClientId(provider: OAuthProvider): Promise<string> {
  return provider === 'GMAIL'
    ? envOrSetting('GMAIL_CLIENT_ID', 'integrations.gmailClientId')
    : envOrSetting('OUTLOOK_CLIENT_ID', 'integrations.outlookClientId')
}

function oauthClientSecret(provider: OAuthProvider): Promise<string> {
  return provider === 'GMAIL'
    ? envOrSetting('GMAIL_CLIENT_SECRET', 'integrations.gmailClientSecret')
    : Promise.resolve('')
}

export function outlookTenant(): Promise<string> {
  return envOrSetting('OUTLOOK_TENANT_ID', 'integrations.outlookTenantId').then((t) => t || 'common')
}

export function buildAuthUrl(opts: {
  provider: OAuthProvider
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  tenant?: string
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: SCOPES[opts.provider],
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
  })
  if (opts.provider === 'GMAIL') {
    params.set('access_type', 'offline') // obtain a refresh token
    params.set('prompt', 'consent') // re-prompt so a refresh token is always issued
    params.set('include_granted_scopes', 'true')
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }
  params.set('response_mode', 'query')
  params.set('prompt', 'select_account')
  return `https://login.microsoftonline.com/${opts.tenant ?? 'common'}/oauth2/v2.0/authorize?${params.toString()}`
}

async function tokenEndpoint(provider: OAuthProvider): Promise<string> {
  return provider === 'GMAIL'
    ? 'https://oauth2.googleapis.com/token'
    : `https://login.microsoftonline.com/${await outlookTenant()}/oauth2/v2.0/token`
}

async function exchangeCode(
  provider: OAuthProvider,
  input: { code: string; verifier: string; redirectUri: string; clientId: string },
): Promise<SealedTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
  })
  const secret = await oauthClientSecret(provider)
  if (secret) body.set('client_secret', secret) // optional for public clients
  const res = await fetch(await tokenEndpoint(provider), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? SCOPES[provider],
  }
}

async function refreshTokens(provider: OAuthProvider, refreshToken: string, clientId: string): Promise<SealedTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const secret = await oauthClientSecret(provider)
  if (secret) body.set('client_secret', secret)
  const res = await fetch(await tokenEndpoint(provider), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`token refresh failed (${res.status})`)
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? SCOPES[provider],
  }
}

/** Real identity probe against the provider — this is what "verified" means. */
export async function fetchAccountEmail(provider: OAuthProvider, accessToken: string): Promise<string> {
  const res =
    provider === 'GMAIL'
      ? await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        })
      : await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        })
  if (!res.ok) throw new Error(`identity probe failed (${res.status})`)
  const data = (await res.json()) as { emailAddress?: string; mail?: string; userPrincipalName?: string }
  const account = (data.emailAddress ?? data.mail ?? data.userPrincipalName ?? '').trim()
  if (!account) throw new Error('provider returned no account identity')
  return account
}

/** Access token for live API calls; transparently refreshes and re-seals on expiry. */
export async function ensureAccessToken(provider: OAuthProvider): Promise<{ accessToken: string; accountEmail: string }> {
  const db = getDb()
  const conn = await db.integrationConnection.findFirst({ where: { type: provider } })
  const cfg = (conn?.configJson ?? {}) as Record<string, unknown>
  if (!conn || cfg.authMode !== 'oauth' || typeof cfg.sealedTokens !== 'string') {
    throw new HttpError('VALIDATION_ERROR', `${LABELS[provider]} is not connected via browser sign-in`)
  }
  let tokens = openTokens(cfg.sealedTokens)
  if (tokens.expiresAt - Date.now() < 60_000 && tokens.refreshToken) {
    const clientId = await oauthClientId(provider)
    tokens = await refreshTokens(provider, tokens.refreshToken, clientId)
    await db.integrationConnection.update({
      where: { id: conn.id },
      data: { configJson: { ...cfg, sealedTokens: sealTokens(tokens) } },
    })
  }
  return { accessToken: tokens.accessToken, accountEmail: conn.accountEmail ?? '' }
}

// ---------- loopback authorization flow ----------

interface Pending {
  requestId: string
  provider: OAuthProvider
  state: string
  verifier: string
  redirectUri: string
  clientId: string
  server: Server
  settled: boolean
  result?: OAuthOutcome
  promise: Promise<OAuthOutcome>
  resolve: (r: OAuthOutcome) => void
}

const g = globalThis as unknown as { __valenceOAuth?: Map<string, Pending> }
function pending(): Map<string, Pending> {
  return (g.__valenceOAuth ??= new Map())
}

const FLOW_TTL_MS = 5 * 60_000

function finish(entry: Pending, outcome: OAuthOutcome): void {
  if (entry.settled) return
  entry.settled = true
  entry.result = outcome
  entry.resolve(outcome)
  try {
    entry.server.close()
  } catch {}
  // Keep the result visible for late pollers, then drop it.
  setTimeout(() => pending().delete(entry.requestId), FLOW_TTL_MS).unref?.()
}

function respondPage(res: ServerResponse, title: string, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:2rem"><h2>${title}</h2><p>${body}</p><script>window.close()</script></body>`)
}

async function handleCallback(entry: Pending, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  try {
    if (error) throw new Error(`authorization denied (${error})`)
    if (!code || state !== entry.state) throw new Error('state mismatch — callback rejected')
    const tokens = await exchangeCode(entry.provider, {
      code,
      verifier: entry.verifier,
      redirectUri: entry.redirectUri,
      clientId: entry.clientId,
    })
    const accountEmail = await fetchAccountEmail(entry.provider, tokens.accessToken)
    const db = getDb()
    const configJson = { authMode: 'oauth', sealedTokens: sealTokens(tokens), scope: tokens.scope }
    const existing = await db.integrationConnection.findFirst({ where: { type: entry.provider } })
    const record = existing
      ? await db.integrationConnection.update({
          where: { id: existing.id },
          data: { accountEmail, status: 'CONNECTED', configJson: configJson as object, lastError: null },
        })
      : await db.integrationConnection.create({
          data: {
            type: entry.provider,
            name: LABELS[entry.provider],
            accountEmail,
            status: 'CONNECTED',
            configJson: configJson as object,
          },
        })
    logger.info(`Integration connected via browser OAuth: ${entry.provider}`, { id: record.id, account: accountEmail })
    finish(entry, { ok: true, accountEmail, connectionId: record.id })
    respondPage(res, 'Connected to VALENCE', `${LABELS[entry.provider]} (<b>${accountEmail}</b>) is verified and connected. You can close this tab and return to VALENCE.`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.warn(`OAuth callback failed: ${entry.provider}`, { error: message })
    finish(entry, { ok: false, error: message })
    respondPage(res, 'Sign-in failed', message)
  }
}

export async function beginOAuth(provider: OAuthProvider): Promise<{ requestId: string; authUrl: string }> {
  const clientId = await oauthClientId(provider)
  if (!clientId) {
    throw new HttpError(
      'VALIDATION_ERROR',
      `${LABELS[provider]} OAuth client ID is not configured. Create an OAuth client (docs/INTEGRATIONS_OAUTH.md) and save it in the connect dialog.`,
    )
  }
  const { verifier, challenge } = pkcePair()
  const state = base64url(randomBytes(24))
  const requestId = base64url(randomBytes(18))

  let entry: Pending
  const server = createServer((req, res) => void handleCallback(entry, req, res))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as { port: number }).port
  const redirectUri = `http://${provider === 'GMAIL' ? '127.0.0.1' : 'localhost'}:${port}/`
  const tenant = provider === 'OUTLOOK' ? await outlookTenant() : undefined
  const authUrl = buildAuthUrl({ provider, clientId, redirectUri, state, challenge, tenant })

  entry = {
    requestId,
    provider,
    state,
    verifier,
    redirectUri,
    clientId,
    server,
    settled: false,
    resolve: () => {},
    promise: Promise.resolve({ ok: false, error: 'pending' }),
  }
  entry.promise = new Promise<OAuthOutcome>((resolve) => {
    entry.resolve = resolve
  })
  entry.promise.catch(() => {}) // polled consumers handle outcomes; no unhandled rejection
  pending().set(requestId, entry)
  setTimeout(() => {
    if (!entry.settled) {
      finish(entry, { ok: false, error: 'authorization timed out after 5 minutes' })
    }
  }, FLOW_TTL_MS).unref?.()

  logger.info(`OAuth authorization opened for ${provider}`, { redirectHost: redirectUri.split('/')[2] })
  return { requestId, authUrl }
}

export async function awaitOAuth(
  requestId: string,
  waitMs = 8000,
): Promise<{ status: 'pending' } | { status: 'connected'; accountEmail: string } | { status: 'failed'; error: string }> {
  const entry = pending().get(requestId)
  if (!entry) return { status: 'failed', error: 'Unknown or expired authorization request' }
  if (!entry.settled) {
    await Promise.race([entry.promise.catch(() => {}), new Promise((r) => setTimeout(r, waitMs))])
  }
  if (!entry.settled) return { status: 'pending' }
  return entry.result!.ok
    ? { status: 'connected', accountEmail: entry.result!.accountEmail }
    : { status: 'failed', error: entry.result!.error }
}
