// AMBER — task registry (Table 6.1): hint, output schema (zod = quality gate),
// and the shared TaskContext every assembler draws from.
import { z } from 'zod'

export interface TaskContextSegment {
  idx: number
  speaker: string
  text: string
}

export interface TaskContext {
  segments?: TaskContextSegment[]
  dealContext?: string
  language?: string
  tone?: string
  watchlist?: string[]
  rubricText?: string
  facts?: { talkRatioRep: number; questionCount: number; longestMonologueSec: number }
  hits?: { id: string; score: number; source: string; text: string }[]
  question?: string
  minScore?: number
}

export type MockTaskId = 'T02' | 'T03' | 'T04' | 'T05' | 'T06' | 'T07' | 'T08' | 'T11' | 'T12'

const segList = z.array(z.object({ idx: z.number().int(), speaker: z.string(), text: z.string() }))

export const TASK_SCHEMAS = {
  T02: z.object({
    repCluster: z.enum(['SPEAKER_00', 'SPEAKER_01', 'UNKNOWN']),
    reasoning: z.string().min(3),
  }),
  T03: z.object({
    summary: z.string().min(80),
    topics: z.array(z.object({ name: z.string().min(2), segmentIdx: z.array(z.number().int()) })).min(2).max(5),
    nextStepSuggested: z.string().nullable(),
  }),
  T04: z.object({
    fields: z
      .array(
        z.object({
          key: z.enum(['M', 'E', 'D_CRITERIA', 'D_PROCESS', 'I', 'C']),
          value: z.string().nullable(),
          notFound: z.boolean(),
          confidence: z.number().min(0).max(1),
          evidenceIdx: z.array(z.number().int()),
          quote: z.string(),
        }),
      )
      .length(6),
  }),
  T05: z.object({
    signals: z.array(
      z.object({
        type: z.enum(['OBJECTION', 'BUYING_SIGNAL', 'COMPETITOR', 'PRICING_SIGNAL', 'TIMELINE_SIGNAL', 'NEXT_STEP']),
        title: z.string().min(2),
        content: z.string().min(3),
        confidence: z.number().min(0).max(1),
        evidenceIdx: z.array(z.number().int()),
        quote: z.string(),
      }),
    ),
  }),
  T06: z.object({
    dimensions: z
      .array(
        z.object({
          key: z.enum(['discovery', 'value', 'objections', 'next_step', 'talk_balance', 'rapport']),
          score: z.number().int().min(0).max(10),
          evidenceIdx: z.array(z.number().int()),
          comment: z.string(),
        }),
      )
      .length(6),
  }),
  T07: z.object({ subject: z.string().min(3).max(80), body: z.string().min(50) }),
  T08: z.object({
    decisions: z.array(z.string()),
    openQuestions: z.array(z.string()),
    actionItems: z.array(z.string()),
  }),
  T11: z.object({
    answer: z.string().min(3),
    citations: z.array(z.object({ hitId: z.string(), quote: z.string() })),
  }),
  T12: z.object({
    suggestions: z.array(
      z.object({
        title: z.string().min(3),
        category: z.enum(['Discovery', 'Objections', 'Value', 'Next steps', 'Rapport', 'Other']),
        body: z.string().min(20),
        evidenceIdx: z.array(z.number().int()),
      }),
    ),
  }),
} as const

export type TaskOutput = z.infer<(typeof TASK_SCHEMAS)[MockTaskId]>

export interface TaskSpec {
  hint: 'small' | 'medium'
  schema: z.ZodTypeAny
}

export const TASKS: Record<MockTaskId, TaskSpec> = {
  T02: { hint: 'small', schema: TASK_SCHEMAS.T02 },
  T03: { hint: 'small', schema: TASK_SCHEMAS.T03 },
  T04: { hint: 'medium', schema: TASK_SCHEMAS.T04 },
  T05: { hint: 'medium', schema: TASK_SCHEMAS.T05 },
  T06: { hint: 'medium', schema: TASK_SCHEMAS.T06 },
  T07: { hint: 'small', schema: TASK_SCHEMAS.T07 },
  T08: { hint: 'small', schema: TASK_SCHEMAS.T08 },
  T11: { hint: 'medium', schema: TASK_SCHEMAS.T11 },
  T12: { hint: 'small', schema: TASK_SCHEMAS.T12 },
}

/** Render segments for a prompt (shared by all assemblers). */
export function renderSegments(segments: TaskContextSegment[] | undefined): string {
  return (segments ?? []).map((s) => `[${s.idx}] ${s.speaker}: ${s.text}`).join('\n')
}

export function segmentsOf(ctx: TaskContext): TaskContextSegment[] {
  return ctx.segments ?? []
}

export { segList }
