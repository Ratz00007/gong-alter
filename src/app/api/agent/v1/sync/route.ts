// VALENCE Agent API v1 — Integrations Synchronization
import { NextRequest, NextResponse } from 'next/server'
import { syncIntegration } from '@/lib/integrations/manager'
import { z } from 'zod'

const syncSchema = z.object({
  type: z.enum(['GMAIL', 'OUTLOOK', 'IMAP', 'HUBSPOT', 'SALESFORCE', 'PIPEDRIVE', 'WEBHOOK']),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = syncSchema.parse(body)

    const result = await syncIntegration(parsed.type)
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'SYNC_ERROR', message: e instanceof Error ? e.message : 'Sync failed' } },
      { status: 400 },
    )
  }
}
