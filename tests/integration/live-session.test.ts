// Integration: Live Assist journey (WO-LA, FR-025..028) — start a session,
// stream deltas through the cue engine, end into the six-stage pipeline, and
// land a READY analyzed call. Also: single-session rule, SSE events, audio
// buffer accumulation, and the honest TOO_SHORT boundary.
import { describe, test, expect, beforeAll } from 'bun:test'
import { useTestDb, seedOnce, getDb } from '../helpers'
import { startLiveSession, ingestDelta, getActiveSession, appendAudioChunk, takeAudioBuffer, endLiveSession, dropLiveState } from '@/lib/live/engine'
import { finalizeSession } from '@/lib/live/finalize'
import { drainQueue } from '@/lib/jobs/worker'
import { subscribe } from '@/lib/events'

beforeAll(async () => {
  useTestDb()
  await seedOnce()
})

const LINES = [
  'Thanks for making time today. What made you take this call?',
  'Honestly, we are drowning in spreadsheets and nobody reads the reports.',
  'We looked at Gong last year but it was too expensive for our team size.',
  'How do you handle security? GDPR matters to us.',
  'Everything stays on your infrastructure, encrypted at rest.',
  'Send me some information and we will circle back next quarter.',
  'Happy to send the two-pager today and book twenty minutes Thursday.',
]

describe('live session lifecycle (FR-025)', () => {
  test('one LIVE session at a time; second start is rejected', async () => {
    const a = await startLiveSession({ title: 'Discovery — Northwind', source: 'INJECTED' })
    expect(a.status).toBe('LIVE')
    await expect(startLiveSession({ title: 'second' })).rejects.toThrow(/LIVE_SESSION_EXISTS/)
    const active = await getActiveSession()
    expect(active?.id).toBe(a.id)
    await endLiveSession(a.id)
    dropLiveState(a.id)
    expect((await getActiveSession())?.id ?? null).toBe(null)
  })
})

describe('cue engine over deltas (FR-026/027)', () => {
  test('objection and competitor phrases fire with persisted audit rows + SSE events', async () => {
    const seen: string[] = []
    const unsub = subscribe((e) => seen.push(e))
    const s = await startLiveSession({ title: 'Cue journey', source: 'INJECTED' })

    const r1 = await ingestDelta(s.id, LINES[0], 1_000)
    expect(r1?.session.wordCount).toBe(11)
    expect(r1?.session.questionCount).toBe(1)
    expect(r1?.fires.length).toBe(0)

    const r2 = await ingestDelta(s.id, LINES[2], 9_000) // "Gong" + "too expensive"
    const names = r2?.fires.map((f) => f.name) ?? []
    expect(names).toContain('Pricing objection')
    expect(names).toContain('Competitor mentioned')

    const r3 = await ingestDelta(s.id, LINES[5], 20_000) // "Send me some information" + "circle back"
    expect((r3?.fires.map((f) => f.name) ?? [])).toContain('Vague follow-up risk')

    // meters accumulate; fires are persisted with session-relative timing
    const db = getDb()
    const fires = await db.liveCueFire.findMany({ where: { sessionId: s.id }, orderBy: { atMs: 'asc' } })
    expect(fires.length).toBeGreaterThanOrEqual(3)
    expect(fires[0].atMs).toBe(9_000)
    const stored = await db.liveSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(stored.cueCount).toBe(fires.length)
    expect(stored.questionCount).toBe(1) // only LINES[0] carries a question mark
    expect(stored.transcriptText).toContain('too expensive')

    // SSE contract (Table 5.8 live.*)
    expect(seen).toContain('live.started')
    expect(seen).toContain('live.delta')
    expect(seen).toContain('live.cue')
    unsub()

    // audio buffer accumulates and flushes once
    appendAudioChunk(s.id, Buffer.from('RIFF'))
    appendAudioChunk(s.id, Buffer.from('DATA'))
    const buf = takeAudioBuffer(s.id)
    expect(buf?.toString()).toBe('RIFFDATA')
    expect(takeAudioBuffer(s.id)).toBe(null)

    await endLiveSession(s.id)
    dropLiveState(s.id)
  })
})

describe('finalize into the pipeline (FR-028)', () => {
  test('text-only session becomes a READY analyzed call with LIVE_STT provenance', async () => {
    const s = await startLiveSession({ title: 'Live — Acme renewal', source: 'INJECTED' })
    for (let i = 0; i < LINES.length; i++) {
      await ingestDelta(s.id, LINES[i], (i + 1) * 5_000)
    }
    await endLiveSession(s.id)

    const res = await finalizeSession(s.id, { process: true })
    expect(res.ok).toBe(true)
    expect(res.mode).toBe('TEXT_SEED')
    expect(res.callId).toBeTruthy()

    await drainQueue()

    const db = getDb()
    const call = await db.call.findUniqueOrThrow({
      where: { id: res.callId! },
      include: {
        transcript: { include: { segments: true } },
        insights: true,
        scorecard: true,
        summary: true,
      },
    })
    expect(call.source).toBe('LIVE_SESSION')
    expect(call.status).toBe('READY')
    expect(call.transcript).toBeTruthy()
    expect(call.transcript!.wordCount).toBeGreaterThanOrEqual(25)
    // single-channel limitation, honestly labeled: one cluster, relabeled by T02
    const speakers = new Set(call.transcript!.segments.map((seg) => seg.speaker))
    expect(speakers.size).toBe(1)
    expect(call.insights.length).toBeGreaterThan(0)
    expect(call.scorecard).toBeTruthy()
    expect(call.summary).toBeTruthy()

    const run = await db.providerRun.findFirst({ where: { callId: call.id, provider: 'LIVE_STT' } })
    expect(run).toBeTruthy()

    const session = await db.liveSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(session.callId).toBe(call.id)
    expect(session.status).toBe('ENDED')
    dropLiveState(s.id)
  }, 30000)

  test('under 25 words with no audio is honestly TOO_SHORT — no call, record kept', async () => {
    const s = await startLiveSession({ title: 'Short one', source: 'INJECTED' })
    await ingestDelta(s.id, 'Hello? Testing, one two three.', 1_000)
    await endLiveSession(s.id)
    const res = await finalizeSession(s.id, { process: true })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('TOO_SHORT')
    const kept = await getDb().liveSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(kept.status).toBe('ENDED')
    expect(kept.callId).toBe(null)
    dropLiveState(s.id)
  })

  test('ending without process keeps the record and never creates a call', async () => {
    const s = await startLiveSession({ title: 'Record only', source: 'INJECTED' })
    await ingestDelta(s.id, LINES[0], 1_000)
    const res = await finalizeSession(s.id, { process: false })
    expect(res.ok).toBe(true)
    expect(res.callId).toBeUndefined()
    dropLiveState(s.id)
  })
})

describe('battlecard library seed (FR-029)', () => {
  test('seeded catalog: 7 phrase cards + 1 cadence rule, all enabled', async () => {
    const cues = await getDb().liveCue.findMany({ orderBy: { sortOrder: 'asc' } })
    expect(cues.length).toBe(8)
    expect(cues.filter((c) => c.kind === 'PHRASE').length).toBe(7)
    expect(cues.filter((c) => c.kind === 'RULE_NO_QUESTION').length).toBe(1)
    expect(cues.every((c) => c.enabled)).toBe(true)
    expect(cues.some((c) => c.name === 'Pricing objection')).toBe(true)
  })
})
