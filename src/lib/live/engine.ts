// AMBER Live Assist — session engine (WO-LA2, FR-025/027). One LIVE session at
// a time; text deltas feed the deterministic matcher; audio chunks stream to a
// bounded temp file on disk and land in the vault on end.
// Matcher state is rebuilt from the DB after a process restart (resumable).
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { config } from '../config'
import { getDb } from '../db'
import { publish } from '../events'
import { logger } from '../logger'
import { matchDelta, freshMatcherState, countQuestions, type CueDef, type MatcherState, type CueFireResult } from './matcher'
import type { LiveSession } from '@prisma/client'

const g = globalThis as unknown as {
  __amberLiveState?: Map<string, MatcherState>
}

const liveState: Map<string, MatcherState> = (g.__amberLiveState ??= new Map())

function liveAudioPath(sessionId: string): string {
  const tmpDir = resolve(join(config.mediaDir, 'tmp'))
  const target = resolve(tmpDir, `live-${sessionId}.bin`)
  const rel = relative(tmpDir, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('LIVE_AUDIO_PATH_TRAVERSAL: invalid sessionId')
  }
  return target
}

export function sessionElapsedMs(session: LiveSession): number {
  if (session.status !== 'LIVE') return session.durationMs
  return Date.now() - session.startedAt.getTime()
}

/** Rebuild matcher state from persisted rows (restart-safe, cooldowns honored). */
async function stateFor(session: LiveSession): Promise<MatcherState> {
  const cached = liveState.get(session.id)
  if (cached) return cached
  const db = getDb()
  const fires = await db.liveCueFire.findMany({ where: { sessionId: session.id }, orderBy: { atMs: 'desc' } })
  const lastFired: Record<string, number> = {}
  for (const f of fires) if (lastFired[f.cueId] === undefined) lastFired[f.cueId] = f.atMs
  // words since the last question mark anywhere in the transcript
  const text = session.transcriptText
  const lastQ = text.lastIndexOf('?')
  const wordsSinceQuestion = countQuestions(text) > 0
    ? text.slice(lastQ + 1).split(/\s+/).filter(Boolean).length
    : text.split(/\s+/).filter(Boolean).length
  const state: MatcherState = { lastFired, wordsSinceQuestion }
  liveState.set(session.id, state)
  return state
}

export async function getActiveSession(): Promise<LiveSession | null> {
  return (await getDb().liveSession.findFirst({ where: { status: 'LIVE' }, orderBy: { startedAt: 'desc' } })) ?? null
}

export async function startLiveSession(input: {
  title?: string
  dealId?: string | null
  source?: 'BROWSER_MIC' | 'INJECTED'
}): Promise<LiveSession> {
  const db = getDb()
  const existing = await getActiveSession()
  if (existing) throw new Error('LIVE_SESSION_EXISTS: end the active session first')
  const session = await db.liveSession.create({
    data: {
      title: input.title?.trim() || `Live call ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      dealId: input.dealId ?? null,
      source: input.source ?? 'INJECTED',
      status: 'LIVE',
    },
  })
  liveState.set(session.id, freshMatcherState())
  try {
    rmSync(liveAudioPath(session.id), { force: true })
  } catch {
    /* ignore */
  }
  publish('live.started', { sessionId: session.id, title: session.title })
  logger.info('live session started', { sessionId: session.id, source: session.source })
  return session
}

export async function ingestDelta(sessionId: string, text: string, atMs?: number): Promise<{
  session: LiveSession
  fires: CueFireResult[]
  words: number
  questions: number
} | null> {
  const db = getDb()
  const session = await db.liveSession.findUnique({ where: { id: sessionId } })
  if (!session || session.status !== 'LIVE') return null

  const cues = await db.liveCue.findMany({ orderBy: { sortOrder: 'asc' } })
  const state = await stateFor(session)
  const rel = atMs ?? sessionElapsedMs(session)
  const { fires, words, questions } = matchDelta(text, rel, cues as CueDef[], state)

  const updated = await db.$transaction(async (tx) => {
    for (const f of fires) {
      await tx.liveCueFire.create({
        data: { sessionId: session.id, cueId: f.cueId, atMs: f.atMs, snippet: f.snippet.slice(0, 300) },
      })
    }
    return tx.liveSession.update({
      where: { id: session.id },
      data: {
        transcriptText: (session.transcriptText + (session.transcriptText ? '\n' : '') + text).slice(0, 500_000),
        wordCount: { increment: words },
        questionCount: { increment: questions },
        cueCount: { increment: fires.length },
      },
    })
  })

  publish('live.delta', { sessionId: session.id, words: updated.wordCount, questions: updated.questionCount })
  for (const f of fires) {
    publish('live.cue', { sessionId: session.id, cueId: f.cueId, name: f.name, category: f.category, guidance: f.guidance, snippet: f.snippet, atMs: f.atMs })
    logger.info('live cue fired', { sessionId: session.id, cue: f.name })
  }
  return { session: updated, fires, words, questions }
}

export function appendAudioChunk(sessionId: string, chunk: Buffer): number {
  const p = liveAudioPath(sessionId)
  const maxBytes = config.audio.maxMb * 1024 * 1024
  const currentBytes = existsSync(p) ? statSync(p).size : 0
  if (currentBytes + chunk.length > maxBytes) {
    throw new Error(`LIVE_AUDIO_CAP_EXCEEDED: session audio exceeds ${config.audio.maxMb} MB`)
  }
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, chunk)
  return currentBytes + chunk.length
}

export function takeAudioBuffer(sessionId: string): Buffer | null {
  const p = liveAudioPath(sessionId)
  if (!existsSync(p)) return null
  try {
    const buf = readFileSync(p)
    rmSync(p, { force: true })
    if (buf.length === 0) return null
    return buf
  } catch {
    return null
  }
}

export async function endLiveSession(sessionId: string): Promise<LiveSession | null> {
  const db = getDb()
  const session = await db.liveSession.findUnique({ where: { id: sessionId } })
  if (!session || session.status !== 'LIVE') return session
  const durationMs = sessionElapsedMs(session)
  const updated = await db.liveSession.update({
    where: { id: sessionId },
    data: { status: 'ENDED', endedAt: new Date(), durationMs },
  })
  publish('live.ended', { sessionId, durationMs })
  logger.info('live session ended', { sessionId, durationMs, words: updated.wordCount, cues: updated.cueCount })
  return updated
}

export function dropLiveState(sessionId: string): void {
  liveState.delete(sessionId)
  try {
    rmSync(liveAudioPath(sessionId), { force: true })
  } catch {
    /* ignore */
  }
}
