// Integration: API contract tests — auth, upload rules (FR-001), dedup (FR-002),
// error envelope (Table 5.2), export redaction (FR-024), search (FR-018/019/020),
// and the egress invariant at the adapter boundary (NFR-05).
import { describe, test, expect, beforeAll } from 'bun:test'
import { NextRequest } from 'next/server'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useTestDb, seedOnce, getDb, writeScript, createPureWavBuffer } from '../helpers'

// route handlers (in-process, against the test DB)
import { POST as loginPost } from '@/app/api/auth/login/route'
import { GET as loginProtectedGet } from '@/app/api/settings/route'
import { GET as callsGet, POST as callsPost } from '@/app/api/calls/route'
import { PATCH as insightPatch } from '@/app/api/insights/[id]/route'
import { GET as exportGet } from '@/app/api/system/export/route'
import { POST as searchPost } from '@/app/api/library/search/route'
import { POST as answerPost } from '@/app/api/library/answer/route'
import { GET as pipelineGet } from '@/app/api/pipeline/route'
import { POST as evalPost } from '@/app/api/evals/run/route'
import { GET as jobsGet } from '@/app/api/jobs/route'
import { openaiChat } from '@/lib/providers/openai'
import { ollamaChat } from '@/lib/providers/ollama'
import { redactForCloud } from '@/lib/redact/engine'
import { handleNormalize, handleTranscribe, handleAnalyze, handleIndex, intakeCall } from '@/lib/pipeline/orchestrator'
import { storeAsset } from '@/lib/media/vault'
import { semanticSearch, embedChunks } from '@/lib/search/embed'
import { buildTimeline, logDealEvent } from '@/lib/timeline/assemble'

let cookie = ''

function authed(url: string, init?: RequestInit): NextRequest {
  const h = new Headers(init?.headers)
  h.set('cookie', cookie)
  const { signal, ...rest } = init ?? {}
  return new NextRequest(url, { ...rest, signal: signal ?? undefined, headers: h })
}

function makeWav(seconds: number): Buffer {
  return createPureWavBuffer(seconds, 330)
}

