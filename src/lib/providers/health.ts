// AMBER — provider health with 15-minute error cache (Table 6.4 row 4, FR-021).
import { config } from '../config'
import { getDb } from '../db'
import { providerConfigured } from '../catalog'
import { zaiEnabled, zaiProbe } from './zai'
import type { ProviderId } from './types'

export interface HealthCard {
  provider: string
  up: boolean
  latencyMs: number | null
  models: string[]
  lastError: string | null
  checkedAt: number
  configured: boolean
}

type Cache = { [k: string]: { card: HealthCard; errorAt: number | null; probedAt: number } }

const g = globalThis as unknown as { __amberHealth?: Cache }
const cache: Cache = (g.__amberHealth ??= {})

const PROBE_TTL_MS = 60_000 // UI freshness
const ERROR_TTL_MS = 15 * 60_000 // routing skip window (Table 6.4)

async function probe(provider: ProviderId): Promise<HealthCard> {
  const started = Date.now()
  const wrap = async (fn: () => Promise<string[]>): Promise<HealthCard> => {
    try {
      const models = await fn()
      return { provider, up: true, latencyMs: Date.now() - started, models, lastError: null, checkedAt: Date.now(), configured: true }
    } catch (e) {
      return { provider, up: false, latencyMs: Date.now() - started, models: [], lastError: e instanceof Error ? e.message.slice(0, 200) : String(e), checkedAt: Date.now(), configured: true }
    }
  }
  switch (provider) {
    case 'OLLAMA':
      return wrap(async () => {
        const res = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
        if (!res.ok) throw new Error(`api/tags -> ${res.status}`)
        const data = (await res.json()) as { models?: { name: string }[] }
        return (data.models ?? []).map((m) => m.name)
      })
    case 'OPENAI':
      return wrap(async () => {
        const res = await fetch(`${config.providers.openai.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${config.providers.openai.apiKey}` },
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) throw new Error(`models -> ${res.status}`)
        const data = (await res.json()) as { data?: { id: string }[] }
        return (data.data ?? []).map((m) => m.id)
      })
    case 'ANTHROPIC':
      return wrap(async () => {
        const res = await fetch(`${config.providers.anthropic.baseUrl}/v1/models`, {
          headers: { 'x-api-key': config.providers.anthropic.apiKey, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) throw new Error(`v1/models -> ${res.status}`)
        const data = (await res.json()) as { data?: { id: string }[] }
        return (data.data ?? []).map((m) => m.id)
      })
    case 'GEMINI':
      return wrap(async () => {
        const res = await fetch(`${config.providers.gemini.baseUrl}/models?key=${config.providers.gemini.apiKey}`, {
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) throw new Error(`models -> ${res.status}`)
        const data = (await res.json()) as { models?: { name: string }[] }
        return (data.models ?? []).map((m) => m.name.replace(/^models\//, ''))
      })
    case 'COMPATIBLE':
      return wrap(async () => {
        if (!config.providers.compatible.baseUrl) throw new Error('not configured')
        const res = await fetch(`${config.providers.compatible.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${config.providers.compatible.apiKey}` },
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) throw new Error(`models -> ${res.status}`)
        const data = (await res.json()) as { data?: { id: string }[] }
        return (data.data ?? []).map((m) => m.id)
      })
    case 'ZAI':
      return wrap(async () => {
        if (!(await zaiEnabled())) throw new Error('disabled by Setting providers.zaiEnabled')
        return zaiProbe()
      })
    case 'MOCK': {
      const enabled = await mockEnabled()
      return { provider, up: enabled, latencyMs: 0, models: enabled ? ['amber-mock-small', 'amber-mock-medium', 'amber-mock-embed'] : [], lastError: null, checkedAt: Date.now(), configured: enabled }
    }
    case 'LOCAL_STT': {
      const { spawnSync } = await import('node:child_process')
      if (config.stt.binding !== 'whisper') {
        return { provider, up: false, latencyMs: null, models: [], lastError: 'Scripted demo mode; configure WHISPER_BINDING=whisper for real transcription', checkedAt: Date.now(), configured: false }
      }
      const result = spawnSync('whisper-ctranslate2', ['--help'], { timeout: 5000, stdio: 'ignore', windowsHide: true })
      const up = result.status === 0
      return { provider, up, latencyMs: Date.now() - started, models: up ? [`whisper-${config.stt.model}`] : [], lastError: up ? null : 'whisper-ctranslate2 is unavailable', checkedAt: Date.now(), configured: true }
    }
  }
}

async function mockEnabled(): Promise<boolean> {
  // Only explicitly launched tests/evaluations may use fixture inference.
  if (process.env.NODE_ENV !== 'test') return false
  try {
    const row = await getDb().setting.findUnique({ where: { key: 'providers.mockEnabled' } })
    return row ? row.value === true : true
  } catch {
    return true
  }
}

export async function providerHealth(provider: ProviderId, force = false): Promise<HealthCard> {
  const now = Date.now()
  const hit = cache[provider]
  if (hit && !force) {
    const fresh = now - hit.probedAt < PROBE_TTL_MS
    const inErrorWindow = hit.errorAt !== null && now - hit.errorAt < ERROR_TTL_MS
    if (fresh || inErrorWindow) return hit.card
  }
  if (!providerConfigured(provider)) {
    const card: HealthCard = { provider, up: false, latencyMs: null, models: [], lastError: 'not configured (no key/endpoint)', checkedAt: now, configured: false }
    cache[provider] = { card, errorAt: card.up ? null : now, probedAt: now }
    return card
  }
  const card = await probe(provider)
  cache[provider] = { card, errorAt: card.up ? null : now, probedAt: now }
  return card
}

export async function providerHealthCached(provider: string): Promise<HealthCard> {
  return providerHealth(provider as ProviderId)
}

/** Routing input: health map for the candidates being planned (15-min skip rule). */
export async function healthStateMap(providers: ProviderId[]): Promise<Record<string, { up: boolean; configured: boolean }>> {
  const out: Record<string, { up: boolean; configured: boolean }> = {}
  await Promise.all(
    providers.map(async (p) => {
      const card = await providerHealth(p)
      out[p] = { up: card.up, configured: card.configured }
    }),
  )
  return out
}

export function allProviders(): HealthCard[] {
  return Object.values(cache).map((c) => c.card)
}

/** Engine signal: an adapter failed; skip this provider for 15 minutes (Table 6.4). */
export function noteProviderError(provider: ProviderId, message: string): void {
  const hit = cache[provider]
  const now = Date.now()
  if (hit) {
    hit.card = { ...hit.card, up: false, lastError: message.slice(0, 200), checkedAt: now }
    hit.errorAt = now
    hit.probedAt = now
  } else {
    const card: HealthCard = { provider, up: false, latencyMs: null, models: [], lastError: message.slice(0, 200), checkedAt: now, configured: true }
    cache[provider] = { card, errorAt: now, probedAt: now }
  }
}
