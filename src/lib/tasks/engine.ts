// AMBER — task engine (Ch. 6): renders prompts, plans routing, executes the
// retry ladder (repair-retry once, then escalate), enforces redaction at the
// cloud boundary and the budget at the ledger, and logs every attempt in
// ProviderRun (FR-023 / NFR-11).
import type { Prisma, ProviderRun } from '@prisma/client'
import { getDb } from '../db'
import { TASKS, renderSegments, type TaskContext, type MockTaskId } from './registry'
import { getActiveTemplate, render } from '../prompts/engine'
import { planRoute, type PlannedRoute } from '../routing/router'
import { chainFor } from '../catalog'
import { healthStateMap, noteProviderError } from '../providers/health'
import { getChatAdapter, getEmbedAdapter } from '../providers/registry'
import { mockAnswer } from './mock-brain'
import { redactForCloud } from '../redact/engine'
import { spentThisMonth, capUsd, authorize, recordSpend, record, priceFor } from '../budget/ledger'
import { HttpError } from '../http'
import { config } from '../config'
import { providerHealth } from '../providers/health'
import type { ProviderId } from '../providers/types'

export interface RunTaskResult {
  data: object
  run: ProviderRun
  route: PlannedRoute
}

function buildVars(taskId: MockTaskId, ctx: TaskContext): Record<string, string | number> {
  const segments = renderSegments(ctx.segments)
  const base: Record<string, string | number> = {
    segments,
    language: ctx.language ?? 'en',
    dealContext: ctx.dealContext ?? '(none)',
  }
  if (taskId === 'T05') base.dealContext = (ctx.watchlist ?? []).join(', ') || '(empty watchlist)'
  if (taskId === 'T06') {
    base.dealContext = ctx.rubricText ?? '(rubric unavailable)'
    base.talkRatio = ctx.facts?.talkRatioRep ?? 50
    base.questionCount = ctx.facts?.questionCount ?? 0
    base.longestMonologue = ctx.facts?.longestMonologueSec ?? 0
  }
  if (taskId === 'T07') {
    base.dealContext = ctx.dealContext ?? '(summary unavailable)'
    base.tone = ctx.tone ?? 'warm-professional'
  }
  if (taskId === 'T11') {
    base.question = ctx.question ?? ''
    base.hits = (ctx.hits ?? []).map((h) => `${h.id} score=${h.score.toFixed(2)} [${h.source}] ${h.text.slice(0, 400)}`).join('\n') || '(no hits)'
    base.minScore = ctx.minScore ?? 0.24
  }
  return base
}

