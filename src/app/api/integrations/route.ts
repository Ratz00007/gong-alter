// VALENCE API — Integrations Management (GET list, POST connect)
import { NextRequest, NextResponse } from 'next/server'
import { sessionFrom } from '@/lib/auth'
import { listIntegrations, connectIntegration, getRecentSyncLogs } from '@/lib/integrations/manager'
import { z } from 'zod'

const connectSchema = z.object({
  type: z.enum(['GMAIL', 'OUTLOOK', 'IMAP', 'HUBSPOT', 'SALESFORCE', 'PIPEDRIVE', 'WEBHOOK']),
  name: z.string().optional(),
  accountEmail: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
})

export async function GET(req: NextRequest) {
  if (!sessionFrom(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })
  }

  const items = await listIntegrations()
  const recentLogs = await getRecentSyncLogs(10)

  return NextResponse.json({
    items,
    recentLogs,
    counts: {
      total: items.length,
      connected: items.filter((i) => i.status === 'CONNECTED').length,
      syncing: items.filter((i) => i.status === 'SYNCING').length,
    },
  })
}

export async function POST(req: NextRequest) {
  if (!sessionFrom(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })
  }

  try {
    const body = await req.json()
    const parsed = connectSchema.parse(body)

    const conn = await connectIntegration(parsed)
    return NextResponse.json({ ok: true, connection: conn })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'INVALID_CONFIG', message: e instanceof Error ? e.message : 'Invalid configuration' } },
      { status: 400 },
    )
  }
}
