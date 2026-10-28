// AMBER — pipeline orchestrator (Table 3.2). Owns state transitions, job chaining,
// failure semantics (FAILED terminal-but-retryable, park at 3), and idempotent
// re-entry (a stage safely no-ops if its output already exists — FR-008).
import { getDb } from '../db'
import type { Call, CallStatus } from '@prisma/client'
import { enqueue } from '../jobs/queue'
import { publish } from '../events'
import { logger } from '../logger'
import { runNormalizeStage } from './normalize'
import { runTranscribeStage, wordCountOf, type SttOutput } from './stt'
import { relabelSpeakers, pauseClusterSpeakers } from './diarize'
import { runAnalyzeStage, supersedeAnalysis, StageError } from './analyze'
import { runIndexStage } from './index'

const FLOW: Record<string, CallStatus[]> = {
  NORMALIZE: ['UPLOADED', 'FAILED'],
  TRANSCRIBE: ['NORMALIZING', 'TRANSCRIBING', 'FAILED'],
  ANALYZE: ['TRANSCRIBING', 'ANALYZING', 'FAILED'],
  INDEX: ['ANALYZING', 'INDEXING', 'FAILED'],
}

export async function advanceCall(callId: string, to: CallStatus): Promise<void> {
  const db = getDb()
  const before = await db.call.findUnique({ where: { id: callId } })
  if (!before) return
  await db.call.update({ where: { id: callId }, data: { status: to, updatedAt: new Date() } })
  publish('call.stage', { callId, from: before.status, to, at: new Date().toISOString() })
  if (to === 'READY') publish('call.ready', { callId })
}

export async function failCall(callId: string, stage: string, code: string, message: string): Promise<void> {
  const db = getDb()
  const call = await db.call.findUnique({ where: { id: callId } })
  if (!call) return
  const retryCount = call.retryCount + 1
  await db.call.update({
    where: { id: callId },
    data: {
      status: 'FAILED',
      failedStage: stage,
      errorMessage: `${code}: ${message}`.slice(0, 500),
      retryCount,
    },
  })
  publish('call.failed', { callId, stage, errorCode: code })
  logger.warn(`call ${callId.slice(-6)} failed at ${stage} (${code}); attempt ${retryCount}/3`, { message: message.slice(0, 200) })
}

async function loadCall(jobCallId: string | null): Promise<Call | null> {
  if (!jobCallId) return null
  return getDb().call.findUnique({ where: { id: jobCallId } })
}

/** Re-entry point for a FAILED call (user action). Resets the in-flight boundary. */
export async function retryCall(callId: string): Promise<void> {
  const db = getDb()
  const call = await db.call.findUnique({ where: { id: callId } })
  if (!call) return
  const stage = call.failedStage ?? 'normalize'
  const reentry: Record<string, CallStatus> = {
    normalize: 'UPLOADED',
    transcribe: 'TRANSCRIBING',
    analyze: 'ANALYZING',
    index: 'INDEXING',
  }
  await db.call.update({
    where: { id: callId },
    data: { status: reentry[stage] ?? 'UPLOADED', retryCount: 0, errorMessage: null, failedStage: null },
  })
  const jobType = (stage === 'normalize' ? 'NORMALIZE' : stage === 'transcribe' ? 'TRANSCRIBE' : stage === 'analyze' ? 'ANALYZE' : 'INDEX') as 'NORMALIZE' | 'TRANSCRIBE' | 'ANALYZE' | 'INDEX'
  await enqueue(jobType, { callId, priority: 2 })
}

// ---------------- stage handlers (registered by register-handlers) ----------------

export async function handleNormalize(jobCallId: string | null): Promise<void> {
  const db = getDb()
  const call = await loadCall(jobCallId)
  if (!call) throw new Error('NORMALIZE_FAILED: call not found')
  // idempotent re-entry
  if (call.normalizedAssetId) {
    await advanceCall(call.id, 'TRANSCRIBING')
    await enqueue('TRANSCRIBE', { callId: call.id, priority: 5 })
    return
  }
  await advanceCall(call.id, 'NORMALIZING')
  await runNormalizeStage(call) // exits to TRANSCRIBING inside its transaction
  await advanceCall(call.id, 'TRANSCRIBING')
  await enqueue('TRANSCRIBE', { callId: call.id, priority: 5 })
}

