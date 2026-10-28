// AMBER — Google Gemini adapter. ~110 LOC.
import { config } from '../config'
import { ProviderError, type ChatAdapter, type LlmRequest, type LlmResponse } from './types'

export const geminiChat: ChatAdapter = {
  id: 'GEMINI',
  get configured() {
    return !!config.providers.gemini.apiKey
  },
  async chat(req: LlmRequest): Promise<LlmResponse> {
    const url = `${config.providers.gemini.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent?key=${config.providers.gemini.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxTokens ?? 2048,
          ...(req.jsonSchema ? { responseMimeType: 'application/json', responseSchema: req.jsonSchema } : {}),
        },
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ProviderError('GEMINI', `generateContent -> ${res.status} ${detail.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (!text) throw new ProviderError('GEMINI', 'empty candidates content')
    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    }
  },
}
