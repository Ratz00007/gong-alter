import { NextRequest } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { providerHealth, allProviders } from '@/lib/providers/health'
import { catalog, chainFor, retentionFor } from '@/lib/catalog'
import type { ProviderId } from '@/lib/providers/types'

export const dynamic = 'force-dynamic'

const ALL: ProviderId[] = ['OLLAMA', 'MOCK', 'LOCAL_STT']

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'
  const cards = await Promise.all(ALL.map((p) => providerHealth(p, force)))
  // FR-021: catalog from models.yaml, never hard-coded
  const hints = (['small', 'medium', 'embed'] as const).map((hint) => ({
    hint,
    chain: chainFor(hint).map((e) => ({ provider: e.provider, model: e.model, contextTokens: e.contextTokens, pricePerMTokens: e.pricePerMTokens ?? null })),
  }))
  return ok({
    providers: cards.map((c) => ({ ...c, checkedAtIso: new Date(c.checkedAt).toISOString() })),
    catalog: { hints, retention: { OLLAMA: retentionFor('ollama'), ZAI: retentionFor('zai'), OPENAI: retentionFor('openai'), ANTHROPIC: retentionFor('anthropic'), GEMINI: retentionFor('gemini'), COMPATIBLE: retentionFor('compatible'), MOCK: retentionFor('mock') } },
    routingMode: catalog() ? undefined : undefined,
  })
})
