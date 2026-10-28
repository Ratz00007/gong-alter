import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, collection, parseIntParam, requireSession, fail } from '@/lib/http'
import { getDb } from '@/lib/db'
import { logDealEvent, buildTimeline } from '@/lib/timeline/assemble'
import { recomputeDealHealth } from '@/lib/health/formula'

export const dynamic = 'force-dynamic'

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  account: z.string().min(1).max(200),
  stage: z.enum(['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED']).optional(),
  valueCents: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().length(3).optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  nextStep: z.string().max(300).nullable().optional(),
  nextStepDueAt: z.string().datetime().nullable().optional(),
})

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const url = new URL(req.url)
  const limit = parseIntParam(url.searchParams.get('limit'), 100)
  const stage = url.searchParams.get('stage')?.split(',').filter(Boolean)
  const q = url.searchParams.get('q')
  const archived = url.searchParams.get('archived') === '1'
  const sort = url.searchParams.get('sort') ?? 'health'

  const where: Record<string, unknown> = {}
  if (!archived) where.archivedAt = null
  if (stage?.length) where.stage = { in: stage }
  if (q) where.OR = [{ title: { contains: q } }, { account: { contains: q } }]

  const deals = await db.deal.findMany({
    where: where as never,
    orderBy: sort === 'activity' ? { lastActivityAt: 'desc' } : [{ healthScore: { sort: 'desc', nulls: 'last' } }, { lastActivityAt: 'desc' }],
    take: limit,
    include: {
      contacts: { select: { id: true, name: true, isChampion: true, isEconomicBuyer: true } },
      _count: { select: { calls: true, insights: true, notes: true } },
    },
  })
  return collection(deals, deals.length)
})

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const parsed = CreateBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid deal', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const deal = await db.deal.create({
    data: {
      title: parsed.data.title,
      account: parsed.data.account,
      stage: parsed.data.stage ?? 'LEAD',
      valueCents: parsed.data.valueCents ?? null,
      currency: parsed.data.currency ?? 'EUR',
      expectedCloseAt: parsed.data.expectedCloseAt ? new Date(parsed.data.expectedCloseAt) : null,
      nextStep: parsed.data.nextStep ?? null,
      nextStepDueAt: parsed.data.nextStepDueAt ? new Date(parsed.data.nextStepDueAt) : null,
    },
  })
  await logDealEvent(deal.id, 'DEAL_CREATED', { title: deal.title, stage: deal.stage })
  await recomputeDealHealth(deal.id)
  return ok({ deal }, { status: 201 })
})
