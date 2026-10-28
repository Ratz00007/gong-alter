import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, fail } from '@/lib/http'
import { semanticSearch } from '@/lib/search/embed'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const Body = z.object({
  q: z.string().max(500),
  filters: z
    .object({
      dealId: z.string().optional(),
      contactId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      speaker: z.enum(['REP', 'PROSPECT', 'UNKNOWN']).optional(),
    })
    .optional(),
  group: z.string().optional(),
})

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid search body', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const { q, filters, group } = parsed.data
  if (!q.trim()) {
    // empty query shows recent calls (Ch. 3 Library spec)
    const recent = await db.call.findMany({
      where: { status: { in: ['READY', 'REVIEWED'] } },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      select: { id: true, title: true, occurredAt: true, deal: { select: { title: true } } },
    })
    return ok({ mode: 'recent', hits: [], recentCalls: recent })
  }

  const minScoreRow = await db.setting.findUnique({ where: { key: 'search.minScore' } })
  const minScore = typeof minScoreRow?.value === 'number' ? minScoreRow.value : 0.24

  const result = await semanticSearch(q, filters ?? {}, { minScore, limit: 60 })
  let grouped: { callId: string | null; top: (typeof result.hits)[number] | undefined; count: number }[] | undefined
  if (group === 'call') {
    const map = new Map<string, { callId: string | null; top: (typeof result.hits)[number]; count: number }>()
    for (const h of result.hits) {
      const key = h.callId ?? 'none'
      const existing = map.get(key)
      if (existing) existing.count++
      else map.set(key, { callId: h.callId, top: h, count: 1 })
    }
    grouped = [...map.values()].sort((a, b) => (b.top?.score ?? 0) - (a.top?.score ?? 0))
  }

  return ok({ mode: 'search', q, degraded: result.degraded, model: result.model, minScore, hits: result.hits, grouped })
})
