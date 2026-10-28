// AMBER — ZAI adapter: the bundled, works-out-of-the-box cloud provider.
// Wraps z-ai-web-dev-sdk (server-only; the SDK is a backend dependency).
// Egress contract intact: this adapter is TEXT-ONLY by construction. The
// optional cloud-STT path (audio egress) lives in pipeline/stt.ts behind an
// explicit opt-in Setting — never here.
//
// Robustness: 429/5xx get exponential backoff (3 attempts); failures bubble
// up as ProviderError so the engine ladder can escalate to the next leg.
import { ProviderError, type ChatAdapter, type LlmRequest, type LlmResponse } from './types'
import { getDb } from '../db'
import { logger } from '../logger'

type ZaiClient = any

const g = globalThis as unknown as {
  __amberZaiClient?: ZaiClient | null
  __amberZaiInitAt?: number
  __amberZaiGateCache?: { value: boolean; at: number }
}

const GATE_TTL_MS = 10_000
const BACKOFF_MS = [2_500, 8_000, 20_000]
const CHAT_TIMEOUT_MS = 180_000

/** Lazy SDK singleton. Returns null when the platform SDK is unavailable
 *  (e.g. no .z-ai-config on a personal machine) — routing then skips ZAI. */
async function zaiClient(): Promise<ZaiClient | null> {
  if (g.__amberZaiClient !== undefined && Date.now() - (g.__amberZaiInitAt ?? 0) < 3_600_000) {
    return g.__amberZaiClient
  }
  try {
    // Dynamic import keeps the SDK server-only and out of the client bundle.
    const mod: any = await import('z-ai-web-dev-sdk')
    const ZAI = mod.default ?? mod
    // Static factory (loads .z-ai-config from cwd/home//etc). The raw
    // constructor leaves config undefined — never `new ZAI()` directly.
    g.__amberZaiClient = await ZAI.create()
    g.__amberZaiInitAt = Date.now()
  } catch (e) {
    logger.warn('zai adapter: SDK init failed — provider disabled', { error: e instanceof Error ? e.message : String(e) })
    g.__amberZaiClient = null
    g.__amberZaiInitAt = Date.now()
  }
  return g.__amberZaiClient
}

/** Kill switch (Setting providers.zaiEnabled, default true). Cached briefly
 *  so the routing hot path stays cheap; eval/tests pin this to false. */
export async function zaiEnabled(): Promise<boolean> {
  const hit = g.__amberZaiGateCache
  if (hit && Date.now() - hit.at < GATE_TTL_MS) return hit.value
  let value = true
  try {
    const row = await getDb().setting.findUnique({ where: { key: 'providers.zaiEnabled' } })
    value = row ? row.value === true : true
  } catch {
    value = true
  }
  g.__amberZaiGateCache = { value, at: Date.now() }
  return value
}

/** Test-hook: drop the gate cache (used by settings toggle + tests). */
export function resetZaiGateCache(): void {
  g.__amberZaiGateCache = undefined
}

function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b429\b|too many requests/i.test(msg)
}

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(429|500|502|503|504)\b|rate limit|timeout|etimedout|econnreset|fetch failed/i.test(msg)
}

async function chatWithBackoff(zai: ZaiClient, req: LlmRequest): Promise<LlmResponse> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]
      logger.info(`zai adapter: attempt ${attempt + 1} after ${wait}ms backoff`)
      await new Promise((r) => setTimeout(r, wait))
    }
    try {
      const completion = await Promise.race([
        zai.chat.completions.create({
          model: req.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 2048,
          thinking: { type: 'disabled' },
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('zai chat timeout')), CHAT_TIMEOUT_MS)),
      ])
      const text: string = completion?.choices?.[0]?.message?.content ?? ''
      if (!text) throw new ProviderError('ZAI', 'empty choices[0].message.content')
      return {
        text,
        inputTokens: completion?.usage?.prompt_tokens,
        outputTokens: completion?.usage?.completion_tokens,
      }
    } catch (e) {
      lastErr = e
      if (e instanceof ProviderError) throw e
      if (!isTransient(e)) {
        throw new ProviderError('ZAI', e instanceof Error ? e.message.slice(0, 250) : String(e))
      }
    }
  }
  const rateLimited = isRateLimit(lastErr)
  throw new ProviderError(
    'ZAI',
    `${rateLimited ? 'rate-limited' : 'transient failures'} after ${BACKOFF_MS.length + 1} attempts: ${lastErr instanceof Error ? lastErr.message.slice(0, 180) : String(lastErr)}`,
    rateLimited ? 'RATE_LIMITED' : 'PROVIDER_ERROR',
  )
}

export const zaiChat: ChatAdapter = {
  id: 'ZAI',
  get configured() {
    // Sync view for the registry; the authoritative gate is the health probe
    // (async): SDK init + Setting kill switch. Optimistic default lets the
    // probe decide; routing never trusts this alone.
    return true
  },
  async chat(req: LlmRequest): Promise<LlmResponse> {
    if (!(await zaiEnabled())) throw new ProviderError('ZAI', 'disabled by Setting providers.zaiEnabled', 'NOT_CONFIGURED')
    const zai = await zaiClient()
    if (!zai) throw new ProviderError('ZAI', 'SDK unavailable (no .z-ai-config on this machine)', 'NOT_CONFIGURED')
    return chatWithBackoff(zai, req)
  },
}

/** Health probe: tiny ping. Returns the model ids the platform exposes. */
export async function zaiProbe(): Promise<string[]> {
  const zai = await zaiClient()
  if (!zai) throw new Error('SDK unavailable')
  const completion = await Promise.race([
    zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      thinking: { type: 'disabled' },
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 12_000)),
  ])
  const text: string = completion?.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('probe returned empty content')
  const model: string = completion?.model ?? 'glm-4-plus'
  return [model, 'glm-4.6']
}

/** Cloud ASR (TEXT OUT; audio in — only reachable from the opt-in STT binding
 *  in pipeline/stt.ts, never from the task engine). Returns plain text. */
export async function zaiAsr(wavBase64: string): Promise<string> {
  const zai = await zaiClient()
  if (!zai) throw new ProviderError('ZAI', 'SDK unavailable', 'NOT_CONFIGURED')
  const res = await Promise.race([
    zai.audio.asr.create({ file_base64: wavBase64 }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('asr timeout')), 300_000)),
  ])
  const text: string = typeof res?.text === 'string' ? res.text : ''
  if (!text.trim()) throw new ProviderError('ZAI', 'asr returned empty text', 'TRANSCRIBE_EMPTY')
  return text
}
