// AMBER — analysis stage (S6, WO-018..021): T03 summary, T04 MEDDIC, T05 signals,
// T06 scorecard, T07 follow-up, T08 notes, T12 practice candidates. Idempotent
// per task (partial artifacts kept on failure, Table 3.6); Must tasks failing
// terminal -> ANALYZE_FAILED. Deal hooks: risk flags + health + timeline.
import { getDb } from '../db'
import type { Call, Insight, Segment, SpeakerLabel } from '@prisma/client'
import { runTask } from '../tasks/engine'
import { computeTalkMetrics } from '../metrics/talk'
import { getRubric, weightedOverall, rubricText, type ScoredDimension } from '../score/rubric'
import { computeRiskFlags, persistRiskFlags } from '../dealintel/flags'
import { recomputeDealHealth } from '../health/formula'
import { logDealEvent } from '../timeline/assemble'
import { publish } from '../events'
import { logger } from '../logger'

export const MEDDIC_TYPES = ['MEDDIC_M', 'MEDDIC_E', 'MEDDIC_D_CRITERIA', 'MEDDIC_D_PROCESS', 'MEDDIC_I', 'MEDDIC_C'] as const
export const SIGNAL_TYPES = ['OBJECTION', 'BUYING_SIGNAL', 'COMPETITOR', 'PRICING_SIGNAL', 'TIMELINE_SIGNAL', 'NEXT_STEP'] as const

export class StageError extends Error {
  constructor(public stage: string, public code: string, message: string) {
    super(message)
  }
}

export interface AnalyzeOutcome {
  insightCount: number
  overall: number | null
}

const MEDDIC_TYPE_BY_KEY: Record<string, 'MEDDIC_M' | 'MEDDIC_E' | 'MEDDIC_D_CRITERIA' | 'MEDDIC_D_PROCESS' | 'MEDDIC_I' | 'MEDDIC_C'> = {
  M: 'MEDDIC_M',
  E: 'MEDDIC_E',
  D_CRITERIA: 'MEDDIC_D_CRITERIA',
  D_PROCESS: 'MEDDIC_D_PROCESS',
  I: 'MEDDIC_I',
  C: 'MEDDIC_C',
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().setting.findUnique({ where: { key } })
  return (row?.value as T) ?? fallback
}

