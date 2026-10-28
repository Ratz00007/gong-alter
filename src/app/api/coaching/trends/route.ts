import { NextRequest } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const url = new URL(req.url)
  const windowDays = Math.min(365, Math.max(7, Number(url.searchParams.get('window') ?? 90) || 90))
  const dimension = url.searchParams.get('dimension') ?? null
  const since = new Date(Date.now() - windowDays * 86_400_000)

  const rows = await db.scorecard.findMany({
    where: { call: { occurredAt: { gte: since }, status: { in: ['READY', 'REVIEWED', 'ARCHIVED'] } } },
    include: { call: { select: { id: true, title: true, occurredAt: true, deal: { select: { id: true, title: true } } } } },
    orderBy: { createdAt: 'asc' },
  })

  const series = rows.map((sc) => {
    const dims = (sc.dimensions as { dims?: { key: string; score: number }[] })?.dims ?? []
    return {
      callId: sc.callId,
      callTitle: sc.call.title,
      deal: sc.call.deal?.title ?? null,
      occurredAt: sc.call.occurredAt.toISOString(),
      overall: sc.overall,
      dimensions: Object.fromEntries(dims.map((d) => [d.key, d.score])),
      talkRatioRep: sc.talkRatioRep,
      questionCount: sc.questionCount,
      longestMonologueSec: sc.longestMonologueSec,
    }
  })

  // rolling mean over the last 5 calls
  const rolling: (number | null)[] = series.map((_, i) => {
    const window = series.slice(Math.max(0, i - 4), i + 1)
    return Math.round(window.reduce((a, b) => a + b.overall, 0) / window.length)
  })

  // FR-017: own top quartile means per dimension
  const sorted = [...series].sort((a, b) => b.overall - a.overall)
  const q = Math.max(1, Math.ceil(sorted.length * 0.25))
  const top = sorted.slice(0, q)
  const dimKeys = ['discovery', 'value', 'objections', 'next_step', 'talk_balance', 'rapport']
  const topQuartileMeans = Object.fromEntries(
    dimKeys.map((k) => [k, top.length ? Math.round((top.reduce((a, b) => a + (b.dimensions[k] ?? 0), 0) / top.length) * 10) / 10 : 0]),
  )

  return ok({
    windowDays,
    dimension,
    count: series.length,
    calibration: series.length < 3, // FR-015: empty state renders a calibration prompt, not a chart
    calibrationNote: series.length < 3 ? 'Trends need at least 3 analyzed calls before they mean anything.' : null,
    series,
    rolling,
    topQuartileMeans,
  })
})
