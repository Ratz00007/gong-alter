// Unit: health score v1 (Ch. 3 formula pinned), talk metrics arithmetic (FR-005).
import { describe, test, expect } from 'bun:test'
import { computeHealthV1 } from '@/lib/health/formula'
import { computeTalkMetrics } from '@/lib/metrics/talk'
import { weightedOverall } from '@/lib/score/rubric'

const now = new Date('2026-10-25T12:00:00Z')

describe('health score v1 (Table 3 formula)', () => {
  test('full house: NEGOTIATION, 6/6 MEDDIC, dated next step within 14d, activity 2d ago', () => {
    const score = computeHealthV1({
      stage: 'NEGOTIATION', meddicFilled: 6, nextStepSet: true,
      nextStepDueAt: new Date('2026-11-01'), lastActivityAt: new Date('2026-10-23T12:00:00Z'), now,
    })
    // 0.45*75=33.75 + 25 + 15 + 15 = 88.75 -> 89
    expect(score).toBe(89)
  })

  test('MEDDIC fraction: 3/6 fields contributes 12.5', () => {
    const score = computeHealthV1({
      stage: 'QUALIFIED', meddicFilled: 3, nextStepSet: false, nextStepDueAt: null,
      lastActivityAt: new Date('2026-10-25T11:00:00Z'), now,
    })
    // 0.45*35=15.75 + 12.5 + 0 + 15 = 43.25 -> 43
    expect(score).toBe(43)
  })

  test('next step set but stale (no date) scores 5, undated next step scores 5', () => {
    const score = computeHealthV1({
      stage: 'LEAD', meddicFilled: 0, nextStepSet: true, nextStepDueAt: null,
      lastActivityAt: now, now,
    })
    // 0.45*20=9 + 0 + 5 + 15 = 29
    expect(score).toBe(29)
  })

  test('recency bands on WON (base 45 + meddic 25): 10d->8 adds 8, 20d->3, 40d->0', () => {
    const at = (days: number, recency: number) =>
      computeHealthV1({ stage: 'WON', meddicFilled: 6, nextStepSet: false, nextStepDueAt: null, lastActivityAt: new Date(now.getTime() - days * 86400000), now })
    expect(at(10, 8)).toBe(78) // 45 + 25 + 8
    expect(at(20, 3)).toBe(73)
    expect(at(40, 0)).toBe(70)
  })

  test('recency bands explicit', () => {
    const base = (days: number, recency: number) => 0.45 * 20 + 0 + 0 + recency // LEAD, no MEDDIC, no next step
    const d10 = computeHealthV1({ stage: 'LEAD', meddicFilled: 0, nextStepSet: false, nextStepDueAt: null, lastActivityAt: new Date(now.getTime() - 10 * 86400000), now })
    expect(d10).toBe(Math.round(base(10, 8)))
    const d20 = computeHealthV1({ stage: 'LEAD', meddicFilled: 0, nextStepSet: false, nextStepDueAt: null, lastActivityAt: new Date(now.getTime() - 20 * 86400000), now })
    expect(d20).toBe(Math.round(base(20, 3)))
    const d40 = computeHealthV1({ stage: 'LEAD', meddicFilled: 0, nextStepSet: false, nextStepDueAt: null, lastActivityAt: new Date(now.getTime() - 40 * 86400000), now })
    expect(d40).toBe(Math.round(base(40, 0)))
  })

  test('LOST scores 0 base and clamps at 0', () => {
    const score = computeHealthV1({ stage: 'LOST', meddicFilled: 0, nextStepSet: false, nextStepDueAt: null, lastActivityAt: new Date(now.getTime() - 40 * 86400000), now })
    expect(score).toBe(0)
  })

  test('PARKED uses base 10', () => {
    const score = computeHealthV1({ stage: 'PARKED', meddicFilled: 0, nextStepSet: false, nextStepDueAt: null, lastActivityAt: now, now })
    expect(score).toBe(Math.round(0.45 * 10 + 15))
  })
})

describe('talk metrics (FR-005 — arithmetic, never model-estimated)', () => {
  const segs = [
    { idx: 0, speaker: 'REP', startMs: 0, endMs: 10000, text: 'Hello, what is driving this? And how does the onboarding look? ' },
    { idx: 1, speaker: 'PROSPECT', startMs: 10500, endMs: 30000, text: 'Our onboarding takes six weeks and it is all manual.' },
    { idx: 2, speaker: 'REP', startMs: 31000, endMs: 45000, text: 'If we cut that to one week, what would that be worth in numbers?' },
    { idx: 3, speaker: 'REP', startMs: 45500, endMs: 70000, text: 'Let me also show you the audit trail and the reporting, because the reporting is where teams usually feel it. The audit trail covers every change with who and when.' },
    { idx: 4, speaker: 'PROSPECT', startMs: 71000, endMs: 90000, text: 'That would save us maybe a day per week.' },
  ]
  const m = computeTalkMetrics(segs, 100)

  test('rep talk ratio is hand-computable from segment timings', () => {
    // rep ms = 10 + 14 + 24.5 = 48.5s of 100s -> 48.5%
    expect(m.talkRatioRep).toBeCloseTo(48.5, 1)
  })

  test('question count counts ? in rep segments only', () => {
    expect(m.questionCount).toBe(3)
  })

  test('longest monologue is the longest consecutive REP run', () => {
    // segments 2,3 are adjacent REP: 14 + 24.5 = 38.5s
    expect(m.longestMonologueSec).toBe(39) // rounded from 38.5
  })

  test('coverage ratio', () => {
    expect(m.coverageRatio).toBeCloseTo(87, 0)
  })
})

describe('weighted overall (weights applied in code, never in the model)', () => {
  const rubric = {
    version: 'v1',
    dimensions: [
      { key: 'discovery', weight: 0.25, fullMarks: '' },
      { key: 'value', weight: 0.2, fullMarks: '' },
      { key: 'objections', weight: 0.15, fullMarks: '' },
      { key: 'next_step', weight: 0.15, fullMarks: '' },
      { key: 'talk_balance', weight: 0.15, fullMarks: '' },
      { key: 'rapport', weight: 0.1, fullMarks: '' },
    ],
  }
  test('all 10s -> 100', () => {
    const dims = rubric.dimensions.map((d) => ({ key: d.key, score: 10, evidenceSegmentIds: [], comment: '' }))
    expect(weightedOverall(dims, rubric)).toBe(100)
  })
  test('discovery 8 everything else 10 -> 95', () => {
    const dims = rubric.dimensions.map((d) => ({ key: d.key, score: d.key === 'discovery' ? 8 : 10, evidenceSegmentIds: [], comment: '' }))
    expect(weightedOverall(dims, rubric)).toBe(95)
  })
})
