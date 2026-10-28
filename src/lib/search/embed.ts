// AMBER — embeddings + brute-force cosine search (Ch. 3 Library spec, FR-018/019).
// Vectors are Float32 BLOBs in the Embedding table; chunks are deduplicated by
// (resourceType, resourceId, chunkIdx); deletion removes vectors with the source.
import { getDb } from '../db'
import { runEmbeds } from '../tasks/engine'
import { config } from '../config'

export type ResourceType = 'SEGMENT' | 'SEGMENT_WINDOW' | 'CALL_SUMMARY' | 'NOTE' | 'BEST_PRACTICE' | 'INSIGHT'

export interface Chunk {
  resourceType: ResourceType
  resourceId: string
  chunkIdx: number
  text: string
}

export async function embedChunks(chunks: Chunk[], callId?: string): Promise<{ stored: number; model: string }> {
  if (chunks.length === 0) return { stored: 0, model: config.embedModel }
  const { vectors, model } = await runEmbeds(chunks.map((c) => c.text), { callId })
  const db = getDb()
  // Delete-then-insert keyed by (resourceType, resourceId): rebuildable source.
  const byResource = new Map<string, { c: Chunk; i: number }[]>()
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const key = `${c.resourceType}:${c.resourceId}`
    byResource.set(key, [...(byResource.get(key) ?? []), { c, i }])
  }
  let stored = 0
  for (const [key, group] of byResource) {
    const [resourceType, resourceId] = key.split(':') as [ResourceType, string]
    await db.embedding.deleteMany({ where: { resourceType, resourceId } })
    for (const { c, i } of group) {
      const vec = vectors[i]
      if (!vec) continue
      await db.embedding.create({
        data: {
          resourceType,
          resourceId,
          chunkIdx: c.chunkIdx,
          text: c.text,
          model,
          dim: vec.length,
          vector: Buffer.from(new Float32Array(vec).buffer),
        },
      })
      stored++
    }
  }
  return { stored, model }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

export interface SearchFilters {
  dealId?: string
  contactId?: string
  from?: string // ISO
  to?: string
  speaker?: 'REP' | 'PROSPECT' | 'UNKNOWN'
}

export interface SearchHit {
  id: string
  resourceType: ResourceType
  resourceId: string
  callId: string | null
  score: number
  snippet: string
  source: string
  occurredAt?: string
  speaker?: string
}

/** Resolve resource -> callId maps once per search (ids only; fast at personal scale). */
async function buildCallMaps(db: ReturnType<typeof getDb>) {
  const transcripts = await db.transcript.findMany({ select: { id: true, callId: true } })
  const transcriptToCall = new Map(transcripts.map((t) => [t.id, t.callId]))
  const segmentRows = await db.segment.findMany({ select: { id: true, transcriptId: true, speaker: true } })
  const segmentToTranscript = new Map(segmentRows.map((s) => [s.id, s.transcriptId]))
  const segmentSpeaker = new Map(segmentRows.map((s) => [s.id, s.speaker as string]))
  const insights = await db.insight.findMany({ select: { id: true, callId: true } })
  const insightToCall = new Map(insights.map((i) => [i.id, i.callId]))
  const practices = await db.bestPractice.findMany({ select: { id: true, sourceCallId: true } })
  const practiceToCall = new Map(practices.map((p) => [p.id, p.sourceCallId]))
  const summaryToCall = new Map((await db.callSummary.findMany({ select: { callId: true } })).map((s) => [s.callId, s.callId]))
  const noteToCall = new Map((await db.note.findMany({ where: { callId: { not: null } }, select: { id: true, callId: true } })).map((n) => [n.id, n.callId as string]))
  const calls = await db.call.findMany({ select: { id: true, dealId: true, contactId: true, occurredAt: true, title: true } })
  const callById = new Map(calls.map((c) => [c.id, c]))
  return { transcriptToCall, segmentToTranscript, segmentSpeaker, insightToCall, practiceToCall, summaryToCall, noteToCall, callById }
}

function callIdOf(hit: { resourceType: ResourceType; resourceId: string }, maps: Awaited<ReturnType<typeof buildCallMaps>>): string | null {
  switch (hit.resourceType) {
    case 'SEGMENT':
    case 'SEGMENT_WINDOW':
      return maps.transcriptToCall.get(maps.segmentToTranscript.get(hit.resourceId) ?? '') ?? null
    case 'CALL_SUMMARY':
      return maps.summaryToCall.get(hit.resourceId) ?? null
    case 'NOTE':
      return maps.noteToCall.get(hit.resourceId) ?? null
    case 'INSIGHT':
      return maps.insightToCall.get(hit.resourceId) ?? null
    case 'BEST_PRACTICE':
      return maps.practiceToCall.get(hit.resourceId) ?? null
  }
}

export interface SearchOptions {
  limit?: number
  minScore?: number
}