/** Robust JSON extraction: fences, prose wrappers, first balanced object. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) throw new Error('no JSON object found')
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"' && (i === 0 || cleaned[i - 1] !== '\\')) inStr = !inStr
    if (inStr) continue
    if (c === '{') depth++
    if (c === '}') {
      depth--
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1))
    }
  }
  throw new Error('unbalanced JSON object')
}

export async function runTask(taskId: MockTaskId, opts: { callId?: string; ctx: TaskContext }): Promise<RunTaskResult> {
  const db = getDb()
  const spec = TASKS[taskId]
  const template = await getActiveTemplate(taskId)
  const vars = buildVars(taskId, opts.ctx)
  const system = template?.systemPrompt ?? ''
  const user = template ? render(template.userTemplate, vars) : ''
  const inputChars = system.length + user.length

  const providers = [...new Set(chainFor(spec.hint, taskId).map((e) => e.provider))].filter((p) => p === 'OLLAMA' || p === 'MOCK' || p === 'LOCAL_STT') as ProviderId[]
  const [spent, cap, health, mockCard] = await Promise.all([spentThisMonth(), capUsd(), healthStateMap(providers), providerHealth('MOCK')])

  let route = planRoute({
    taskId,
    hint: spec.hint,
    inputChars,
    routingMode: config.routingMode,
    budget: { spentUsd: spent, capUsd: cap },
    health,
    mockEnabled: mockCard.up,
  })

  // minContextChars policy: below the floor, escalate by policy (cloud ahead of local)
  if (template && template.minContextChars > 0 && inputChars < template.minContextChars) {
    route = {
      ...route,
      chain: [...route.chain].sort((a, b) => (a.kind === 'cloud' ? -1 : 1) - (b.kind === 'cloud' ? -1 : 1)),
      notes: [...route.notes, `input below minContextChars (${inputChars}<${template.minContextChars}); escalated by policy`],
    }
  }

  const ctx = opts.ctx
  let lastFailedRunId: string | null = null
  const failures: string[] = []

  for (const cand of route.chain) {
    const isMock = cand.kind === 'mock'
    if (isMock) {
      // Deterministic fixture path (Ch. 9): no network, no cost, same provenance.
      const data = mockAnswer(taskId, ctx)
      const parsed = spec.schema.safeParse(data)
      if (!parsed.success) {
        failures.push(`MOCK:${cand.model} produced invalid output`)
        continue
      }
      const run = await db.providerRun.create({
        data: {
          taskId, provider: 'MOCK', model: cand.model, promptTemplateId: template?.id ?? null,
          callId: opts.callId ?? null, status: 'OK', attempt: 1, fallbackFromId: lastFailedRunId,
          inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(JSON.stringify(data).length / 4),
          costUsd: 0, latencyMs: 2, finishedAt: new Date(),
        },
      })
      return { data: parsed.data as object, run, route }
    }

    const adapter = getChatAdapter(cand.provider)
    if (!adapter) {
      failures.push(`${cand.provider}: no adapter`)
      continue
    }

    const run: ProviderRun = await db.providerRun.create({
      data: {
        taskId, provider: cand.provider, model: cand.model, promptTemplateId: template?.id ?? null,
        callId: opts.callId ?? null, status: 'RUNNING', attempt: 1, fallbackFromId: lastFailedRunId,
      },
    })
    const started = Date.now()

    // Egress contract: cloud adapters receive pre-redacted text by construction.
    const payload =
      cand.kind === 'cloud'
        ? { system: (await redactForCloud(system)).redacted, user: (await redactForCloud(user)).redacted }
        : { system, user }

    try {
      const inTokEstimate = Math.ceil(inputChars / 4)
      if (cand.kind === 'cloud') {
        const estimatedCost = await priceFor(cand.provider, cand.model, inTokEstimate, 500)
        if (!(await authorize(estimatedCost))) {
          throw new HttpError('BUDGET_EXCEEDED', 'Cloud run refused by the ledger')
        }
      }

      let text = ''
      let inputTokens: number | undefined
      let outputTokens: number | undefined
      let attempts = 0
      let repaired = false
      let lastSchemaIssues: string | null = null

      for (let a = 1; a <= 2; a++) {
        attempts = a
        // Repair note carries the CONCRETE failure (zod issues / parse error)
        // so the model knows what to fix, not just "try harder".
        let repairNote = ''
        if (a === 2 && lastSchemaIssues) {
          repairNote = `\nYour previous response was rejected. Fix EXACTLY these problems and respond again with the full corrected JSON only - no prose, no markdown:\n${lastSchemaIssues}`
        }
        const resp = await adapter.chat({
          model: cand.model,
          system: payload.system + repairNote,
          user: payload.user,
          jsonSchema: template?.outputSchema as object | undefined,
          temperature: 0.2,
        })
        text = resp.text
        inputTokens = resp.inputTokens
        outputTokens = resp.outputTokens
        try {
          const data = extractJson(text)
          const parsed = spec.schema.safeParse(data)
          if (parsed.success) {
            if (a === 2) repaired = true
            break
          }
          const issues = parsed.error.issues
            .slice(0, 6)
            .map((i) => `- at ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
            .join('\n')
          lastSchemaIssues = issues
          failures.push(`${cand.provider}:${cand.model} schema invalid (attempt ${a}): ${issues.replace(/\n/g, ' | ').slice(0, 160)}`)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          lastSchemaIssues = `- your response was not parseable JSON: ${msg.slice(0, 160)}`
          failures.push(`${cand.provider}:${cand.model} ${(msg).slice(0, 120)}`)
        }
        if (a === 2) throw new Error('SCHEMA_INVALID after repair-retry')
      }

      const inTok = inputTokens ?? inTokEstimate
      const outTok = outputTokens ?? Math.ceil(text.length / 4)
      let costUsd = 0
      if (cand.kind === 'cloud') {
        costUsd = await priceFor(cand.provider, cand.model, inTok, outTok)
        await recordSpend({
          providerRunId: run.id,
          amountUsd: costUsd,
          costUsd,
          note: `${cand.model} ${taskId}${opts.callId ? ` for call ${opts.callId.slice(-6)}` : ''}`,
        })
      }
      const finished = await db.providerRun.update({
        where: { id: run.id },
        data: {
          status: lastFailedRunId ? 'ESCALATED' : repaired ? 'RETRIED' : 'OK',
          inputTokens: inTok, outputTokens: outTok, costUsd, latencyMs: Date.now() - started,
          finishedAt: new Date(),
        },
      })
      const data = spec.schema.parse(extractJson(text))
      return { data: data as object, run: finished, route }
    } catch (e) {
      const code = e instanceof HttpError ? e.code : e instanceof Error && e.message.startsWith('SCHEMA') ? 'SCHEMA_INVALID' : 'PROVIDER_ERROR'
      const msg = e instanceof Error ? e.message : String(e)
      await db.providerRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', errorCode: code, error: msg.slice(0, 500), latencyMs: Date.now() - started, finishedAt: new Date() },
      })
      lastFailedRunId = run.id
      if (code !== 'BUDGET_EXCEEDED') noteProviderError(cand.provider as ProviderId, msg.slice(0, 200))
      failures.push(`${cand.provider}:${cand.model} ${code}`)
      continue
    }
  }

  throw new HttpError('PROVIDER_UNAVAILABLE', `Local AI unavailable for ${taskId}. Start Ollama and install the required local models.`, { failures, routing: route.notes })
}

// ---------------- T10: embeddings (local-fixed by policy) ----------------

export interface EmbedResult {
  vectors: number[][]
  runs: ProviderRun[]
  model: string
}

export async function runEmbeds(texts: string[], opts: { callId?: string } = {}): Promise<EmbedResult> {
  const db = getDb()
  const providers = [...new Set(chainFor('embed').map((e) => e.provider))].filter((p) => p === 'OLLAMA' || p === 'MOCK') as ProviderId[]
  const [spent, cap, health, mockCard] = await Promise.all([spentThisMonth(), capUsd(), healthStateMap(providers), providerHealth('MOCK')])
  const route = planRoute({ taskId: 'T10', hint: 'embed', inputChars: texts.join('').length, routingMode: config.routingMode, budget: { spentUsd: spent, capUsd: cap }, health, mockEnabled: mockCard.up })
  const runs: ProviderRun[] = []
  const failures: string[] = []
  let lastFailedRunId: string | null = null

  for (const cand of route.chain) {
    const isMock = cand.kind === 'mock'
    const adapter = isMock ? undefined : getEmbedAdapter(cand.provider)
    if (!isMock && !adapter) continue
    const run: ProviderRun = await db.providerRun.create({
      data: { taskId: 'T10', provider: isMock ? 'MOCK' : cand.provider, model: cand.model, callId: opts.callId ?? null, status: 'RUNNING', attempt: 1, fallbackFromId: lastFailedRunId },
    })
    const started = Date.now()
    try {
      const vectors = isMock
        ? await (await import('../providers/mock')).mockEmbed.embed(texts)
        : await adapter!.embed(texts)
      const finished = await db.providerRun.update({
        where: { id: run.id },
        data: { status: lastFailedRunId ? 'ESCALATED' : 'OK', latencyMs: Date.now() - started, finishedAt: new Date(), costUsd: 0, inputTokens: Math.ceil(texts.join('').length / 4) },
      })
      runs.push(finished)
      return { vectors, runs: [...runs], model: cand.model }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await db.providerRun.update({ where: { id: run.id }, data: { status: 'FAILED', errorCode: 'PROVIDER_ERROR', error: msg.slice(0, 500), finishedAt: new Date() } })
      lastFailedRunId = run.id
      noteProviderError(cand.provider as ProviderId, msg.slice(0, 200))
      failures.push(`${cand.provider}: ${msg.slice(0, 120)}`)
    }
  }
  throw new HttpError('PROVIDER_UNAVAILABLE', 'No embedding provider available', { failures, routing: route.notes })
}

export type { Prisma, TaskContext }
