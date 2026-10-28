// AMBER — Ollama adapter (local first leg). ~90 LOC (NFR-08: <=150).
import { config } from '../config'
import { ProviderError, type ChatAdapter, type EmbedAdapter, type LlmRequest, type LlmResponse } from './types'

async function ollama<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${config.ollama.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new ProviderError('OLLAMA', `${path} -> ${res.status} ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export const ollamaChat: ChatAdapter = {
  id: 'OLLAMA',
  get configured() {
    return true // endpoint always configured; health decides availability
  },
  async chat(req: LlmRequest): Promise<LlmResponse> {
    const data = await ollama<{ message?: { content?: string }; prompt_eval_count?: number; eval_count?: number }>(
      '/api/chat',
      {
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        stream: false,
        format: req.jsonSchema ? 'json' : undefined,
        options: { temperature: req.temperature ?? 0.2 },
      },
      config.ollama.timeoutMs,
    )
    const text = data.message?.content ?? ''
    if (!text) throw new ProviderError('OLLAMA', 'empty response content')
    return {
      text,
      inputTokens: data.prompt_eval_count,
      outputTokens: data.eval_count,
    }
  },
}

export const ollamaEmbed: EmbedAdapter = {
  id: 'OLLAMA',
  get configured() {
    return true
  },
  async embed(texts: string[]): Promise<number[][]> {
    const data = await ollama<{ embeddings?: number[][] }>(
      '/api/embed',
      { model: config.embedModel, input: texts },
      Math.max(60_000, config.ollama.timeoutMs),
    )
    if (!data.embeddings?.length) throw new ProviderError('OLLAMA', 'no embeddings returned')
    return data.embeddings
  },
}
