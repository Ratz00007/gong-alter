// AMBER — uniform provider adapter interface (Ch. 6). Adapters accept TEXT ONLY:
// the egress contract is enforced by construction (audio/bytes never typed here).
export type ProviderId = 'OLLAMA' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'COMPATIBLE' | 'ZAI' | 'MOCK' | 'LOCAL_STT'

export interface LlmRequest {
  /** Concrete model id from the catalog chain (models.yaml); adapters never guess. */
  model: string
  system: string
  user: string
  /** JSON schema the response must satisfy; adapters pass it through where the
   *  upstream API supports structured output (mock uses it to self-check). */
  jsonSchema?: object
  temperature?: number
  maxTokens?: number
}

export interface LlmResponse {
  text: string
  inputTokens?: number
  outputTokens?: number
}

export interface ChatAdapter {
  id: ProviderId
  configured: boolean
  chat(req: LlmRequest): Promise<LlmResponse>
}

export interface EmbedAdapter {
  id: ProviderId
  configured: boolean
  embed(texts: string[]): Promise<number[][]>
}

export class ProviderError extends Error {
  constructor(public provider: ProviderId, message: string, public code: string = 'PROVIDER_ERROR') {
    super(`[${provider}] ${message}`)
  }
}
