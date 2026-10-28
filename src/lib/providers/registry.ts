// AMBER — adapter registry: provider id -> concrete adapter singletons.
import type { ProviderId } from './types'
import type { ChatAdapter, EmbedAdapter } from './types'
import { ollamaChat, ollamaEmbed } from './ollama'
import { openaiChat, openaiEmbed, compatibleChat, compatibleEmbed } from './openai'
import { anthropicChat } from './anthropic'
import { geminiChat } from './gemini'
import { mockChat, mockEmbed } from './mock'
import { zaiChat } from './zai'

const chatAdapters: Partial<Record<ProviderId, ChatAdapter>> = {
  OLLAMA: ollamaChat,
  OPENAI: openaiChat,
  ANTHROPIC: anthropicChat,
  GEMINI: geminiChat,
  COMPATIBLE: compatibleChat,
  ZAI: zaiChat,
  MOCK: mockChat,
}

const embedAdapters: Partial<Record<ProviderId, EmbedAdapter>> = {
  OLLAMA: ollamaEmbed,
  OPENAI: openaiEmbed,
  COMPATIBLE: compatibleEmbed,
  MOCK: mockEmbed,
}

export function getChatAdapter(p: ProviderId): ChatAdapter | undefined {
  return chatAdapters[p]
}

export function getEmbedAdapter(p: ProviderId): EmbedAdapter | undefined {
  return embedAdapters[p]
}