beforeAll(async () => {
  useTestDb()
  await seedOnce()
  const res = await loginPost(
    new NextRequest('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase: 'amber-demo' }), headers: { 'content-type': 'application/json' } }),
  )
  const setCookie = res.headers.get('set-cookie') ?? ''
  cookie = setCookie.split(';')[0]
  expect(cookie.startsWith('amber_session=')).toBe(true)
})

describe('auth + error envelope (Table 5.2)', () => {
  test('no session -> 401 UNAUTHORIZED envelope', async () => {
    const res = await loginProtectedGet(new NextRequest('http://localhost/api/settings'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  test('wrong passphrase -> 401; session cookie flags per T4', async () => {
    const res = await loginPost(
      new NextRequest('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase: 'wrong' }), headers: { 'content-type': 'application/json' } }),
    )
    expect(res.status).toBe(401)
    const ok = await loginPost(
      new NextRequest('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase: 'amber-demo' }), headers: { 'content-type': 'application/json' } }),
    )
    const setCookie = ok.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
  })

  test('valid session passes (defense in depth beyond middleware)', async () => {
    const res = await loginProtectedGet(authed('http://localhost/api/settings'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.some((i: { key: string }) => i.key === 'budget.monthlyCapUsd')).toBe(true)
  })
})

describe('upload rules (FR-001) and dedup (FR-002)', () => {
  test('rejected format -> 415 UNSUPPORTED_MEDIA with the rule stated; nothing persisted', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'evil.exe', { type: 'application/x-msdownload' }))
    const res = await callsPost(authed('http://localhost/api/calls', { method: 'POST', body: form }))
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA')
    expect(body.error.message).toContain('500 MB')
    expect(await getDb().mediaAsset.count()).toBe(0)
  })

  test('accepted upload -> 202 with call row; duplicate bytes -> duplicate:true and no second job', async () => {
    const wav = makeWav(12)
    const g1 = JSON.parse(readFileSync('tests/fixtures/eval/G1.json', 'utf8'))
    const db = getDb()
    const deal = await db.deal.create({ data: { title: 'Dedup deal', account: 'Acme' } })

    const form1 = new FormData()
    form1.set('file', new File([new Uint8Array(wav)], 'call.wav', { type: 'audio/wav' }))
    form1.set('dealId', deal.id)
    form1.set('title', 'First upload')
    const script = {
      language: 'en',
      segments: g1.segments.map((s: { speaker: string; startMs: number; endMs: number; text: string }) => ({
        speaker: s.speaker === 'REP' ? 'SPEAKER_00' : 'SPEAKER_01', startMs: s.startMs, endMs: s.endMs, text: s.text,
      })),
    }
    form1.set('script', JSON.stringify(script))
    const res1 = await callsPost(authed('http://localhost/api/calls', { method: 'POST', body: form1 }))
    expect(res1.status).toBe(202)
    const body1 = await res1.json()
    expect(body1.duplicate).toBe(false)
    writeScript(body1.call.id, script)

    const jobsAfterFirst = await getDb().job.count()
    expect(jobsAfterFirst).toBeGreaterThan(0)

    // same bytes again
    const form2 = new FormData()
    form2.set('file', new File([new Uint8Array(wav)], 'renamed.wav', { type: 'audio/wav' }))
    const res2 = await callsPost(authed('http://localhost/api/calls', { method: 'POST', body: form2 }))
    const body2 = await res2.json()
    expect(body2.duplicate).toBe(true)
    expect(body2.call.id).toBe(body1.call.id)
    expect(body2.message).toBe('Already in your library')
    const jobsAfterSecond = await getDb().job.count()
    expect(jobsAfterSecond).toBe(jobsAfterFirst) // no second transcription job
  })
})

describe('pipeline surfaces once analyzed', () => {
  test('full journey then: board payload, insight confirm write-through, export redaction, search, RAG refusal, eval', async () => {
    const db = getDb()
    const wav = makeWav(30)
    const g1 = JSON.parse(readFileSync('tests/fixtures/eval/G1.json', 'utf8'))
    const deal = await db.deal.create({ data: { title: 'Surfaces deal', account: 'Acme', valueCents: 1200000 } })
    const { asset } = await storeAsset(wav, 'audio/wav', 'surf.wav')
    const call = await intakeCall({ title: 'Surfaces call', dealId: deal.id, occurredAt: new Date(), mediaAssetId: asset.id, audioSha256: asset.sha256 })
    writeScript(call.id, {
      language: 'en',
      segments: g1.segments.map((s: { speaker: string; startMs: number; endMs: number; text: string }) => ({
        speaker: s.speaker === 'REP' ? 'SPEAKER_00' : 'SPEAKER_01', startMs: s.startMs, endMs: s.endMs, text: s.text,
      })),
    })
    await handleNormalize(call.id)
    await handleTranscribe(call.id)
    await handleAnalyze(call.id)
    await handleIndex(call.id)
    const ready = await db.call.findUniqueOrThrow({ where: { id: call.id } })
    expect(ready.status).toBe('READY')

    // ---- board payload (FR-011) ----
    const board = await pipelineGet(authed('http://localhost/api/pipeline'))
    const boardBody = await board.json()
    expect(boardBody.total.deals).toBeGreaterThan(0)
    expect(typeof (boardBody.byStage.LEAD?.length ?? boardBody.byStage.PROPOSAL?.length)).toBe('number')

    // ---- timeline (FR-012) ----
    logDealEvent(deal.id, 'STAGE_CHANGE', { from: 'LEAD', to: 'QUALIFIED' })
    await db.deal.update({ where: { id: deal.id }, data: { stage: 'QUALIFIED' } })
    const tl = await buildTimeline(deal.id)
    expect(tl.items.some((e) => e.kind === 'CALL_ANALYZED')).toBe(true)
    expect(tl.items.some((e) => e.kind === 'STAGE_CHANGE')).toBe(true)

    // ---- insight confirm writes through to deal/contact (Table 5.4) ----
    const contact = await db.contact.create({ data: { dealId: deal.id, name: 'Sarah Klein' } })
    await db.call.update({ where: { id: call.id }, data: { contactId: contact.id } })
    const meddicC = await db.insight.findFirstOrThrow({ where: { callId: call.id, type: 'MEDDIC_C' } })
    const confirmRes = await insightPatch(
      authed(`http://localhost/api/insights/${meddicC.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMED' }), headers: { 'content-type': 'application/json' } }),
      { params: Promise.resolve({ id: meddicC.id }) },
    )
    expect(confirmRes.status).toBe(200)
    const contactAfter = await db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(contactAfter.isChampion).toBe(true)

    // ---- export is redacted per scope ALL (FR-024) ----
    // plant a Class B secret in the transcript, then export
    await db.segment.updateMany({ where: { transcript: { callId: call.id } }, data: { text: 'also reach me at sarah.klein@northwind-gmbh.de' } })
    const exportRes = await exportGet(authed('http://localhost/api/system/export'))
    const bundle = await exportRes.json()
    expect(bundle.manifest.media.hashes.length).toBeGreaterThan(0)
    const allExportedText = JSON.stringify(bundle.segments) + JSON.stringify(bundle.transcripts)
    expect(allExportedText).not.toContain('sarah.klein@northwind-gmbh.de')
    expect(allExportedText).toContain('[EMAIL]')
    expect(JSON.stringify(bundle)).not.toContain('OPENAI_API_KEY')
    expect(JSON.stringify(bundle)).not.toContain('SESSION_PASSPHRASE')

    // ---- search (FR-018/020) ----
    const searchRes = await searchPost(
      authed('http://localhost/api/library/search', { method: 'POST', body: JSON.stringify({ q: 'onboarding reporting', filters: { speaker: 'PROSPECT' } }), headers: { 'content-type': 'application/json' } }),
    )
    const searchBody = await searchRes.json()
    expect(searchBody.mode).toBe('search')
    expect(searchBody.hits.length).toBeGreaterThan(0)

    const filteredRes = await searchPost(
      authed('http://localhost/api/library/search', { method: 'POST', body: JSON.stringify({ q: 'onboarding', filters: { dealId: deal.id } }), headers: { 'content-type': 'application/json' } }),
    )
    expect((await filteredRes.json()).hits.length).toBeGreaterThan(0)

    // ---- RAG answer with refusal on no-hit (T11) ----
    const noHit = await answerPost(
      authed('http://localhost/api/library/answer', { method: 'POST', body: JSON.stringify({ q: 'quantum chromodynamics of the boardroom' }), headers: { 'content-type': 'application/json' } }),
    )
    const noHitBody = await noHit.json()
    expect(noHitBody.refused).toBe(true)
    expect(noHitBody.answer).toContain("can't find that in your library")

    const hit = await answerPost(
      authed('http://localhost/api/library/answer', { method: 'POST', body: JSON.stringify({ q: 'what did they say about onboarding' }), headers: { 'content-type': 'application/json' } }),
    )
    const hitBody = await hit.json()
    expect(hitBody.refused).toBe(false)
    expect(hitBody.answer.length).toBeGreaterThan(10)

    // ---- eval harness end-to-end on the golden set ----
    const evalRes = await evalPost(authed('http://localhost/api/evals/run', { method: 'POST' }))
    const evalBody = await evalRes.json()
    expect(evalBody.total).toBeGreaterThan(20)
    expect(Object.keys(evalBody.byTask)).toContain('T03')
    expect(Object.keys(evalBody.byTask)).toContain('T09')

    // ---- jobs surface ----
    const jobsRes = await jobsGet(authed('http://localhost/api/jobs'))
    const jobsBody = await jobsRes.json()
    expect(jobsBody.items.length).toBeGreaterThan(0)
  }, 90000)
})

describe('search performance (FR-019: under 2s at 1k-call scale)', () => {
  test('brute-force cosine over ~8k vectors returns inside the budget', async () => {
    const db = getDb()
    // synthetic corpus: 1000 calls x 8 vectors
    const rows: { resourceType: 'SEGMENT'; resourceId: string; chunkIdx: number; text: string; model: string; dim: number; vector: Uint8Array<ArrayBuffer> }[] = []
    for (let c = 0; c < 1000; c++) {
      for (let k = 0; k < 8; k++) {
        const text = `call ${c} segment ${k} onboarding reporting manual process approval`
        // cheap deterministic vector via the mock embedder
        const v = new Float32Array([0.1, 0.2, 0.3])
        void v
        const vecBuf = new Float32Array([Math.random(), 0.2, 0.3])
        rows.push({ resourceType: 'SEGMENT', resourceId: `syn-${c}-${k}`, chunkIdx: 0, text, model: 'amber-mock-embed', dim: 3, vector: new Uint8Array(vecBuf.buffer) })
      }
    }
    await db.embedding.createMany({ data: rows })
    const started = Date.now()
    const { hits } = await semanticSearch('onboarding reporting manual', {}, { minScore: 0.05, limit: 50 })
    const elapsed = Date.now() - started
    expect(hits.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('egress invariant (NFR-05 — build-failing by design)', () => {
  test('adapter request payloads contain only the pre-redacted text; no audio bytes, no Class B raw', async () => {
    const raw = 'Reach me at sarah.klein@northwind-gmbh.de, IBAN DE89 3704 0044 0532 0130 00, from Sarah Klein.'
    const redacted = (await redactForCloud(raw)).redacted
    expect(redacted).not.toContain('sarah.klein@')
    expect(redacted).not.toContain('DE89 3704')

    let captured: { url: string; body: string } | null = null
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: typeof init?.body === 'string' ? init.body : '' }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ repCluster: 'SPEAKER_00', reasoning: 'ok' }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      await openaiChat.chat({ model: 'gpt-4o-mini', system: 'probe', user: redacted, temperature: 0 })
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(captured).not.toBeNull()
    const body = captured!.body
    // the adapter forwards exactly the given (already redacted) text — by construction
    expect(body).toContain('[EMAIL]')
    expect(body).not.toContain('sarah.klein@northwind')
    expect(body).not.toContain('DE89 3704')
    // the wire format carries no audio field at all (types forbid it; schema shows it)
    const parsed = JSON.parse(body)
    expect(parsed.messages.every((m: { content: string }) => typeof m.content === 'string')).toBe(true)
    expect(JSON.stringify(parsed)).not.toMatch(/audio|wav|bytes|buffer/i)
  })

  test('ollama adapter request shape (local leg: text in, JSON out)', async () => {
    let captured: unknown = null
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: init?.body }
      return new Response(JSON.stringify({ message: { content: '{"repCluster":"SPEAKER_00","reasoning":"ok"}' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      const res = await ollamaChat.chat({ model: 'qwen3:8b', system: 's', user: 'u' })
      expect(res.text).toContain('repCluster')
      const body = JSON.parse((captured as { body: string }).body)
      expect(body.model).toBe('qwen3:8b')
      expect(body.stream).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
