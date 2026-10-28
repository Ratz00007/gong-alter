import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'
import { getRubric } from '@/lib/score/rubric'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const scorecard = await db.scorecard.findUnique({ where: { callId: id } })
  if (!scorecard) return notFound('Scorecard')
  const rubric = await getRubric()
  // FR-017: comparison against own top quartile
  const top = await db.scorecard.findMany({
    where: { call: { status: { in: ['READY', 'REVIEWED'] } } },
    orderBy: { overall: 'desc' },
  })
  const quartileSize = Math.max(1, Math.ceil(top.length * 0.25))
  const topQuartile = top.slice(0, quartileSize)
  const dims = (scorecard.dimensions as { dims?: { key: string; score: number; evidenceSegmentIds: string[]; comment: string }[] })?.dims ?? []
  const quartileMeans: Record<string, number> = {}
  for (const d of dims) {
    const scores = topQuartile
      .map((sc) => ((sc.dimensions as { dims?: { key: string; score: number }[] })?.dims ?? []).find((x) => x.key === d.key)?.score)
      .filter((v): v is number => typeof v === 'number')
    quartileMeans[d.key] = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null as unknown as number
  }
  return ok({ scorecard, rubric, topQuartileMeans: quartileMeans, topQuartileSize: topQuartile.length })
})
