// AMBER — model catalog loader (Ch. 11 models.yaml). Resolves hints to concrete chains.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { config } from './config'
import type { ProviderId } from './providers/types'

export interface CatalogEntry {
  provider: ProviderId
  model: string
  contextTokens: number
  dim?: number
  pricePerMTokens?: { input: number; output: number }
}

export type Hint = 'small' | 'medium' | 'large' | 'embed' | 'stt' | 'tts'

interface CatalogFile {
  catalog: Record<Hint, { provider: string; model: string; contextTokens: number; dim?: number; pricePerMTokens?: { input: number; output: number } }[]>
  overrides: Record<string, { only?: string[] }>
  retention: Record<string, string>
}

const g = globalThis as unknown as { __amberCatalog?: CatalogFile }

function load(): CatalogFile {
  if (g.__amberCatalog) return g.__amberCatalog
  const raw = readFileSync(join(process.cwd(), 'config', 'models.yaml'), 'utf8')
  const parsed = parseYaml(raw) as CatalogFile
  g.__amberCatalog = parsed
  return parsed
}

export function catalog(): CatalogFile {
  return load()
}

/** Preference chain for a hint, with per-task overrides applied. Providers are
 *  normalized to the uppercase enum (models.yaml stays lowercase data). */
export function chainFor(hint: Hint, taskId?: string): CatalogEntry[] {
  const cat = load()
  let entries = (cat.catalog[hint] ?? []).map((e) => ({ ...e, provider: e.provider.toUpperCase() as ProviderId }))
  if (taskId) {
    const ov = cat.overrides?.[taskId]
    if (ov?.only) {
      entries = entries.filter((e) => ov.only!.includes(e.provider.toLowerCase()))
    }
  }
  return entries
}

export function retentionFor(provider: string): string {
  return load().retention?.[provider] ?? 'unknown'
}

/** Live capability view: which providers are configured (keys/endpoints present). */
export function providerConfigured(provider: ProviderId): boolean {
  switch (provider) {
    case 'OLLAMA': return true // endpoint always configured; health decides
    case 'OPENAI': return !!config.providers.openai.apiKey
    case 'ANTHROPIC': return !!config.providers.anthropic.apiKey
    case 'GEMINI': return !!config.providers.gemini.apiKey
    case 'COMPATIBLE': return !!config.providers.compatible.baseUrl
    case 'ZAI': return true // platform SDK; health probe + Setting gate decide at runtime
    case 'MOCK': return true // gated at runtime by Setting providers.mockEnabled
    case 'LOCAL_STT': return true
  }
}
