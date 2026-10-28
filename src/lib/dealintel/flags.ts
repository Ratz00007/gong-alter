// AMBER — deterministic risk flags (Table 3.4): computed post-hoc from T05 signal
// insights + deal state. Every flag links to the segment evidence that triggered it.
import { getDb } from '../db'
import type { Call, Deal, Insight } from '@prisma/client'

export interface RiskFlagDraft {
  flag: 'NO_NEXT_STEP' | 'SINGLE_THREADED' | 'COMPETITOR_MENTIONED' | 'PRICING_FRICTION' | 'TIMELINE_SLIP'
  severity: 'High' | 'Medium'
  title: string
  content: string
  evidenceSegmentIds: string[]
}

export function computeRiskFlags(input: {
  deal: Pick<Deal, 'id' | 'nextStep' | 'nextStepDueAt' | 'expectedCloseAt' | 'stage'>
  latestCall: Pick<Call, 'id'> | null
  latestSignalInsights: Pick<Insight, 'type' | 'evidenceSegmentIds'>[]
  latestSummaryNextStep: string | null
  dealCalls: Pick<Call, 'id' | 'contactId'>[]
  now?: Date
}): RiskFlagDraft[] {
  const flags: RiskFlagDraft[] = []
  const now = input.now ?? new Date()
  const ev = (ins: Pick<Insight, 'evidenceSegmentIds'>): string[] =>
    Array.isArray(ins.evidenceSegmentIds) ? (ins.evidenceSegmentIds as string[]) : []

  const has = (t: string) => input.latestSignalInsights.find((i) => i.type === (t as never))
  const nextStepInsight = has('NEXT_STEP')

  // NO_NEXT_STEP — latest analyzed call ends with no agreed next step anywhere
  const dealHasNextStep = !!input.deal.nextStep
  const callHasNextStep = !!nextStepInsight || !!input.latestSummaryNextStep
  if (!dealHasNextStep && !callHasNextStep) {
    flags.push({
      flag: 'NO_NEXT_STEP',
      severity: 'High',
      title: 'No next step secured',
      content: 'The latest analyzed call on this deal ended with no agreed next step or date in insights, notes, or draft.',
      evidenceSegmentIds: nextStepInsight ? ev(nextStepInsight) : [],
    })
  }

  // SINGLE_THREADED — all calls involve one contact
  const distinctContacts = new Set(input.dealCalls.map((c) => c.contactId ?? 'none').filter((v) => v !== 'none'))
  if (input.dealCalls.length > 0 && distinctContacts.size <= 1) {
    flags.push({
      flag: 'SINGLE_THREADED',
      severity: 'Medium',
      title: 'Single-threaded',
      content: 'All calls on this deal involve a single contact; there is no second thread into the account.',
      evidenceSegmentIds: [],
    })
  }

  // COMPETITOR_MENTIONED
  const competitor = has('COMPETITOR')
  if (competitor) {
    flags.push({
      flag: 'COMPETITOR_MENTIONED',
      severity: 'Medium',
      title: 'Competitor mentioned',
      content: 'The prospect named an alternative vendor on the latest call.',
      evidenceSegmentIds: ev(competitor),
    })
  }

  // PRICING_FRICTION
  const pricing = has('PRICING_SIGNAL')
  if (pricing) {
    flags.push({
      flag: 'PRICING_FRICTION',
      severity: 'Medium',
      title: 'Pricing friction',
      content: 'Objection language on price, budget, discounting, or procurement pushback detected in the latest call.',
      evidenceSegmentIds: ev(pricing),
    })
  }

  // TIMELINE_SLIP — expected close passes without a WON stage
  if (input.deal.expectedCloseAt && input.deal.expectedCloseAt < now && input.deal.stage !== 'WON') {
    flags.push({
      flag: 'TIMELINE_SLIP',
      severity: 'Medium',
      title: 'Timeline slip',
      content: 'The expected close date has passed without the deal advancing to WON.',
      evidenceSegmentIds: [],
    })
  }

  return flags
}

/** Supersede previous RISK_FLAG insights for the deal and write the new set on the latest call. */
export async function persistRiskFlags(call: Call, drafts: RiskFlagDraft[]): Promise<Insight[]> {
  const db = getDb()
  const dealId = call.dealId
  const previous = dealId
    ? await db.insight.findMany({ where: { dealId, type: 'RISK_FLAG', status: { in: ['ACTIVE', 'CONFIRMED'] } } })
    : []
  const created: Insight[] = []
  await db.$transaction(async (tx) => {
    for (const old of previous) {
      await tx.insight.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } })
    }
    for (const d of drafts) {
      created.push(
        await tx.insight.create({
          data: {
            callId: call.id,
            dealId: call.dealId,
            type: 'RISK_FLAG',
            title: d.title,
            content: `${d.flag} (${d.severity}): ${d.content}`,
            confidence: 1,
            evidenceSegmentIds: d.evidenceSegmentIds,
            status: 'ACTIVE',
          },
        }),
      )
    }
  })
  return created
}
