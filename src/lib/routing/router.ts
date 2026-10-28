// AMBER — routing decision procedure (Table 6.4). A PURE FUNCTION: policy tier,
// payload fit, budget, provider health, preference order. No I/O, no LLM decides
// routing, and no stage knows providers exist (Ch. 6).
import { chainFor, type CatalogEntry } from '../catalog'
import { config } from '../config'

export interface RouteCandidate {
  provider: CatalogEntry['provider']
  model: string
  contextTokens: number
  reason: string
  kind: 'local' | 'cloud' | 'mock'
}

export interface RoutingInput {
  taskId: string
  hint: 'small' | 'medium' | 'large' | 'embed' | 'stt'
  inputChars: number
  /** chars -> tokens estimate divisor (4 is the standing estimate). */
  tokensPerChar?: number
  routingMode: 'LOCAL_FIRST' | 'CLOUD_FIRST' | 'LOCAL_ONLY' | 'CLOUD_ONLY'
  budget: { spentUsd: number; capUsd: number }
  /** provider -> health/configured */
  health: Record<string, { up: boolean; configured: boolean }>
  mockEnabled: boolean
}

export interface PlannedRoute {
  chain: RouteCandidate[]
  notes: string[]
  refusedByBudget: boolean
}

const CLOUD_PROVIDERS = new Set<CatalogEntry['provider']>(['OPENAI', 'ANTHROPIC', 'GEMINI', 'COMPATIBLE', 'ZAI'])

export function estimateCost(e: CatalogEntry, opts?: { inputTokens?: number; outputTokens?: number }): number {
  if (!e.pricePerMTokens) return 0
  const inp = ((opts?.inputTokens ?? 1500) / 1_000_000) * (e.pricePerMTokens.input ?? 0)
  const out = ((opts?.outputTokens ?? 500) / 1_000_000) * (e.pricePerMTokens.output ?? 0)
  return inp + out
}

function priceOf(e: CatalogEntry, opts?: { inputTokens?: number; outputTokens?: number }): number {
  return estimateCost(e, opts)
}

export function planRoute(input: RoutingInput): PlannedRoute {
  const notes: string[] = []
  const chain: RouteCandidate[] = []
  const tokensPerChar = input.tokensPerChar ?? 4
  const inputTokens = Math.ceil(input.inputChars / tokensPerChar)
  let refusedByBudget = false

  const entries = chainFor(input.hint, input.taskId)
  for (const e of entries) {
    const kind: RouteCandidate['kind'] = e.provider === 'MOCK' ? 'mock' : CLOUD_PROVIDERS.has(e.provider) ? 'cloud' : 'local'
    const reason: string[] = []

    // (1) availability: configured + health + mock gate
    const h = input.health[e.provider] ?? { up: false, configured: false }
    if (e.provider === 'MOCK' && !input.mockEnabled) {
      continue
    }
    if (e.provider !== 'MOCK' && e.provider !== 'LOCAL_STT') {
      if (!h.configured) {
        continue
      }
      if (!h.up) {
        notes.push(`${e.provider}:${e.model} skipped (unhealthy, 15-min window)`)
        continue
      }
    }

    // (2) payload fit: measured, not guessed
    if (kind !== 'mock' && e.contextTokens > 0 && inputTokens > e.contextTokens) {
      notes.push(`${e.provider}:${e.model} skipped (context overflow: ~${inputTokens}tok > ${e.contextTokens})`)
      continue
    }

    // (3) routing mode removes legs
    if (input.routingMode === 'LOCAL_ONLY' && kind === 'cloud') {
      notes.push(`${e.provider}:${e.model} removed (LOCAL_ONLY)`)
      continue
    }
    if (input.routingMode === 'CLOUD_ONLY' && kind === 'local' && input.hint !== 'stt' && input.hint !== 'embed') {
      notes.push(`${e.provider}:${e.model} removed (CLOUD_ONLY)`)
      continue
    }

    // (4) budget: cloud allowed only with headroom (hard stop otherwise)
    if (kind === 'cloud') {
      const projected = estimateCost(e, { inputTokens })
      const remaining = input.budget.capUsd - input.budget.spentUsd
      if (projected > remaining) {
        notes.push(`${e.provider}:${e.model} refused (BUDGET_EXCEEDED: projected $${projected.toFixed(3)} > remaining $${remaining.toFixed(3)})`)
        refusedByBudget = true
        reason.push('budget')
        continue
      }
    }

    chain.push({ provider: e.provider, model: e.model, contextTokens: e.contextTokens, reason: reason.join(',') || 'preference', kind })
  }

  // (5) mode ordering: CLOUD_FIRST moves cloud legs ahead of local
  if (input.routingMode === 'CLOUD_FIRST') {
    chain.sort((a, b) => (a.kind === 'cloud' ? -1 : 1) - (b.kind === 'cloud' ? -1 : 1))
  }

  return { chain, notes, refusedByBudget }
}

/** Convenience: the routing mode + budget from env/Setting resolved by the engine. */
export function routingMode(): 'LOCAL_FIRST' | 'CLOUD_FIRST' | 'LOCAL_ONLY' | 'CLOUD_ONLY' {
  return config.routingMode
}
