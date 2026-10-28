// AMBER — deal health score, formula v1 (Ch. 3), versioned via Setting
// health.formulaVersion. Recomputed on every analyzed call.
import { getDb } from '../db'
import type { Deal } from '@prisma/client'
import { logDealEvent } from '../timeline/assemble'

const STAGE_WEIGHT: Record<string, number> = {
  LEAD: 20,
  QUALIFIED: 35,
  PROPOSAL: 55,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
  PARKED: 10,
}

export interface HealthInputs {
  stage: string
  meddicFilled: number // 0-6, NOT_FOUND does not count
  nextStepSet: boolean
  nextStepDueAt: Date | null
  lastActivityAt: Date
  now?: Date
}

export function computeHealthV1(input: HealthInputs): number {
  const now = input.now ?? new Date()
  const base = STAGE_WEIGHT[input.stage] ?? 20
  const meddic = 25 * (Math.max(0, Math.min(6, input.meddicFilled)) / 6)
  let nextStep = 0
  if (input.nextStepSet) {
    if (input.nextStepDueAt) {
      const days = (input.nextStepDueAt.getTime() - now.getTime()) / 86_400_000
      nextStep = days >= -1 && days <= 14 ? 15 : 5
    } else {
      nextStep = 5
    }
  }
  const daysSince = (now.getTime() - input.lastActivityAt.getTime()) / 86_400_000
  const recency = daysSince <= 7 ? 15 : daysSince <= 14 ? 8 : daysSince <= 30 ? 3 : 0
  const raw = 0.45 * base + meddic + nextStep + recency
  return Math.max(0, Math.min(100, Math.round(raw)))
}

/** Loads what it needs and writes healthScore + a timeline event. */
export async function recomputeDealHealth(dealId: string, now = new Date()): Promise<number | null> {
  const db = getDb()
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    include: {
      insights: {
        where: { type: { in: ['MEDDIC_M', 'MEDDIC_E', 'MEDDIC_D_CRITERIA', 'MEDDIC_D_PROCESS', 'MEDDIC_I', 'MEDDIC_C'] }, status: { in: ['ACTIVE', 'CONFIRMED'] } },
      },
      calls: { select: { occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 1 },
    },
  })
  if (!deal) return null

  let meddicFilled = 0
  const seen = new Set<string>()
  for (const ins of deal.insights) {
    const content = ins.content as string
    const isNotFound = /not found in this call/i.test(content) || ins.title.includes('NOT_FOUND')
    if (!isNotFound && !seen.has(ins.type)) {
      seen.add(ins.type)
      meddicFilled++
    }
  }
  meddicFilled = Math.min(6, Math.max(0, meddicFilled))

  const lastActivity = deal.lastActivityAt
  const score = computeHealthV1({
    stage: deal.stage,
    meddicFilled,
    nextStepSet: !!deal.nextStep,
    nextStepDueAt: deal.nextStepDueAt,
    lastActivityAt: lastActivity,
    now,
  })
  const prev = deal.healthScore
  await db.deal.update({ where: { id: dealId }, data: { healthScore: score } })
  await logDealEvent(dealId, 'HEALTH_RECOMPUTED', { score, previous: prev, meddicFilled }, now)
  return score
}
