// VALENCE — real mailbox ingestion for Gmail (Gmail API) and Outlook (Microsoft
// Graph) using OAuth access tokens from lib/integrations/oauth. Mappers are pure
// and unit-tested; fetchers are thin network wrappers. Messages are ingested with
// the same sentiment/deal-linking engine the rest of the pipeline uses.
import type { IngestedEmail, SyncConnectionResult } from '../types'
import { ingestEmailMessage } from './engine'
import { ensureAccessToken, fetchAccountEmail, type OAuthProvider } from '../oauth'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'

export interface GmailMessageShape {
  id: string
  internalDate?: string
  snippet?: string
  payload?: { headers?: { name: string; value: string }[] }
}

export interface GraphMessageShape {
  id: string
  internetMessageId?: string
  subject?: string
  bodyPreview?: string
  receivedDateTime?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  toRecipients?: { emailAddress?: { address?: string } }[]
}

function headerOf(msg: GmailMessageShape, name: string): string {
  const headers = msg.payload?.headers ?? []
  const hit = headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return (hit?.value ?? '').trim()
}

export function mapGmailMessage(msg: GmailMessageShape, accountEmail: string): IngestedEmail {
  const from = headerOf(msg, 'from')
  const to = headerOf(msg, 'to')
  return {
    externalId: `gmail:${msg.id}`,
    from: from || '(unknown sender)',
    to: to || accountEmail,
    subject: headerOf(msg, 'subject') || '(no subject)',
    bodyText: msg.snippet ?? '',
    sentAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
    direction: from.toLowerCase().includes(accountEmail.toLowerCase()) ? 'OUTBOUND' : 'INBOUND',
  }
}

export function mapGraphMessage(msg: GraphMessageShape, accountEmail: string): IngestedEmail {
  const from = msg.from?.emailAddress?.address ?? ''
  const to = (msg.toRecipients ?? []).map((r) => r.emailAddress?.address ?? '').filter(Boolean).join(', ')
  return {
    externalId: msg.internetMessageId || `graph:${msg.id}`,
    from: from || msg.from?.emailAddress?.name || '(unknown sender)',
    to: to || accountEmail,
    subject: msg.subject ?? '(no subject)',
    bodyText: msg.bodyPreview ?? '',
    sentAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    direction: from.toLowerCase() === accountEmail.toLowerCase() ? 'OUTBOUND' : 'INBOUND',
  }
}

async function fetchGmailMessages(accessToken: string, accountEmail: string): Promise<IngestedEmail[]> {
  const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25', {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`)
  const list = (await listRes.json()) as { messages?: { id: string }[] }
  const ids = (list.messages ?? []).map((m) => m.id)
  const out: IngestedEmail[] = []
  for (const id of ids) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) continue // one bad message must not sink the sync
    out.push(mapGmailMessage((await res.json()) as GmailMessageShape, accountEmail))
  }
  return out
}

async function fetchGraphMessages(accessToken: string, accountEmail: string): Promise<IngestedEmail[]> {
  const url =
    'https://graph.microsoft.com/v1.0/me/messages?$top=25&$orderby=receivedDateTime%20desc&$select=subject,from,toRecipients,bodyPreview,receivedDateTime,internetMessageId'
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Outlook list failed (${res.status})`)
  const data = (await res.json()) as { value?: GraphMessageShape[] }
  return (data.value ?? []).map((m) => mapGraphMessage(m, accountEmail))
}

/** Live connection probe: identity call, exactly what the UI badge claims. */
export async function probeLiveEmail(provider: OAuthProvider) {
  const start = Date.now()
  try {
    const { accessToken, accountEmail } = await ensureAccessToken(provider)
    const verified = await fetchAccountEmail(provider, accessToken)
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: `${provider} verified via browser sign-in as ${verified || accountEmail}`,
      details: { account: verified || accountEmail, mode: 'OAUTH' },
    }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: `${provider} check failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/** Real mailbox pull: fetch recent messages, dedupe, ingest, audit. */
export async function liveEmailSync(provider: OAuthProvider, connectionId: string): Promise<SyncConnectionResult> {
  const start = Date.now()
  const db = getDb()
  const { accessToken, accountEmail } = await ensureAccessToken(provider)
  const fetched = provider === 'GMAIL' ? await fetchGmailMessages(accessToken, accountEmail) : await fetchGraphMessages(accessToken, accountEmail)

  let count = 0
  for (const email of fetched) {
    const existing = await db.emailMessage.findFirst({ where: { externalId: email.externalId } })
    if (existing) continue
    await ingestEmailMessage(email, connectionId)
    count++
  }

  const durationMs = Date.now() - start
  await db.integrationSyncLog.create({
    data: {
      connectionId,
      status: 'OK',
      action: 'PULL',
      itemsCount: count,
      message: `Fetched ${count} new email messages from ${provider} (${accountEmail}).`,
      detailsJson: { durationMs, provider, fetched: fetched.length, account: accountEmail },
    },
  })
  await db.integrationConnection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date(), status: 'CONNECTED', lastError: null, itemsSynced: { increment: count } },
  })
  logger.info(`Live email sync completed: ${provider}`, { connectionId, account: accountEmail, ingested: count })
  return {
    ok: true,
    connectionId,
    type: provider,
    itemsSynced: count,
    durationMs,
    message: `Synced ${count} new email messages from ${accountEmail}`,
    details: { fetched: fetched.length, account: accountEmail },
  }
}
