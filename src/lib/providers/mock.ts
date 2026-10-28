// AMBER — deterministic mock provider (Ch. 9 testing strategy: "provider mocks
// that replay canned responses"). Enabled via Setting providers.mockEnabled for
// CI and demo installs; disable when real providers are configured. It never
// touches the network: answers are computed by mock-brain from task context.
import type { ChatAdapter, EmbedAdapter, LlmRequest, LlmResponse } from './types'
import { mockAnswer, mockEmbedVectors } from '../tasks/mock-brain'
import type { TaskContext } from '../tasks/registry'

export const mockChat: ChatAdapter = {
  id: 'MOCK',
  configured: true,
  async chat(req: LlmRequest): Promise<LlmResponse> {
    // The engine passes the structured TaskContext through the model slot.
    const ctx = (req as LlmRequest & { __ctx?: TaskContext }).__ctx
    const answer = mockAnswer(req.model.replace('amber-mock-', '').toUpperCase() as never, ctx)
    const text = JSON.stringify(answer)
    // Deterministic token accounting (chars/4) — the ledger records 0 cost for mock.
    return { text, inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: Math.ceil(text.length / 4) }
  },
}

export const mockEmbed: EmbedAdapter = {
  id: 'MOCK',
  configured: true,
  async embed(texts: string[]): Promise<number[][]> {
    return mockEmbedVectors(texts, 768)
  },
}