export async function semanticSearch(query: string, filters: SearchFilters, opts: SearchOptions = {}): Promise<{ hits: SearchHit[]; degraded: boolean; model: string | null }> {
  const db = getDb()
  const maps = await buildCallMaps(db)

  // allowed call set from filters (filter first, then rank)
  let allowed: Set<string> | null = null
  if (filters.dealId || filters.contactId || filters.from || filters.to || filters.speaker) {
    allowed = new Set()
    for (const call of maps.callById.values()) {
      if (filters.dealId && call.dealId !== filters.dealId) continue
      if (filters.contactId && call.contactId !== filters.contactId) continue
      if (filters.from && call.occurredAt < new Date(filters.from)) continue
      if (filters.to && call.occurredAt > new Date(filters.to)) continue
      allowed.add(call.id)
    }
  }

  const minScore = opts.minScore ?? 0.24
  const limit = opts.limit ?? 50

  // query vector
  let queryVec: Float32Array | null = null
  let model: string | null = null
  let degraded = false
  try {
    const { vectors, model: m } = await runEmbeds([query])
    queryVec = new Float32Array(vectors[0])
    model = m
  } catch {
    degraded = true
  }

  // most recent embedding model rows only (model switch -> re-index; Ch. 10)
  const rows = model
    ? await db.embedding.findMany({ where: { model }, orderBy: { createdAt: 'desc' } })
    : []

  const scored: SearchHit[] = []
  if (queryVec) {
    for (const row of rows) {
      const callId = callIdOf({ resourceType: row.resourceType as ResourceType, resourceId: row.resourceId }, maps)
      if (allowed && (!callId || !allowed.has(callId))) continue
      if (filters.speaker && row.resourceType === 'SEGMENT' && maps.segmentSpeaker.get(row.resourceId) !== filters.speaker) continue
      if (filters.speaker && row.resourceType !== 'SEGMENT') continue
      const vec = new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength))
      const score = cosine(queryVec, vec)
      if (score < minScore) continue
      scored.push({
        id: `${row.resourceType}:${row.resourceId}`,
        resourceType: row.resourceType as ResourceType,
        resourceId: row.resourceId,
        callId,
        score: Math.round(score * 1000) / 1000,
        snippet: row.text.slice(0, 240),
        source: labelFor(row.resourceType as ResourceType, maps),
        occurredAt: callId ? maps.callById.get(callId)?.occurredAt.toISOString() : undefined,
      })
    }
  }

  // lexical fallback / quoted-phrase merge: substring pass on the query
  const q = query.toLowerCase().trim()
  if (q) {
    const seenIds = new Set(scored.map((s) => s.id))
    const substrHits = await lexicalPass(q, maps, allowed, filters, minScore, rows)
    for (const h of substrHits) {
      if (!seenIds.has(h.id)) {
        seenIds.add(h.id)
        scored.push(h)
      }
    }
  }

  // rank: cosine then recency tiebreak
  scored.sort((a, b) => b.score - a.score || (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))
  return { hits: scored.slice(0, limit), degraded, model }
}

const LEXICAL_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but',
  'is', 'are', 'was', 'were', 'be', 'been', 'did', 'do', 'does', 'what', 'how',
  'when', 'where', 'who', 'why', 'they', 'them', 'their', 'we', 'our', 'you',
  'your', 'it', 'its', 'that', 'this', 'with', 'from', 'by', 'about', 'say', 'said',
])

async function lexicalPass(
  q: string,
  maps: Awaited<ReturnType<typeof buildCallMaps>>,
  allowed: Set<string> | null,
  filters: SearchFilters,
  minScore: number,
  preloadedRows?: { resourceType: string; resourceId: string; text: string }[],
): Promise<SearchHit[]> {
  const db = getDb()
  const rows =
    preloadedRows && preloadedRows.length > 0
      ? preloadedRows
      : await db.embedding.findMany({
          select: { resourceType: true, resourceId: true, text: true },
          orderBy: { createdAt: 'desc' },
        })
  const hits: SearchHit[] = []
  const queryLower = q.toLowerCase().trim()
  const allTokens = queryLower
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const contentTerms = allTokens.filter((t) => t.length >= 3 && !LEXICAL_STOPWORDS.has(t))
  const terms = contentTerms.length > 0 ? contentTerms : allTokens
  if (terms.length === 0) return hits

  for (const row of rows) {
    const rt = row.resourceType as ResourceType
    const callId = callIdOf({ resourceType: rt, resourceId: row.resourceId }, maps)
    if (allowed && (!callId || !allowed.has(callId))) continue
    if (filters.speaker && rt === 'SEGMENT' && maps.segmentSpeaker.get(row.resourceId) !== filters.speaker) continue
    if (filters.speaker && rt !== 'SEGMENT') continue
    const text = row.text.toLowerCase()

    const matchedTerms = terms.filter((t) => text.includes(t)).length
    if (matchedTerms === 0) continue
    const coverage = matchedTerms / terms.length
    const exactMatch = text.includes(queryLower)
    if (!exactMatch && coverage < 0.5) continue

    const exactBonus = exactMatch ? 0.25 : 0
    const rawScore = 0.15 + 0.5 * coverage + exactBonus
    if (rawScore < minScore) continue
    const score = Math.min(0.99, rawScore)

    hits.push({
      id: `${rt}:${row.resourceId}`,
      resourceType: rt,
      resourceId: row.resourceId,
      callId,
      score: Math.round(score * 1000) / 1000,
      snippet: row.text.slice(0, 240),
      source: labelFor(rt, maps),
      occurredAt: callId ? maps.callById.get(callId)?.occurredAt.toISOString() : undefined,
    })
  }
  return hits
}

function labelFor(rt: ResourceType, maps: Awaited<ReturnType<typeof buildCallMaps>>): string {
  switch (rt) {
    case 'SEGMENT':
    case 'SEGMENT_WINDOW':
      return 'Transcript segment'
    case 'CALL_SUMMARY':
      return 'Call summary'
    case 'NOTE':
      return 'Note'
    case 'BEST_PRACTICE':
      return 'Best practice'
    case 'INSIGHT':
      return 'Confirmed insight'
  }
}

export async function embeddingStats(): Promise<{ vectors: number; models: { model: string; count: number }[] }> {
  const db = getDb()
  const rows = await db.embedding.groupBy({ by: ['model'], _count: { model: true } })
  const total = await db.embedding.count()
  return { vectors: total, models: rows.map((r) => ({ model: r.model, count: r._count.model })) }
}
