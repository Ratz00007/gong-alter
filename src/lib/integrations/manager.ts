// VALENCE — Master Integration Manager (Email, CRM, Agent Bridges)
import { getDb } from '@/lib/db'
import type { IntegrationType, IntegrationStatus } from '@prisma/client'
import type { TestConnectionResult, SyncConnectionResult } from './types'
import { probeLiveEmail, liveEmailSync } from './email/live'
import { logger } from '@/lib/logger'

export interface ConnectionSummary {
  id: string
  type: IntegrationType
  name: string
  accountEmail: string | null
  status: IntegrationStatus
  lastSyncAt: Date | null
  lastError: string | null
  autoSync: boolean
  syncIntervalMin: number
  itemsSynced: number
  config: Record<string, unknown>
}

/**
 * Returns all configured integrations, backfilling standard defaults if empty.
 */
export async function listIntegrations(): Promise<ConnectionSummary[]> {
  const db = getDb()
  const rows = await db.integrationConnection.findMany({
    orderBy: { createdAt: 'asc' },
  })

  return rows.map((r) => {
    const cfg = (r.configJson ?? {}) as Record<string, unknown>
    // Only a sealed OAuth session counts as verified; legacy rows were never
    // authenticated by a real connector and must not claim CONNECTED.
    const verified = cfg.authMode === 'oauth' && typeof cfg.sealedTokens === 'string'
    return {
    id: r.id,
    type: r.type,
    name: r.name,
    accountEmail: r.accountEmail,
    status: r.status === 'DISCONNECTED' ? 'DISCONNECTED' : verified ? 'CONNECTED' : 'ERROR',
    lastSyncAt: r.lastSyncAt,
    lastError: r.lastError,
    autoSync: r.autoSync,
    syncIntervalMin: r.syncIntervalMin,
    itemsSynced: r.itemsSynced,
    config: { authMode: cfg.authMode ?? 'unknown' },
    }
  })
}

/**
 * Connects or updates an integration with non-technical friendly configuration.
 */
export async function connectIntegration(params: {
  type: IntegrationType
  name?: string
  accountEmail?: string
  config: Record<string, unknown>
}): Promise<ConnectionSummary> {
  throw new Error(`Real ${params.type} authentication is not implemented. No credentials were saved or verified.`)
}

/**
 * Disconnects an integration.
 */
export async function disconnectIntegration(typeOrId: string): Promise<boolean> {
  const db = getDb()
  const conn = await db.integrationConnection.findFirst({
    where: {
      OR: [{ id: typeOrId }, { type: typeOrId as IntegrationType }],
    },
  })

  if (!conn) return false

  await db.integrationConnection.update({
    where: { id: conn.id },
    data: { status: 'DISCONNECTED', configJson: {}, lastError: null },
  })

  logger.info(`Integration disconnected: ${conn.type}`, { id: conn.id })
  return true
}

/**
 * Tests connection to an integration.
 */
export async function testIntegration(typeOrId: string): Promise<TestConnectionResult> {
  const db = getDb()
  const conn = await db.integrationConnection.findFirst({
    where: {
      OR: [{ id: typeOrId }, { type: typeOrId as IntegrationType }],
    },
  })

  const type = (conn?.type ?? typeOrId) as IntegrationType
  const cfg = ((conn?.configJson ?? {}) as Record<string, unknown>)
  if ((type === 'GMAIL' || type === 'OUTLOOK') && cfg.authMode === 'oauth' && typeof cfg.sealedTokens === 'string') {
    return probeLiveEmail(type)
  }
  return { ok: false, latencyMs: 0, message: `${conn?.type ?? typeOrId}: no real provider connection has been verified.` }
}

/**
 * Triggers on-demand sync for an integration.
 */
export async function syncIntegration(typeOrId: string): Promise<SyncConnectionResult> {
  const db = getDb()
  const conn = await db.integrationConnection.findFirst({
    where: {
      OR: [{ id: typeOrId }, { type: typeOrId as IntegrationType }],
    },
  })

  if (!conn) {
    return { ok: false, connectionId: '', type: typeOrId as IntegrationType, itemsSynced: 0, durationMs: 0, message: 'No verified connection exists; real integrations are not implemented.' }
  }

  const cfg = (conn.configJson ?? {}) as Record<string, unknown>
  if ((conn.type === 'GMAIL' || conn.type === 'OUTLOOK') && cfg.authMode === 'oauth' && typeof cfg.sealedTokens === 'string') {
    return liveEmailSync(conn.type, conn.id)
  }
  return { ok: false, connectionId: conn.id, type: conn.type, itemsSynced: 0, durationMs: 0, message: 'Real synchronization is not implemented; previous connection statuses were not verified.' }
}

/**
 * Returns recent integration sync audit logs.
 */
export async function getRecentSyncLogs(limit = 20) {
  const db = getDb()
  return db.integrationSyncLog.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: { connection: { select: { id: true, name: true, type: true } } },
  })
}

/**
 * Returns recent ingested email messages, optionally filtered by deal.
 */
export async function getEmailFeed(dealId?: string, limit = 30) {
  const db = getDb()
  return db.emailMessage.findMany({
    where: dealId ? { dealId } : undefined,
    take: limit,
    orderBy: { sentAt: 'desc' },
    include: {
      deal: { select: { id: true, title: true, account: true, healthScore: true } },
    },
  })
}
