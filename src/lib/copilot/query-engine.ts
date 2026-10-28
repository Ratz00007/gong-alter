// VALENCE — Voice Copilot Query Engine ("Oracle")
// Combines deterministic SQL grounding (Deals, Contacts, Events, Health) with
// semantic vector search (Transcript segments, Summaries, Insights) to synthesize
// grounded conversational answers for sales reps.
import { getDb } from '@/lib/db'
import { semanticSearch, type SearchHit } from '@/lib/search/embed'
import { runTask } from '@/lib/tasks/engine'
import { formatCurrency, type CurrencyCode } from '@/lib/format'

export interface CopilotQueryInput {
  q: string
  activeDealId?: string | null
  activeCallId?: string | null
}

export interface CopilotCitation {
  id: string
  type: 'DEAL' | 'CALL_SEGMENT' | 'CALL_SUMMARY' | 'INSIGHT' | 'CONTACT'
  title: string
  snippet: string
  url: string
  score?: number
}

export interface CopilotDealCard {
  id: string
  title: string
  account: string
  stage: string
  healthScore: number | null
  valueFormatted: string
  champion?: string | null
  economicBuyer?: string | null
  nextStep?: string | null
  nextStepDueAt?: string | null
}

export interface CopilotQueryResult {
  spokenText: string
  displayText: string
  dealCards: CopilotDealCard[]
  citations: CopilotCitation[]
  suggestedFollowUps: string[]
  matchedDealId?: string | null
}

/** Prepares response text for text-to-speech by stripping markdown, links, and raw tokens. */
export function cleanForSpeech(text: string): string {
  if (!text) return ''
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove bold/italics
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bracket citations e.g. [1], [SEGMENT:123]
    .replace(/\[(?:SEGMENT|CALL|DEAL|INSIGHT|NOTE)?:?[^\]]+\]/gi, '')
    .replace(/\[\d+\]/g, '')
    // Normalize bullets to smooth pauses
    .replace(/^[-*•]\s+/gm, '')
    // Currency pronunciation smoothing: $50k -> 50 thousand dollars
    .replace(/\$(\d+(?:\.\d+)?)\s*k\b/gi, '$1 thousand dollars')
    .replace(/€(\d+(?:\.\d+)?)\s*k\b/gi, '$1 thousand euros')
    .replace(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g, '$1 dollars')
    .replace(/€(\d+(?:,\d{3})*(?:\.\d+)?)/g, '$1 euros')
    // Normalize whitespace & newlines to natural speech pauses
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s*([.,;?!])\s*/g, '$1 ')
    .trim()
}

/** Fuzzy/Substring match for deals in the database. */
async function resolveTargetDeal(q: string, activeDealId?: string | null) {
  const db = getDb()
  const qLower = q.toLowerCase()
  const isCrossPipelineQuery = /pipeline|forecast|deals|close|closing|at risk|health/i.test(qLower)

  // Only bind to activeDealId if not explicitly asking a cross-pipeline question
  if (activeDealId && !isCrossPipelineQuery) {
    const active = await db.deal.findUnique({
      where: { id: activeDealId },
      include: { contacts: true },
    })
    if (active) return active
  }

  const allDeals = await db.deal.findMany({
    where: { archivedAt: null },
    include: { contacts: true },
    take: 100,
  })

  for (const d of allDeals) {
    const titleMatch = d.title.toLowerCase().split(/\s+/).some((w) => w.length >= 3 && qLower.includes(w))
    const accountMatch = d.account.toLowerCase().split(/\s+/).some((w) => w.length >= 3 && qLower.includes(w))
    if (titleMatch || accountMatch) {
      return d
    }
    // Also check champion/contact names
    const contactMatch = d.contacts.some((c) => {
      const parts = c.name.toLowerCase().split(/\s+/)
      return parts.some((p) => p.length >= 3 && qLower.includes(p))
    })
    if (contactMatch) return d
  }
  return null
}

