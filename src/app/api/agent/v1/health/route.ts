// VALENCE Agent API v1 — Health & System Status
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { listIntegrations } from '@/lib/integrations/manager'
import { config } from '@/lib/config'

export async function GET() {
  const db = getDb()
  const [dealCount, callCount, queueDepth, integrations] = await Promise.all([
    db.deal.count(),
    db.call.count(),
    db.job.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
    listIntegrations(),
  ])

  return NextResponse.json({
    status: 'ok',
    version: '1.0.0',
    app: 'VALENCE Sovereign Revenue Intelligence',
    routingMode: config.routingMode,
    stats: {
      deals: dealCount,
      calls: callCount,
      queueDepth,
      connectedIntegrations: integrations.filter((i) => i.status === 'CONNECTED').length,
    },
    integrations: integrations.map((i) => ({
      type: i.type,
      name: i.name,
      status: i.status,
      lastSyncAt: i.lastSyncAt,
      itemsSynced: i.itemsSynced,
    })),
  })
}