export async function runAnalyzeStage(call: Call): Promise<AnalyzeOutcome> {
  const db = getDb()
  const transcript = await db.transcript.findUnique({ where: { callId: call.id }, include: { segments: true } })
  if (!transcript || transcript.segments.length === 0) {
    throw new StageError('analyze', 'ANALYZE_FAILED', 'no transcript to analyze')
  }
  const ordered = [...transcript.segments].sort((a, b) => a.idx - b.idx)
  const idByIdx = new Map(ordered.map((s) => [s.idx, s.id]))
  const ctxSegments = ordered.map((s) => ({ idx: s.idx, speaker: s.speaker, text: s.text }))

  // ---- S5 metrics: pure arithmetic (FR-005) ----
  const metrics = computeTalkMetrics(
    ordered.map((s) => ({ speaker: s.speaker, startMs: s.startMs, endMs: s.endMs, text: s.text, idx: s.idx })),
    call.durationSec ?? 60,
  )

  // ---- deal context (Class D stays home; only title/stage/known MEDDIC leave) ----
  const deal = call.dealId ? await db.deal.findUnique({ where: { id: call.dealId } }) : null
  const priorMeddic = call.dealId
    ? await db.insight.findMany({
        where: { dealId: call.dealId, type: { in: [...MEDDIC_TYPES] }, status: { in: ['CONFIRMED', 'ACTIVE'] } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      })
    : []
  const dealContext = deal
    ? `${deal.title} (stage ${deal.stage}); known MEDDIC: ${priorMeddic.map((i) => `${i.type.replace('MEDDIC_', '')}=${(i.title ?? '').slice(0, 40)}`).join('; ') || '(none yet)'}`
    : '(no deal linked)'
  const watchlist = await getSetting<string[]>('competitors.list', [])
  const tone = await getSetting<string>('ui.tone', 'warm-professional')
  const rubric = await getRubric()

  const createdInsights: Insight[] = []
  const insight = async (data: { type: Insight['type']; title: string; content: string; confidence: number; evidenceSegmentIds: string[] }) => {
    const row = await db.insight.create({
      data: {
        callId: call.id,
        dealId: call.dealId,
        type: data.type,
        title: data.title,
        content: data.content,
        confidence: data.confidence,
        evidenceSegmentIds: data.evidenceSegmentIds,
        status: 'ACTIVE',
      },
    })
    createdInsights.push(row)
    publish('insight.created', { callId: call.id, insightId: row.id, type: row.type })
    return row
  }
  const idsFor = (idxs: number[]): string[] => idxs.map((i) => idByIdx.get(i)).filter((v): v is string => !!v)

  // ---- T03 summary (idempotent: skip if a summary row exists) ----
  let summaryRow = await db.callSummary.findUnique({ where: { callId: call.id } })
  if (!summaryRow) {
    const { data, run } = await runTask('T03', {
      callId: call.id,
      ctx: { segments: ctxSegments, dealContext, language: transcript.language },
    })
    const t = data as { summary: string; topics: { name: string; segmentIdx: number[] }[]; nextStepSuggested: string | null }
    summaryRow = await db.callSummary.create({
      data: {
        callId: call.id,
        summary: t.summary,
        topics: t.topics as object,
        nextStepSuggested: t.nextStepSuggested,
        providerRunId: run.id,
      },
    })
    for (const topic of t.topics) {
      await insight({
        type: 'TOPIC',
        title: `Topic: ${topic.name}`,
        content: `Call topic identified by the summary pass.`,
        confidence: 0.7,
        evidenceSegmentIds: idsFor(topic.segmentIdx),
      })
    }
  }

  // ---- T04 MEDDIC (skip if the 6 MEDDIC insights already exist) ----
  const existingMeddic = await db.insight.count({ where: { callId: call.id, type: { in: [...MEDDIC_TYPES] }, status: 'ACTIVE' } })
  if (existingMeddic < 6) {
    const { data } = await runTask('T04', {
      callId: call.id,
      ctx: { segments: ctxSegments, dealContext, language: transcript.language },
    })
    const t = data as {
      fields: { key: 'M' | 'E' | 'D_CRITERIA' | 'D_PROCESS' | 'I' | 'C'; value: string | null; notFound: boolean; confidence: number; evidenceIdx: number[]; quote: string }[]
    }
    for (const f of t.fields) {
      const label = MEDDIC_TYPE_BY_KEY[f.key]
      await insight({
        type: label,
        title: f.notFound ? `${f.key}: not found in this call` : `${f.key}: ${f.value?.slice(0, 60) ?? ''}`,
        content: f.notFound ? 'NOT_FOUND — this field was not evidenced in the call. Honesty contract: absence is a valid answer.' : (f.value ?? ''),
        confidence: f.notFound ? 0.15 : f.confidence,
        evidenceSegmentIds: idsFor(f.evidenceIdx),
      })
    }
  }

  // ---- T05 signals (skip if signal insights exist) ----
  const existingSignals = await db.insight.count({ where: { callId: call.id, type: { in: [...SIGNAL_TYPES] }, status: 'ACTIVE' } })
  if (existingSignals === 0) {
    const { data } = await runTask('T05', {
      callId: call.id,
      ctx: { segments: ctxSegments, dealContext: watchlist.join(', '), language: transcript.language, watchlist },
    })
    const t = data as { signals: { type: 'OBJECTION' | 'BUYING_SIGNAL' | 'COMPETITOR' | 'PRICING_SIGNAL' | 'TIMELINE_SIGNAL' | 'NEXT_STEP'; title: string; content: string; confidence: number; evidenceIdx: number[]; quote: string }[] }
    for (const s of t.signals) {
      await insight({
        type: s.type,
        title: s.title,
        content: `${s.content} Evidence: "${s.quote}"`,
        confidence: s.confidence,
        evidenceSegmentIds: idsFor(s.evidenceIdx),
      })
    }
  }

  // ---- deterministic risk flags (Table 3.4) on the latest analyzed call ----
  if (call.dealId) {
    const dealRow = await db.deal.findUniqueOrThrow({ where: { id: call.dealId } })
    const dealCalls = await db.call.findMany({ where: { dealId: call.dealId }, select: { id: true, contactId: true } })
    const latestSignals = await db.insight.findMany({
      where: { callId: call.id, type: { in: [...SIGNAL_TYPES] }, status: 'ACTIVE' },
    })
    const drafts = computeRiskFlags({
      deal: dealRow,
      latestCall: call,
      latestSignalInsights: latestSignals,
      latestSummaryNextStep: summaryRow.nextStepSuggested,
      dealCalls,
    })
    await persistRiskFlags(call, drafts)
    for (const f of drafts) publish('insight.created', { callId: call.id, insightId: `flag:${f.flag}`, type: 'RISK_FLAG' })
  }

  // ---- T06 scorecard (skip if a scorecard row exists) ----
  let overall: number | null = null
  let scorecard = await db.scorecard.findUnique({ where: { callId: call.id } })
  if (!scorecard) {
    const { data, run } = await runTask('T06', {
      callId: call.id,
      ctx: {
        segments: ctxSegments,
        dealContext: rubricText(rubric),
        language: transcript.language,
        rubricText: rubricText(rubric),
        facts: { talkRatioRep: metrics.talkRatioRep, questionCount: metrics.questionCount, longestMonologueSec: metrics.longestMonologueSec },
      },
    })
    const t = data as { dimensions: { key: string; score: number; evidenceIdx: number[]; comment: string }[] }
    const dims: ScoredDimension[] = t.dimensions.map((d) => ({
      key: d.key,
      score: d.score,
      evidenceSegmentIds: idsFor(d.evidenceIdx),
      comment: d.comment,
    }))
    overall = weightedOverall(dims, rubric)
    scorecard = await db.scorecard.create({
      data: {
        callId: call.id,
        rubricVersion: rubric.version,
        overall,
        dimensions: { dims, rubric: rubric.dimensions } as object,
        talkRatioRep: metrics.talkRatioRep,
        questionCount: metrics.questionCount,
        longestMonologueSec: metrics.longestMonologueSec,
        providerRunId: run.id,
      },
    })
  } else {
    overall = scorecard.overall
  }

  // ---- T07 follow-up draft (skip if a draft row exists) ----
  const existingDraft = await db.followUpDraft.findUnique({ where: { callId: call.id } })
  if (!existingDraft) {
    const { data } = await runTask('T07', {
      callId: call.id,
      ctx: { segments: ctxSegments, dealContext: summaryRow.summary, tone, language: transcript.language },
    })
    const t = data as { subject: string; body: string }
    await db.followUpDraft.create({
      data: { callId: call.id, subject: t.subject, body: t.body, tone, status: 'DRAFT' },
    })
  }

  // ---- T08 notes draft (skip if an ai note exists) ----
  const existingAiNote = await db.note.findFirst({ where: { callId: call.id, origin: 'ai' } })
  if (!existingAiNote) {
    const { data } = await runTask('T08', {
      callId: call.id,
      ctx: { segments: ctxSegments, dealContext: summaryRow.summary, language: transcript.language },
    })
    const t = data as { decisions: string[]; openQuestions: string[]; actionItems: string[] }
    const body = [
      t.decisions.length ? `**Decisions**\n${t.decisions.map((d) => `- ${d}`).join('\n')}` : '',
      t.openQuestions.length ? `**Open questions**\n${t.openQuestions.map((d) => `- ${d}`).join('\n')}` : '',
      t.actionItems.length ? `**Action items**\n${t.actionItems.map((d) => `- ${d}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')
    await db.note.create({ data: { callId: call.id, body: body || '(no notes drafted)', origin: 'ai' } })
  }

  // ---- T12 practice candidates (non-blocking, Should-tier behavior) ----
  try {
    const existingCandidates = await db.bestPractice.count({ where: { sourceCallId: call.id, origin: 'MODEL_SUGGESTED' } })
    if (existingCandidates === 0) {
      const { data } = await runTask('T12', { callId: call.id, ctx: { segments: ctxSegments, dealContext: summaryRow.summary } })
      const t = data as { suggestions: { title: string; category: string; body: string; evidenceIdx: number[] }[] }
      for (const s of t.suggestions) {
        await db.bestPractice.create({
          data: {
            title: s.title,
            category: s.category,
            body: s.body,
            sourceCallId: call.id,
            evidenceSegmentIds: idsFor(s.evidenceIdx) as object,
            origin: 'MODEL_SUGGESTED',
            status: 'CANDIDATE',
          },
        })
      }
    }
  } catch (e) {
    logger.warn('T12 practice suggestions failed (non-blocking)', { callId: call.id, error: e instanceof Error ? e.message : String(e) })
  }

  // ---- deal hooks: health + timeline ----
  if (call.dealId) {
    await logDealEvent(call.dealId, 'CALL_ANALYZED', {
      callId: call.id,
      title: call.title,
      overall,
      talkRatioRep: metrics.talkRatioRep,
      insights: createdInsights.length,
    }, call.occurredAt)
    await recomputeDealHealth(call.dealId)
  }

  return { insightCount: createdInsights.length, overall }
}

/** Reanalyze: supersede prior analysis outputs so history is preserved (Table 3.6). */
export async function supersedeAnalysis(call: Call): Promise<void> {
  const db = getDb()
  const prior = await db.insight.findMany({ where: { callId: call.id, status: { in: ['ACTIVE', 'CONFIRMED'] } } })
  for (const old of prior) {
    await db.insight.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } })
  }
  const sc = await db.scorecard.findUnique({ where: { callId: call.id } })
  if (sc) await db.scorecard.delete({ where: { id: sc.id } })
  const sm = await db.callSummary.findUnique({ where: { callId: call.id } })
  if (sm) await db.callSummary.delete({ where: { id: sm.id } })
  const draft = await db.followUpDraft.findUnique({ where: { callId: call.id } })
  if (draft && (draft.status === 'DRAFT' || draft.status === 'EDITED')) {
    await db.followUpDraft.delete({ where: { id: draft.id } })
  }
  // AI-origin note only: user-edited notes are never touched.
  const aiNote = await db.note.findFirst({ where: { callId: call.id, origin: 'ai' } })
  if (aiNote) await db.note.delete({ where: { id: aiNote.id } })
  await db.bestPractice.deleteMany({ where: { sourceCallId: call.id, origin: 'MODEL_SUGGESTED', status: 'CANDIDATE' } })
}
