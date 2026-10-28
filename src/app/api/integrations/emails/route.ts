// VALENCE API — Email Messages Feed & Ingestion
import { NextRequest, NextResponse } from 'next/server'
import { sessionFrom } from '@/lib/auth'
import { getEmailFeed } from '@/lib/integrations/manager'
import { ingestEmailMessage } from '@/lib/integrations/email/engine'
import { z } from 'zod'

const ingestSchema = z.object({
  externalId: z.string().default(() => `manual-${Date.now()}`),
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string().min(1),
  bodyText: z.string().min(1),
  sentAt: z.string().optional().transform((v) => (v ? new Date(v) : new Date())),
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('INBOUND'),
})

export async function GET(req: NextRequest) {
  if (!sessionFrom(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dealId = searchParams.get('dealId') ?? undefined
  const limit = Math.min(Number(searchParams.get('limit') ?? '30'), 100)

  const items = await getEmailFeed(dealId, limit)
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  if (!sessionFrom(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })
  }

  try {
    const body = await req.json()
    const parsed = ingestSchema.parse(body)

    const res = await ingestEmailMessage(parsed)
    return NextResponse.json({ ok: true, result: res })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'INGEST_FAILED', message: e instanceof Error ? e.message : 'Ingestion failed' } },
      { status: 400 },
    )
  }
}
