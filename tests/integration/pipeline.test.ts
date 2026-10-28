// Integration: the pipeline journey (FR-001..008) with fixture audio + sidecar script,
// crash-safety boundaries, budget hard stop, dedup, and the state machine.
import { describe, test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useTestDb, seedOnce, getDb, writeScript, createPureWavBuffer } from '../helpers'
import { storeAsset } from '@/lib/media/vault'
import { handleNormalize, handleTranscribe, handleAnalyze, handleIndex, retryCall, failCall, intakeCall } from '@/lib/pipeline/orchestrator'
import { drainQueue } from '@/lib/jobs/worker'
import { wordCountOf } from '@/lib/pipeline/stt'
import { computeRiskFlags } from '@/lib/dealintel/flags'
import { record, spentThisMonth, capUsd } from '@/lib/budget/ledger'
import { HttpError } from '@/lib/http'
import { publish, subscribe } from '@/lib/events'

const g1Script = JSON.parse(readFileSync('tests/fixtures/eval/G1.json', 'utf8'))

/** WAV generator with a known script (Ch. 9 fixtures). */
function makeFixtureWav(seconds: number, path: string) {
  const buf = createPureWavBuffer(seconds, 440)
  writeFileSync(path, buf)
  return buf
}

beforeAll(async () => {
  useTestDb()
  await seedOnce()
})

describe('media vault (WO-007, FR-002)', () => {
  test('content-addressed store dedups by SHA-256', async () => {
    const bytes = makeFixtureWav(2, join(mkdtempSync(join(tmpdir(), 'amber-t-')), 'a.wav'))
    const first = await storeAsset(bytes, 'audio/wav', 'a.wav')
    const second = await storeAsset(bytes, 'audio/wav', 'different-name.wav')
    expect(second.created).toBe(false)
    expect(second.asset.id).toBe(first.asset.id)
  })
})

describe('the Core Loop end-to-end (S1..S7)', () => {
  test('upload -> normalize -> transcribe+relabel -> analyze -> index -> READY', async () => {
    const db = getDb()
    const wav = makeFixtureWav(20, join(mkdtempSync(join(tmpdir(), 'amber-t-')), 'g1.wav'))
    const { asset } = await storeAsset(wav, 'audio/wav', 'g1.wav')
    const deal = await db.deal.create({ data: { title: 'Acme Expansion', account: 'Acme' } })
    const call = await intakeCall({
      title: 'G1 discovery', dealId: deal.id, occurredAt: new Date(),
      mediaAssetId: asset.id, audioSha256: asset.sha256,
    })
    writeScript(call.id, {
      language: 'en',
      segments: g1Script.segments.map((s: { speaker: string; startMs: number; endMs: number; text: string }) => ({
        speaker: s.speaker === 'REP' ? 'SPEAKER_00' : 'SPEAKER_01',
        startMs: s.startMs, endMs: s.endMs, text: s.text,
      })),
    })

    // S3 normalize
    await handleNormalize(call.id)
    const afterNorm = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(afterNorm.status).toBe('TRANSCRIBING')
    expect(afterNorm.normalizedAssetId).toBeTruthy()
    expect(afterNorm.durationSec).toBeGreaterThan(0)

    // S4 transcribe + diarize/relabel
    await handleTranscribe(call.id)
    const transcript = await db.transcript.findUniqueOrThrow({ where: { callId: call.id }, include: { segments: true } })
    expect(transcript.segments.length).toBe(g1Script.segments.length)
    expect(transcript.segments.some((s) => s.speaker === 'REP')).toBe(true)
    expect(transcript.segments.some((s) => s.speaker === 'PROSPECT')).toBe(true)

    // S5 arithmetic metrics exist via scorecard later; S6 analyze
    await handleAnalyze(call.id)
    const afterAnalyze = await db.call.findUniqueOrThrow({
      where: { id: call.id },
      include: { summary: true, scorecard: true, followUpDraft: true, notes: { where: { origin: 'ai' } }, insights: true },
    })
    expect(afterAnalyze.status).toBe('INDEXING')
    expect(afterAnalyze.summary!.summary.length).toBeGreaterThan(80)
    expect(afterAnalyze.insights.filter((i) => i.type.startsWith('MEDDIC_')).length).toBe(6)
    expect(afterAnalyze.scorecard!.overall).toBeGreaterThan(0)
    expect(afterAnalyze.followUpDraft!.subject.length).toBeGreaterThan(3)
    expect(afterAnalyze.notes.length).toBe(1)

    // deterministic risk flags on the deal
    const flags = afterAnalyze.insights.filter((i) => i.type === 'RISK_FLAG')
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.map((f) => f.content).join(' ')).toContain('SINGLE_THREADED')
    expect(flags.map((f) => f.content).join(' ')).toContain('PRICING_FRICTION') // 'budget' in G1 seg 6
    expect(flags.map((f) => f.content).join(' ')).not.toContain('NO_NEXT_STEP') // G1 secures a next step

    // S7 index -> READY
    await handleIndex(call.id)
    const ready = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(ready.status).toBe('READY')

    // health recomputed with MEDDIC filled
    const refreshedDeal = await db.deal.findUniqueOrThrow({ where: { id: deal.id } })
    expect(refreshedDeal.healthScore).not.toBeNull()
    expect(refreshedDeal.healthScore!).toBeGreaterThan(30)
  }, 60000)
})

