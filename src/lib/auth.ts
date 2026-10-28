// AMBER — single-user session auth (T4): passphrase from .env, HMAC-signed cookie, 12h TTL.
import { createHash, createHmac, timingSafeEqual, scryptSync, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { config, sessionSecret } from './config'

export const SESSION_COOKIE = 'amber_session'

interface SessionPayload {
  sid: string
  exp: number // epoch ms
}

// Sliding-window login rate limiter (max 10 failed attempts per minute)
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_FAILURES = 10
const failedLoginTimestamps: number[] = []

function pruneFailures(now: number): void {
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  while (failedLoginTimestamps.length > 0 && failedLoginTimestamps[0] <= cutoff) {
    failedLoginTimestamps.shift()
  }
}

export function isLoginRateLimited(now = Date.now()): boolean {
  pruneFailures(now)
  return failedLoginTimestamps.length >= RATE_LIMIT_MAX_FAILURES
}

export function resetLoginRateLimit(): void {
  failedLoginTimestamps.length = 0
}

export const resetRateLimiter = resetLoginRateLimit

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url')
}

function sign(data: string): string {
  return createHmac('sha256', sessionSecret()).update(data).digest('base64url')
}

export function createSessionToken(): { token: string; maxAgeSec: number } {
  const payload: SessionPayload = {
    sid: randomUUID(),
    exp: Date.now() + config.session.ttlHours * 3600_000,
  }
  const body = b64url(JSON.stringify(payload))
  return { token: `${body}.${sign(body)}`, maxAgeSec: config.session.ttlHours * 3600 }
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null
  const idx = token.lastIndexOf('.')
  if (idx < 1) return null
  const body = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  const expected = sign(body)
  try {
    const sigBuf = Buffer.from(sig)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** Verifies the passphrase against .env (hash preferred; constant-time SHA-256 fallback for demo installs). */
export function verifyPassphrase(input: string): boolean {
  const now = Date.now()
  if (isLoginRateLimited(now)) {
    return false
  }
  const hash = process.env.SESSION_PASSPHRASE_HASH || config.session.passphraseHash
  const plain = process.env.SESSION_PASSPHRASE || config.session.passphrase
  let matched = false
  if (hash) {
    const [saltB64, keyB64] = hash.split('.')
    if (saltB64 && keyB64) {
      const derived = scryptSync(input, Buffer.from(saltB64, 'base64'), 32)
      const expected = Buffer.from(keyB64, 'base64')
      matched = derived.length === expected.length && timingSafeEqual(derived, expected)
    }
  } else if (plain) {
    const inputDigest = createHash('sha256').update(input).digest()
    const plainDigest = createHash('sha256').update(plain).digest()
    matched = timingSafeEqual(inputDigest, plainDigest)
  }
  if (!matched) {
    failedLoginTimestamps.push(now)
  }
  return matched
}

export function sessionFrom(req: NextRequest): SessionPayload | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}

/** Verifies Coding Agent API Key (Bearer token or x-valence-key). */
export function verifyAgentApiKey(req: NextRequest | Headers): boolean {
  const headers = req instanceof NextRequest ? req.headers : req
  const authHeader = headers.get('authorization') ?? ''
  const valenceKeyHeader = headers.get('x-valence-key') ?? ''

  let providedKey = ''
  if (authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim()
  } else if (valenceKeyHeader) {
    providedKey = valenceKeyHeader.trim()
  }

  if (!providedKey) return false

  const configuredKey = process.env.VALENCE_AGENT_KEY || 'valence_agent_master_key_sov2026'
  const keyHash = createHash('sha256').update(providedKey).digest()
  const expHash = createHash('sha256').update(configuredKey).digest()
  return timingSafeEqual(keyHash, expHash)
}


export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: (process.env.NODE_ENV || config.env) === 'production',
    path: '/',
  }
}
