import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'
import { logDealEvent } from '@/lib/timeline/assemble'
import { recomputeDealHealth } from '@/lib/health/formula'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({ status: z.enum(['CONFIRMED', 'DISMISSED']) })

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const insight = await db.insight.findUnique({ where: { id }, include: { call: { select: { id: true, dealId: true, contactId: true } } } })
  if (!insight) return notFound('Insight')
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Body must be {status: CONFIRMED|DISMISSED}')

  const updated = await db.insight.update({ where: { id }, data: { status: parsed.data.status } })
  const dealId = insight.call.dealId

  if (parsed.data.status === 'CONFIRMED') {
    // Write-through per Table 5.4: confirmed MEDDIC writes to Deal/Contact flags.
    const call = insight.call
    if (dealId) {
      await logDealEvent(dealId, 'INSIGHT_CONFIRMED', { insightId: id, type: insight.type, title: insight.title }, new Date())
    }
    if (insight.type === 'MEDDIC_C' && call.contactId) {
      await db.contact.update({ where: { id: call.contactId }, data: { isChampion: true } })
    }
    if (insight.type === 'MEDDIC_E' && call.contactId) {
      await db.contact.update({ where: { id: call.contactId }, data: { isEconomicBuyer: true } })
    }
    if (insight.type === 'NEXT_STEP' && dealId) {
      // Suggest a next step on the deal from confirmed call evidence (dated if parseable).
      const dateMatch = insight.content.match(/\b(\d{4}-\d{2}-\d{2}|next (week|month|monday|tuesday|wednesday|thursday|friday)|by (the end of \w+))\b/i)
      await db.deal.update({
        where: { id: dealId },
        data: { nextStep: insight.content.slice(0, 300), nextStepDueAt: dateMatch ? new Date() : null },
      })
      if (dealId) await logDealEvent(dealId, 'NEXT_STEP_SET', { insightId: id, nextStep: insight.content.slice(0, 120) })
    }
    if (dealId) await recomputeDealHealth(dealId)
  } else if (parsed.data.status === 'DISMISSED' && dealId) {
    await logDealEvent(dealId, 'INSIGHT_DISMISSED', { insightId: id, type: insight.type }, new Date())
  }

  return ok({ insight: updated })
})