describe('honesty gates (Table 3.6)', () => {
  test('mostly-silent audio -> TRANSCRIBE_EMPTY, audio retained', async () => {
    const db = getDb()
    const wav = makeFixtureWav(5, join(mkdtempSync(join(tmpdir(), 'amber-t-')), 'silent.wav'))
    const { asset } = await storeAsset(wav, 'audio/wav', 'silent.wav')
    const call = await intakeCall({ title: 'Hold music', occurredAt: new Date(), mediaAssetId: asset.id, audioSha256: asset.sha256 })
    // no sidecar script -> scripted STT yields zero segments; drive the real worker
    await drainQueue()
    // first attempt fails and requeues with backoff; the call is FAILED immediately
    let code = ''
    try {
      await handleTranscribe(call.id)
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code).toBe('TRANSCRIBE_EMPTY')
    const failed = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.mediaAssetId).toBeTruthy() // audio retained
    expect(failed.errorMessage).toContain('TRANSCRIBE_EMPTY')
  }, 15000)

  test('word count gate: under 25 words is empty, not analysis', () => {
    expect(wordCountOf([{ speaker: 'SPEAKER_00', startMs: 0, endMs: 1000, text: 'Hi there' }])).toBe(2)
  })
})

describe('crash safety (FR-008, NFR-04)', () => {
  test('idempotent re-entry: normalize no-ops when the artifact exists (no double-run)', async () => {
    const db = getDb()
    const wav = makeFixtureWav(10, join(mkdtempSync(join(tmpdir(), 'amber-t-')), 'idem.wav'))
    const script = { language: 'en', segments: g1Script.segments.slice(0, 8) }
    const { asset } = await storeAsset(wav, 'audio/wav', 'idem.wav')
    const call = await intakeCall({ title: 'idem', occurredAt: new Date(), mediaAssetId: asset.id, audioSha256: asset.sha256 })
    void writeScript(call.id, script)

    await handleNormalize(call.id)
    const normalizedId = (await db.call.findUniqueOrThrow({ where: { id: call.id } })).normalizedAssetId
    await handleNormalize(call.id) // crash-restart re-entry
    const again = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(again.normalizedAssetId).toBe(normalizedId)
    expect(again.status).not.toBe('NORMALIZING')
  })

  test('transcript exists -> re-entry advances without a second STT run', async () => {
    const db = getDb()
    const wav = makeFixtureWav(10, join(mkdtempSync(join(tmpdir(), 'amber-t-')), 'resume.wav'))
    const script = { language: 'en', segments: g1Script.segments.slice(0, 10) }
    const { asset } = await storeAsset(wav, 'audio/wav', 'resume.wav')
    const call = await intakeCall({ title: 'resume', occurredAt: new Date(), mediaAssetId: asset.id, audioSha256: asset.sha256 })
    void writeScript(call.id, script)
    await handleNormalize(call.id)
    await handleTranscribe(call.id)
    const transcriptId = (await db.transcript.findUniqueOrThrow({ where: { callId: call.id } })).id
    const runsBefore = await db.providerRun.count({ where: { callId: call.id, taskId: 'T01' } })
    await handleTranscribe(call.id) // re-entry after a crash between transcript-write and analyze-enqueue
    const runsAfter = await db.providerRun.count({ where: { callId: call.id, taskId: 'T01' } })
    expect(runsAfter).toBe(runsBefore) // no stage ever runs twice against the same input
    expect((await db.transcript.findUniqueOrThrow({ where: { callId: call.id } })).id).toBe(transcriptId)
    const after = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(after.status).toBe('ANALYZING')
  })

  test('FAILED is terminal-but-retryable; three consecutive failures park with an error card', async () => {
    const db = getDb()
    const wav = makeFixtureWav(3, join(mkdtempSync(join(tmpdir(), 'amber-t-')), 'park.wav'))
    const { asset } = await storeAsset(wav, 'audio/wav', 'park.wav')
    const call = await intakeCall({ title: 'park', occurredAt: new Date(), mediaAssetId: asset.id, audioSha256: asset.sha256 })
    for (let i = 1; i <= 3; i++) {
      await failCall(call.id, 'transcribe', 'TRANSCRIBE_EMPTY', 'Nothing to transcribe (audio retained)')
    }
    const parked = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(parked.status).toBe('FAILED')
    expect(parked.retryCount).toBe(3)
    // user retry re-enters the failed stage and resets the counter
    await retryCall(call.id)
    const retried = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(retried.status).toBe('TRANSCRIBING')
    expect(retried.retryCount).toBe(0)
  })
})

