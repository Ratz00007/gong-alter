import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'
import { logDealEvent } from '@/lib/timeline/assemble'
import { recomputeDealHealth } from '@/lib/health/formula'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const PatchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  account: z.string().min(1).max(200).optional(),
  stage: z.enum(['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED']).optional(),
  valueCents: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().length(3).optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  nextStep: z.string().max(300).nullable().optional(),
  nextStepDueAt: z.string().datetime().nullable().optional(),
})

export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const deal = await db.deal.findUnique({
    where: { id },
    include: {
      contacts: true,
      calls: { orderBy: { occurredAt: 'desc' }, select: { id: true, title: true, status: true, occurredAt: true, durationSec: true, language: true } },
      insights: {
        where: { status: { in: ['ACTIVE', 'CONFIRMED'] }, type: { in: ['MEDDIC_M', 'MEDDIC_E', 'MEDDIC_D_CRITERIA', 'MEDDIC_D_PROCESS', 'MEDDIC_I', 'MEDDIC_C'] } },
        orderBy: { createdAt: 'desc' },
      },
      emailMessages: {
        orderBy: { sentAt: 'desc' },
      },
    },
  })
  if (!deal) return notFound('Deal')
  const timeline = await import('@/lib/timeline/assemble').then((m) => m.buildTimeline(id, 100))
  return ok({ deal, timeline: timeline.items })
})

export const PATCH = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const deal = await db.deal.findUnique({ where: { id } })
  if (!deal) return notFound('Deal')
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid patch', parsed.error.issues.map((i) => i.path.join('.')))

  const stageChanged = parsed.data.stage && parsed.data.stage !== deal.stage
  if (stageChanged) {
    await logDealEvent(id, 'STAGE_CHANGE', { from: deal.stage, to: parsed.data.stage })
  }
  const nsChanged = parsed.data.nextStep !== undefined && parsed.data.nextStep !== deal.nextStep
  if (nsChanged && parsed.data.nextStep) {
    await logDealEvent(id, 'NEXT_STEP_SET', { nextStep: parsed.data.nextStep.slice(0, 120) })
  }

  const updated = await db.deal.update({
    where: { id },
    data: {
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      ...(parsed.data.account ? { account: parsed.data.account } : {}),
      ...(parsed.data.stage ? { stage: parsed.data.stage } : {}),
      ...(parsed.data.valueCents !== undefined ? { valueCents: parsed.data.valueCents } : {}),
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
      ...(parsed.data.expectedCloseAt !== undefined ? { expectedCloseAt: parsed.data.expectedCloseAt ? new Date(parsed.data.expectedCloseAt) : null } : {}),
      ...(parsed.data.nextStep !== undefined ? { nextStep: parsed.data.nextStep } : {}),
      ...(parsed.data.nextStepDueAt !== undefined ? { nextStepDueAt: parsed.data.nextStepDueAt ? new Date(parsed.data.nextStepDueAt) : null } : {}),
      lastActivityAt: new Date(),
    },
  })
  if (stageChanged || nsChanged) await recomputeDealHealth(id)
  return ok({ deal: updated })
})

export const DELETE = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const url = new URL(req.url)
  const db = getDb()
  const deal = await db.deal.findUnique({ where: { id }, include: { calls: { select: { id: true, title: true } } } })
  if (!deal) return notFound('Deal')

  if (url.searchParams.get('hard') === '1' && url.searchParams.get('confirm') === 'yes') {
    // explicit hard delete: warns, unlinks calls (SetNull), keeps their timelines' content
    await db.deal.delete({ where: { id } })
    return ok({ deleted: id, mode: 'hard', warning: `Hard-deleted deal "${deal.title}"; ${deal.calls.length} call(s) unlinked and preserved` })
  }

  // default: soft delete (archive)
  await db.deal.update({ where: { id }, data: { archivedAt: new Date() } })
  await logDealEvent(id, 'STAGE_CHANGE', { from: deal.stage, to: 'ARCHIVED' })
  return ok({ archived: id, mode: 'soft', warning: 'Deal archived. Hard delete requires ?hard=1&confirm=yes' })
})
