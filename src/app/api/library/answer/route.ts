import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, fail } from '@/lib/http'
import { semanticSearch } from '@/lib/search/embed'
import { runTask } from '@/lib/tasks/engine'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const Body = z.object({ q: z.string().min(2).max(500) })

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Provide {q}')

  const minScoreRow = await db.setting.findUnique({ where: { key: 'search.minScore' } })
  const minScore = typeof minScoreRow?.value === 'number' ? minScoreRow.value : 0.24

  const result = await semanticSearch(parsed.data.q, {}, { minScore, limit: 8 })
  const usable = result.hits.filter((h) => h.score >= minScore)

  // T11 refusal rule: refuses when the top score is below the floor
  if (usable.length === 0) {
    return ok({ refused: true, answer: "I can't find that in your library.", citations: [], minScore, degraded: result.degraded })
  }

  const { data } = await runTask('T11', {
    ctx: {
      question: parsed.data.q,
      minScore,
      hits: usable.map((h) => ({ id: h.id, score: h.score, source: h.source, text: h.snippet })),
    },
  })
  const t = data as { answer: string; citations: { hitId: string; quote: string }[] }
  return ok({ refused: false, answer: t.answer, citations: t.citations, hits: usable, minScore, degraded: result.degraded })
})