export async function processCopilotQuery(input: CopilotQueryInput): Promise<CopilotQueryResult> {
  const db = getDb()
  const q = input.q.trim()
  const qLower = q.toLowerCase()

  // 1. Resolve Target Deal
  const deal = await resolveTargetDeal(q, input.activeDealId)
  const dealCards: CopilotDealCard[] = []
  const citations: CopilotCitation[] = []
  const suggestedFollowUps: string[] = []

  // 2. Gather Context: Specific Deal vs Cross-Deal
  if (deal) {
    const contacts = deal.contacts
    const champion = contacts.find((c) => c.isChampion)
    const economicBuyer = contacts.find((c) => c.isEconomicBuyer)
    const formattedVal = deal.valueCents ? formatCurrency(deal.valueCents, (deal.currency as CurrencyCode) || 'EUR') : 'Undisclosed'

    dealCards.push({
      id: deal.id,
      title: deal.title,
      account: deal.account,
      stage: deal.stage,
      healthScore: deal.healthScore,
      valueFormatted: formattedVal,
      champion: champion ? `${champion.name}${champion.title ? ` (${champion.title})` : ''}` : null,
      economicBuyer: economicBuyer ? `${economicBuyer.name}${economicBuyer.title ? ` (${economicBuyer.title})` : ''}` : null,
      nextStep: deal.nextStep,
      nextStepDueAt: deal.nextStepDueAt?.toLocaleDateString() ?? null,
    })

    citations.push({
      id: deal.id,
      type: 'DEAL',
      title: `${deal.title} (${deal.account})`,
      snippet: `Stage: ${deal.stage} · Health: ${deal.healthScore ?? 'N/A'}% · Value: ${formattedVal} · Next step: ${deal.nextStep ?? 'None recorded'}`,
      url: `#/deals/${deal.id}`,
    })

    // Fetch confirmed MEDDIC insights
    const insights = await db.insight.findMany({
      where: { dealId: deal.id, status: { in: ['ACTIVE', 'CONFIRMED'] } },
      take: 6,
      orderBy: { createdAt: 'desc' },
    })

    // Fetch recent calls
    const calls = await db.call.findMany({
      where: { dealId: deal.id },
      take: 3,
      orderBy: { occurredAt: 'desc' },
      include: { summary: true },
    })

    // 3. Semantic Vector Search for call quotes
    const searchRes = await semanticSearch(q, { dealId: deal.id }, { limit: 4, minScore: 0.20 })
    for (const h of searchRes.hits) {
      citations.push({
        id: h.id,
        type: h.resourceType === 'SEGMENT' ? 'CALL_SEGMENT' : 'CALL_SUMMARY',
        title: h.source,
        snippet: h.snippet,
        url: h.callId ? `#/inbox/${h.callId}` : `#/deals/${deal.id}`,
        score: h.score,
      })
    }

    // Compose factual summary
    let displayText = ''
    const championStr = champion ? `${champion.name} (${champion.title || 'Champion'})` : 'No champion confirmed yet'
    const buyerStr = economicBuyer ? `${economicBuyer.name} (${economicBuyer.title || 'EB'})` : 'No economic buyer confirmed'
    const healthStr = deal.healthScore !== null ? `${deal.healthScore}%` : 'Not computed'
    const nextStepStr = deal.nextStep ? `${deal.nextStep}${deal.nextStepDueAt ? ` (due ${deal.nextStepDueAt.toLocaleDateString()})` : ''}` : 'No upcoming next step recorded'

    const relevantQuotes = searchRes.hits.map((h) => `> "${h.snippet}" — [${h.source}](file:///${h.callId ? `#/inbox/${h.callId}` : ''})`).join('\n\n')

    displayText = `### ${deal.title} (${deal.account})\n\n` +
      `- **Stage & Value**: ${deal.stage} — **${formattedVal}**\n` +
      `- **Deal Health**: **${healthStr}**\n` +
      `- **Champion**: ${championStr}\n` +
      `- **Economic Buyer**: ${buyerStr}\n` +
      `- **Next Step**: ${nextStepStr}\n\n`

    if (insights.length > 0) {
      displayText += `#### MEDDIC & Strategic Signals\n`
      for (const ins of insights.slice(0, 3)) {
        displayText += `- **${ins.type.replace('MEDDIC_', '')}**: ${ins.content}\n`
      }
      displayText += '\n'
    }

    if (relevantQuotes) {
      displayText += `#### Recent Call Evidence\n${relevantQuotes}\n\n`
    }

    const spokenText = cleanForSpeech(
      `The ${deal.title} deal for ${deal.account} is currently in ${deal.stage} valued at ${formattedVal}. ` +
      `Health score is ${healthStr}. ` +
      (champion ? `Your champion is ${champion.name}. ` : '') +
      (deal.nextStep ? `Next step is ${deal.nextStep}.` : 'There is currently no next step scheduled.')
    )

    suggestedFollowUps.push(
      `Show MEDDIC gaps for ${deal.title}`,
      `Who else is involved in ${deal.account}?`,
      `Draft a follow-up email for ${deal.title}`
    )

    return {
      spokenText,
      displayText,
      dealCards,
      citations,
      suggestedFollowUps,
      matchedDealId: deal.id,
    }
  }

  // ---------------- Cross-Deal / Pipeline Query ----------------
  const isPipelineQuery = /pipeline|forecast|deals|close|closing|at risk|health/i.test(qLower)
  if (isPipelineQuery) {
    const deals = await db.deal.findMany({
      where: { archivedAt: null, stage: { notIn: ['WON', 'LOST'] } },
      orderBy: [{ healthScore: { sort: 'desc', nulls: 'last' } }, { valueCents: 'desc' }],
      take: 5,
      include: { contacts: true },
    })

    for (const d of deals) {
      const champ = d.contacts.find((c) => c.isChampion)
      dealCards.push({
        id: d.id,
        title: d.title,
        account: d.account,
        stage: d.stage,
        healthScore: d.healthScore,
        valueFormatted: d.valueCents ? formatCurrency(d.valueCents, (d.currency as CurrencyCode) || 'EUR') : 'Undisclosed',
        champion: champ?.name ?? null,
        nextStep: d.nextStep,
      })
      citations.push({
        id: d.id,
        type: 'DEAL',
        title: d.title,
        snippet: `${d.stage} · Health: ${d.healthScore ?? 'N/A'}% · ${d.valueCents ? formatCurrency(d.valueCents, (d.currency as CurrencyCode) || 'EUR') : ''}`,
        url: `#/deals/${d.id}`,
      })
    }

    const totalActive = await db.deal.count({ where: { archivedAt: null, stage: { notIn: ['WON', 'LOST'] } } })
    const displayText = `### Active Pipeline Overview\n\n` +
      `Found **${totalActive} active deals** in progress. Here are your top priority deals:\n\n` +
      deals.map((d) => `- **[${d.title}](#/deals/${d.id})** (${d.account}): ${d.stage} · Health: **${d.healthScore ?? 'N/A'}%** · ${d.valueCents ? formatCurrency(d.valueCents, (d.currency as CurrencyCode) || 'EUR') : 'Undisclosed'}`).join('\n') +
      `\n\nClick any deal card to inspect deep call transcripts or timeline activity.`

    const spokenText = cleanForSpeech(
      `You currently have ${totalActive} active deals in your pipeline. ` +
      (deals.length > 0 ? `Your top deals include ${deals[0].title} in ${deals[0].stage} and ${deals.length > 1 ? deals[1].title : ''}.` : '')
    )

    suggestedFollowUps.push(
      'Which deals have low health scores?',
      'What are my high-priority action items?',
      'Show deals closing this month'
    )

    return {
      spokenText,
      displayText,
      dealCards,
      citations,
      suggestedFollowUps,
    }
  }

  // ---------------- General Semantic Search via Vector Embeddings ----------------
  const searchResult = await semanticSearch(q, {}, { limit: 6, minScore: 0.24 })
  const usableHits = searchResult.hits.filter((h) => h.score >= 0.24)
  for (const h of usableHits) {
    citations.push({
      id: h.id,
      type: h.resourceType === 'SEGMENT' ? 'CALL_SEGMENT' : 'CALL_SUMMARY',
      title: h.source,
      snippet: h.snippet,
      url: h.callId ? `#/inbox/${h.callId}` : `#/library`,
      score: h.score,
    })
  }

  if (usableHits.length > 0) {
    // Attempt LLM Task T11 Answer with fallback
    let answer = ''
    try {
      const taskRes = await runTask('T11', {
        ctx: {
          question: q,
          minScore: 0.24,
          hits: usableHits.map((h) => ({ id: h.id, score: h.score, source: h.source, text: h.snippet })),
        },
      })
      const parsed = taskRes.data as { answer: string }
      answer = parsed.answer
    } catch {
      answer = `Based on your recorded calls, here is what was discussed regarding "${q}":\n\n` +
        usableHits.slice(0, 3).map((h) => `- ${h.snippet}`).join('\n\n')
    }

    if (answer.toLowerCase().includes("can't find") || answer.toLowerCase().includes("couldn't find")) {
      return {
        spokenText: "I couldn't find any deals or call recordings matching your query in VALENCE.",
        displayText: `### No matching information found\n\nNo deals, contacts, or transcript segments matched **"${q}"**. Try asking about an account name, pipeline health, or meeting topics.`,
        dealCards: [],
        citations: [],
        suggestedFollowUps: ['Show my active deals', 'What deals are closing this month?', 'Show recent calls'],
      }
    }

    const displayText = `### Intelligence Search\n\n${answer}\n\n#### Sources & Evidence\n` +
      usableHits.slice(0, 4).map((h) => `> "${h.snippet}" — [${h.source}](file:///${h.callId ? `#/inbox/${h.callId}` : ''})`).join('\n\n')

    const spokenText = cleanForSpeech(answer.slice(0, 350))

    suggestedFollowUps.push(
      'Summarize key objections',
      'What next steps were agreed upon?',
      'Show competitor mentions'
    )

    return {
      spokenText,
      displayText,
      dealCards: [],
      citations,
      suggestedFollowUps,
    }
  }

  // Fallback when nothing found
  return {
    spokenText: "I couldn't find any deals or call recordings matching your query in VALENCE.",
    displayText: `### No matching information found\n\nNo deals, contacts, or transcript segments matched **"${q}"**. Try asking about an account name, pipeline health, or meeting topics.`,
    dealCards: [],
    citations: [],
    suggestedFollowUps: ['Show my active deals', 'What deals are closing this month?', 'Show recent calls'],
  }
}
