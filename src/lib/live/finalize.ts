// AMBER Live Assist — finalize handoff (WO-LA3, FR-028). The live layer and the
// post-call pipeline are one system: end a session and the same six-stage
// machinery that processes uploads takes over.
//
// Policy (honest about fidelity):
//  - audio captured  -> full pipeline on the audio (normalize -> transcribe ->
//                       pause-cluster -> relabel) — audio is the source of truth
//  - text only       -> transcript seeded from live text (single channel: one
//                       cluster; T02 relabel attributes it; limitation documented)
//  - under 25 words and no audio -> TOO_SHORT, no call, session kept as record
import { getDb } from '../db'
import { enqueue } from '../jobs/queue'
import { publish } from '../events'
import { logger } from '../logger'
import { storeAsset } from '../media/vault'
import { relabelSpeakers } from '../pipeline/diarize'
import { endLiveSession, takeAudioBuffer } from './engine'
import type { LiveSession, Call, SpeakerLabel } from '@prisma/client'

export interface FinalizeResult {
  ok: boolean
  reason?: 'TOO_SHORT' | 'ALREADY_FINALIZED'
  callId?: string
  mode?: 'AUDIO_PIPELINE' | 'TEXT_SEED'
}

/** Infer speaker turns when explicit speaker prefixes exist; otherwise single-channel SPEAKER_00. */
function seedSegments(lines: string[], durationMs: number): { speaker: SpeakerLabel; startMs: number; endMs: number; text: string }[] {
  const clean = lines.map((l) => l.trim()).filter(Boolean)
  const totalWords = clean.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0) || 1
  const span = Math.max(clean.length * 1500, durationMs)
  let cursor = 0
  let currentSpeaker: SpeakerLabel = 'SPEAKER_00'

  const repPrefix = /^(?:rep|agent|host|sales|seller|speake?r[\s_-]*0?0?)\s*:\s*/i
  const prospectPrefix = /^(?:prospect|customer|client|buyer|guest|speake?r[\s_-]*0?1?)\s*:\s*/i

  return clean.map((l) => {
    let text = l
    let speaker: SpeakerLabel = currentSpeaker

    if (repPrefix.test(l)) {
      speaker = 'SPEAKER_00'
      text = l.replace(repPrefix, '').trim()
    } else if (prospectPrefix.test(l)) {
      speaker = 'SPEAKER_01'
      text = l.replace(prospectPrefix, '').trim()
    }

    currentSpeaker = speaker
    const w = text.split(/\s+/).filter(Boolean).length
    const dur = Math.max(800, Math.round((w / totalWords) * span))
    const seg = { speaker, startMs: cursor, endMs: cursor + dur, text }
    cursor += dur
    return seg
  })
}

export async function finalizeSession(sessionId: string, opts: { process: boolean }): Promise<FinalizeResult> {
  const db = getDb()
  const session = await db.liveSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('LIVE_SESSION_NOT_FOUND')
  if (session.callId) return { ok: true, reason: 'ALREADY_FINALIZED', callId: session.callId }

  const ended = session.status === 'LIVE' ? await endLiveSession(sessionId) : session
  if (!ended) throw new Error('LIVE_SESSION_STATE_ERROR')
  if (!opts.process) {
    dropBuffer(sessionId)
    return { ok: true }
  }

  // recorded mic audio, if any: content-address it into the vault (never leaves the machine)
  const audio = takeAudioBuffer(sessionId)
  let audioAssetId: string | null = null
  let audioSha256: string | null = null
  let durationSec: number | null = Math.round(ended.durationMs / 1000) || null
  if (audio && audio.length > 0) {
    const { asset } = await storeAsset(audio, 'audio/webm', 'live-session.webm')
    audioAssetId = asset.id
    audioSha256 = asset.sha256
  }

  const words = ended.wordCount
  const audioPath = audioAssetId ? 'AUDIO_PIPELINE' : null
  if (!audioPath && words < 25) {
    logger.info('live finalize: too short, kept as record', { sessionId, words })
    return { ok: false, reason: 'TOO_SHORT' }
  }

  const call = await db.call.create({
    data: {
      title: ended.title,
      dealId: ended.dealId,
      occurredAt: ended.startedAt,
      durationSec: durationSec ?? undefined,
      source: 'LIVE_SESSION',
      status: audioPath ? 'UPLOADED' : 'ANALYZING',
      mediaAssetId: audioAssetId ?? undefined,
      audioSha256: audioSha256 ?? undefined,
    },
  })
  await db.liveSession.update({ where: { id: ended.id }, data: { callId: call.id, audioAssetId: audioAssetId ?? null } })
  if (ended.dealId) {
    const { logDealEvent } = await import('../timeline/assemble')
    await logDealEvent(ended.dealId, 'CALL_UPLOADED', { callId: call.id, title: call.title, via: 'live' }, ended.startedAt)
    await db.deal.update({ where: { id: ended.dealId }, data: { lastActivityAt: new Date() } })
  }

  if (audioPath) {
    // audio is the source of truth: run the full six-stage pipeline on it
    await enqueue('NORMALIZE', { callId: call.id, priority: 5 })
    logger.info('live finalize: audio pipeline', { sessionId: ended.id, callId: call.id })
    return { ok: true, callId: call.id, mode: 'AUDIO_PIPELINE' }
  }

  // text-only: seed the transcript, then hand to ANALYZE (T02 relabel included)
  await seedTranscriptFromLive(call, ended)
  await enqueue('ANALYZE', { callId: call.id, priority: 5 })
  logger.info('live finalize: text seed pipeline', { sessionId: ended.id, callId: call.id, words })
  return { ok: true, callId: call.id, mode: 'TEXT_SEED' }
}

/** Persist live text as the call transcript with LIVE_STT provenance (T01). */
async function seedTranscriptFromLive(call: Call, session: LiveSession): Promise<void> {
  const db = getDb()
  const lines = session.transcriptText.split('\n')
  const segments = seedSegments(lines, session.durationMs)
  const words = segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0)

  const run = await db.providerRun.create({
    data: {
      taskId: 'T01',
      provider: 'LIVE_STT',
      model: session.source === 'BROWSER_MIC' ? 'browser-live-captions' : 'demo-inject-feed',
      callId: call.id,
      status: 'OK',
      latencyMs: 1,
      finishedAt: new Date(),
    },
  })

  const transcript = await db.transcript.create({
    data: {
      callId: call.id,
      fullText: segments.map((s) => s.text).join('\n'),
      wordCount: words,
      language: 'en',
      sttModel: run.model ?? 'live',
      providerRunId: run.id,
    },
  })
  for (let i = 0; i < segments.length; i++) {
    await db.segment.create({
      data: {
        transcriptId: transcript.id,
        idx: i,
        speaker: segments[i].speaker,
        startMs: segments[i].startMs,
        endMs: segments[i].endMs,
        text: segments[i].text,
      },
    })
  }
  publish('call.stage', { callId: call.id, from: 'TRANSCRIBING', to: 'ANALYZING', at: new Date().toISOString() })

  // T02 relabel on the single cluster (attributed REP; single-channel limitation)
  try {
    const withSegs = await db.transcript.findUniqueOrThrow({ where: { callId: call.id }, include: { segments: true } })
    await relabelSpeakers(call.id, withSegs)
  } catch (e) {
    logger.warn('live T02 relabel failed; segments keep cluster labels', { callId: call.id, error: e instanceof Error ? e.message : String(e) })
  }
}

function dropBuffer(sessionId: string): void {
  takeAudioBuffer(sessionId)
}
