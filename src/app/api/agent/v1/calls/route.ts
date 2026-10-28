// VALENCE Agent API v1 — Calls List
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const dealId = searchParams.get('dealId')
  const status = searchParams.get('status')
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 100)

  const where: Record<string, unknown> = {}
  if (dealId) where.dealId = dealId
  if (status) where.status = status

  const calls = await db.call.findMany({
    where,
    take: limit,
    orderBy: { occurredAt: 'desc' },
    include: {
      deal: { select: { id: true, title: true, account: true, healthScore: true } },
      contact: { select: { id: true, name: true, title: true } },
      summary: true,
      scorecard: true,
      _count: { select: { insights: true } },
    },
  })

  return NextResponse.json({
    total: calls.length,
    calls: calls.map((c) => ({
      id: c.id,
      title: c.title,
      deal: c.deal,
      contact: c.contact,
      occurredAt: c.occurredAt,
      durationSec: c.durationSec,
      status: c.status,
      source: c.source,
      overallScore: c.scorecard?.overall ?? null,
      talkRatioRep: c.scorecard?.talkRatioRep ?? null,
      summary: c.summary?.summary ?? null,
      insightCount: c._count.insights,
    })),
  })
}
