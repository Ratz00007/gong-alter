// VALENCE Agent API v1 — Ingested Email Feed
import { NextRequest, NextResponse } from 'next/server'
import { getEmailFeed } from '@/lib/integrations/manager'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dealId = searchParams.get('dealId') ?? undefined
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 100)

  const emails = await getEmailFeed(dealId, limit)

  return NextResponse.json({
    total: emails.length,
    emails: emails.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      subject: e.subject,
      bodyText: e.bodyText,
      sentAt: e.sentAt,
      direction: e.direction,
      sentiment: e.sentiment,
      intent: e.intent,
      deal: e.deal,
      insights: e.insightsJson,
    })),
  })
}