export async function handleTranscribe(jobCallId: string | null): Promise<void> {
  const db = getDb()
  const call = await loadCall(jobCallId)
  if (!call) throw new Error('TRANSCRIBE_FAILED: call not found')
  const existing = await db.transcript.findUnique({ where: { callId: call.id } })
  if (existing) {
    // resume after crash between transcript-write and analyze-enqueue
    await advanceCall(call.id, 'ANALYZING')
    await enqueue('ANALYZE', { callId: call.id, priority: 5 })
    return
  }
  const wav = call.normalizedAssetId ? await db.mediaAsset.findUnique({ where: { id: call.normalizedAssetId } }) : null
  let out: SttOutput
  try {
    out = await runTranscribeStage(call, wav)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new StageError('transcribe', msg.startsWith('TRANSCRIBE_') ? msg.split(':')[0] : 'TRANSCRIBE_FAILED', msg)
  }
  const words = wordCountOf(out.segments)
  if (words < 25) {
    throw new StageError('transcribe', 'TRANSCRIBE_EMPTY', `Nothing to transcribe (${words} words; audio retained)`)
  }
  // whisper path gives one flat cluster; pause-cluster before persist
  const needsCluster = out.segments.length > 0 && out.segments.every((s) => s.speaker === 'SPEAKER_00')
  const segments = needsCluster ? pauseClusterSpeakers(out.segments) : out.segments

  // STT provenance run (LOCAL_STT or ZAI when cloud ASR was opted in)
  const run = await db.providerRun.create({
    data: {
      taskId: 'T01',
      provider: out.provider,
      model: out.sttModel,
      callId: call.id,
      status: 'OK',
      latencyMs: 1,
      finishedAt: new Date(),
    },
  })

  await db.$transaction(async (tx) => {
    const transcript = await tx.transcript.create({
      data: {
        callId: call.id,
        fullText: segments.map((s) => s.text).join('\n'),
        wordCount: words,
        language: out.language,
        sttModel: out.sttModel,
        providerRunId: run.id,
      },
    })
    for (let i = 0; i < segments.length; i++) {
      await tx.segment.create({
        data: {
          transcriptId: transcript.id,
          idx: i,
          speaker: segments[i].speaker as 'SPEAKER_00' | 'SPEAKER_01',
          startMs: segments[i].startMs,
          endMs: segments[i].endMs,
          text: segments[i].text,
        },
      })
    }
    await tx.call.update({ where: { id: call.id }, data: { language: out.language, status: 'ANALYZING' } })
  })
  publish('call.stage', { callId: call.id, from: 'TRANSCRIBING', to: 'ANALYZING', at: new Date().toISOString() })

  // T02 relabel (within TRANSCRIBING per Table 3.2 artifacts: speaker labels)
  const withSegs = await db.transcript.findUniqueOrThrow({ where: { callId: call.id }, include: { segments: true } })
  try {
    await relabelSpeakers(call.id, withSegs)
  } catch (e) {
    logger.warn('T02 relabel failed; segments stay as clustered labels', { callId: call.id, error: e instanceof Error ? e.message : String(e) })
  }
  await enqueue('ANALYZE', { callId: call.id, priority: 5 })
}

export async function handleAnalyze(jobCallId: string | null): Promise<void> {
  const db = getDb()
  const call = await loadCall(jobCallId)
  if (!call) throw new Error('ANALYZE_FAILED: call not found')
  // idempotent: full output set exists -> advance
  const has = await db.call.findUnique({
    where: { id: call.id },
    include: { summary: true, scorecard: true, followUpDraft: true, notes: { where: { origin: 'ai' } } },
  })
  if (has?.summary && has?.scorecard && has?.followUpDraft && has.notes.length > 0) {
    await advanceCall(call.id, 'INDEXING')
    await enqueue('INDEX', { callId: call.id, priority: 5 })
    return
  }
  await advanceCall(call.id, 'ANALYZING')
  await runAnalyzeStage(call)
  await advanceCall(call.id, 'INDEXING')
  await enqueue('INDEX', { callId: call.id, priority: 5 })
}

export async function handleIndex(jobCallId: string | null): Promise<void> {
  const call = await loadCall(jobCallId)
  if (!call) throw new Error('INDEX_FAILED: call not found')
  // Embedding failure is non-blocking (Table 3.1 S7): READY with warning on the job.
  let warning: string | null = null
  try {
    await runIndexStage(call.id)
  } catch (e) {
    warning = e instanceof Error ? e.message : String(e)
  }
  await advanceCall(call.id, 'READY')
  if (warning) throw new Error(`INDEX_WARNING (call reached READY): ${warning.slice(0, 300)}`)
}

export async function reanalyzeCall(callId: string): Promise<void> {
  const call = await loadCall(callId)
  if (!call) throw new Error('call not found')
  await supersedeAnalysis(call)
  await advanceCall(callId, 'ANALYZING')
  await enqueue('ANALYZE', { callId, priority: 2 })
}

/** Upload intake (S1): create the call, link asset, enqueue NORMALIZE. */
export async function intakeCall(input: {
  title: string
  dealId?: string | null
  contactId?: string | null
  occurredAt: Date
  mediaAssetId: string
  audioSha256: string
}): Promise<Call> {
  const db = getDb()
  const call = await db.call.create({
    data: {
      title: input.title,
      dealId: input.dealId ?? null,
      contactId: input.contactId ?? null,
      occurredAt: input.occurredAt,
      mediaAssetId: input.mediaAssetId,
      audioSha256: input.audioSha256,
      status: 'UPLOADED',
    },
  })
  if (input.dealId) {
    const { logDealEvent } = await import('../timeline/assemble')
    await logDealEvent(input.dealId, 'CALL_UPLOADED', { callId: call.id, title: input.title }, input.occurredAt)
    await db.deal.update({ where: { id: input.dealId }, data: { lastActivityAt: new Date() } })
  }
  await enqueue('NORMALIZE', { callId: call.id, priority: 5 })
  return call
}

export function expectedStatusFor(jobType: string): CallStatus[] {
  return FLOW[jobType] ?? []
}
