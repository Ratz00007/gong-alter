// AMBER — OpenAI + compatible (any OpenAI-shaped endpoint: Groq, DeepSeek, Together…).
// One wire format, two adapters (NFR-08: uniform, <=150 LOC each).
import { config } from '../config'
import { ProviderError, type ChatAdapter, type EmbedAdapter, type LlmRequest, type LlmResponse } from './types'

export function makeOpenAiChat(id: 'OPENAI' | 'COMPATIBLE', baseUrl: string, apiKey: string): ChatAdapter {
  return {
    id,
    get configured() {
      return !!apiKey || (id === 'COMPATIBLE' && !!baseUrl && !!apiKey)
    },
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: req.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 2048,
          ...(req.jsonSchema
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new ProviderError(id, `chat/completions -> ${res.status} ${detail.slice(0, 200)}`)
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = data.choices?.[0]?.message?.content ?? ''
      if (!text) throw new ProviderError(id, 'empty choices[0].message.content')
      return { text, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens }
    },
  }
}

export function makeOpenAiEmbed(id: 'OPENAI' | 'COMPATIBLE', baseUrl: string, apiKey: string, defaultModel?: string): EmbedAdapter {
  return {
    id,
    get configured() {
      return !!apiKey
    },
    async embed(texts: string[], modelOverride?: string): Promise<number[][]> {
      if (texts.length === 0) return []
      const model = modelOverride || defaultModel || config.embedModel || 'text-embedding-3-small'
      const BATCH_SIZE = 64
      const allVectors: number[][] = []

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE)
        const res = await fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, input: batch }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new ProviderError(id, `embeddings -> ${res.status} ${detail.slice(0, 200)}`)
        }
        const data = (await res.json()) as { data?: { embedding: number[] }[] }
        const vectors = data.data?.map((d) => d.embedding)
        if (!vectors?.length) throw new ProviderError(id, 'no embeddings returned')
        allVectors.push(...vectors)
      }
      return allVectors
    },
  }
}

export const openaiChat: ChatAdapter = makeOpenAiChat('OPENAI', config.providers.openai.baseUrl, config.providers.openai.apiKey)
export const openaiEmbed: EmbedAdapter = makeOpenAiEmbed('OPENAI', config.providers.openai.baseUrl, config.providers.openai.apiKey)
export const compatibleChat: ChatAdapter = makeOpenAiChat('COMPATIBLE', config.providers.compatible.baseUrl || 'http://localhost:9999', config.providers.compatible.apiKey)
export const compatibleEmbed: EmbedAdapter = makeOpenAiEmbed('COMPATIBLE', config.providers.compatible.baseUrl || 'http://localhost:9999', config.providers.compatible.apiKey)