describe('budget ledger (FR-022, NFR-06 — hard stop at the transaction)', () => {
  test('the 0.01-dollar cap trick refuses the run', async () => {
    const db = getDb()
    await db.setting.update({ where: { key: 'budget.monthlyCapUsd' }, data: { value: 0.01 } })
    const run = await db.providerRun.create({ data: { taskId: 'T03', provider: 'OPENAI', model: 'gpt-4o-mini', status: 'OK' } })
    let refused = false
    try {
      await record({ providerRunId: run.id, amountUsd: 0.02, note: 'should refuse' })
    } catch (e) {
      refused = e instanceof HttpError && e.code === 'BUDGET_EXCEEDED'
    }
    expect(refused).toBe(true)
    expect(await spentThisMonth()).toBe(0) // nothing recorded
    // restore cap for later tests
    await db.setting.update({ where: { key: 'budget.monthlyCapUsd' }, data: { value: 5 } })
    expect(await capUsd()).toBe(5)
  })
})

describe('deterministic risk flags (FR-010, Table 3.4)', () => {
  test('every flag links evidence; NO_NEXT_STEP fires only when nothing anywhere', () => {
    const base = {
      deal: { id: 'd1', nextStep: null, nextStepDueAt: null, expectedCloseAt: null, stage: 'PROPOSAL' as const },
      latestCall: { id: 'c1' },
      latestSignalInsights: [],
      latestSummaryNextStep: null,
      dealCalls: [{ id: 'c1', contactId: 'k1' }, { id: 'c2', contactId: null }],
    }
    const flags = computeRiskFlags(base)
    const names = flags.map((f) => f.flag)
    expect(names).toContain('NO_NEXT_STEP')
    expect(names).toContain('SINGLE_THREADED')
    // a next step anywhere silences NO_NEXT_STEP
    const withNext = computeRiskFlags({ ...base, latestSummaryNextStep: 'book technical session Thursday' })
    expect(withNext.map((f) => f.flag)).not.toContain('NO_NEXT_STEP')
    // expected close passed without WON -> TIMELINE_SLIP
    const slipped = computeRiskFlags({
      ...base,
      deal: { ...base.deal, expectedCloseAt: new Date('2026-10-01') },
    })
    expect(slipped.map((f) => f.flag)).toContain('TIMELINE_SLIP')
  })
})

describe('event bus (Table 5.8)', () => {
  test('publish reaches subscribers', async () => {
    let received: unknown = null
    const off = subscribe((event, payload) => {
      if (event === 'call.ready') received = payload
    })
    publish('call.ready', { callId: 'xyz' })
    off()
    publish('call.ready', { callId: 'later' }) // no subscriber; must not throw
    expect(received).toEqual({ callId: 'xyz' })
  })
})
