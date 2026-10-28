// AMBER — auto-built deal timeline (FR-012): every call, confirmed insight,
// stage change, and note on a deal, reverse-chronological, entries link to sources.
import { getDb } from '../db'

export type DealEventKind =
  | 'DEAL_CREATED'
  | 'STAGE_CHANGE'
  | 'CALL_UPLOADED'
  | 'CALL_ANALYZED'
  | 'INSIGHT_CONFIRMED'
  | 'INSIGHT_DISMISSED'
  | 'NOTE_ADDED'
  | 'HEALTH_RECOMPUTED'
  | 'NEXT_STEP_SET'
  | 'PRACTICE_ACCEPTED'
  | 'EMAIL_ACTIVITY'
  | 'CRM_PUSH'

export async function logDealEvent(dealId: string, kind: DealEventKind, payload: Record<string, unknown>, occurredAt = new Date()): Promise<void> {
  const db = getDb()
  await db.dealEvent.create({ data: { dealId, kind, payload: payload as object, occurredAt } })
}

export interface TimelineEntry {
  id: string
  kind: string
  occurredAt: string
  payload: Record<string, unknown>
}

export async function buildTimeline(dealId: string, limit = 200, offset = 0): Promise<{ items: TimelineEntry[]; total: number }> {
  const db = getDb()
  const [rows, total] = await Promise.all([
    db.dealEvent.findMany({
      where: { dealId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.dealEvent.count({ where: { dealId } }),
  ])
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      occurredAt: r.occurredAt.toISOString(),
      payload: (r.payload ?? {}) as Record<string, unknown>,
    })),
    total,
  }
}
