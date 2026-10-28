// AMBER — Anthropic Claude adapter. ~110 LOC.
import { config } from '../config'
import { ProviderError, type ChatAdapter, type LlmRequest, type LlmResponse } from './types'

const VERSION = '2023-06-01'

export const anthropicChat: ChatAdapter = {
  id: 'ANTHROPIC',
  get configured() {
    return !!config.providers.anthropic.apiKey
  },
  async chat(req: LlmRequest): Promise<LlmResponse> {
    const res = await fetch(`${config.providers.anthropic.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.providers.anthropic.apiKey,
        'anthropic-version': VERSION,
      },
      body: JSON.stringify({
        model: req.model,
        system: req.system,
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        messages: [{ role: 'user', content: req.user }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ProviderError('ANTHROPIC', `v1/messages -> ${res.status} ${detail.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[]
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
    if (!text) throw new ProviderError('ANTHROPIC', 'empty content text')
    return { text, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens }
  },
}
