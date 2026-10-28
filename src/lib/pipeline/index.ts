// AMBER — index stage (S7, WO-029): embed segments, rolling 3-segment windows,
// summary, notes, confirmed insights. Embedding failure is NON-BLOCKING: the call
// reaches READY and the job records the warning (Table 3.1 S7).
import { getDb } from '../db'
import { embedChunks, type Chunk } from '../search/embed'

export interface IndexOutcome {
  stored: number
}

export async function runIndexStage(callId: string): Promise<IndexOutcome> {
  const db = getDb()
  const call = await db.call.findUnique({
    where: { id: callId },
    include: {
      transcript: { include: { segments: true } },
      summary: true,
      notes: true,
    },
  })
  if (!call) throw new Error('INDEX_FAILED: call not found')

  const chunks: Chunk[] = []
  const ordered = call.transcript ? [...call.transcript.segments].sort((a, b) => a.idx - b.idx) : []

  for (const s of ordered) {
    chunks.push({ resourceType: 'SEGMENT', resourceId: s.id, chunkIdx: 0, text: `${s.speaker}: ${s.text}` })
  }
  // Rolling 3-segment windows so matches can surface cross-boundary context.
  for (let i = 0; i + 2 < ordered.length; i++) {
    const text = ordered.slice(i, i + 3).map((s) => `${s.speaker}: ${s.text}`).join('\n')
    chunks.push({ resourceType: 'SEGMENT_WINDOW', resourceId: ordered[i].id, chunkIdx: 0, text })
  }
  if (call.summary) {
    chunks.push({ resourceType: 'CALL_SUMMARY', resourceId: call.id, chunkIdx: 0, text: call.summary.summary })
  }
  for (const n of call.notes) {
    chunks.push({ resourceType: 'NOTE', resourceId: n.id, chunkIdx: 0, text: n.body })
  }
  const confirmed = await db.insight.findMany({ where: { callId: call.id, status: 'CONFIRMED' } })
  for (const ins of confirmed) {
    chunks.push({ resourceType: 'INSIGHT', resourceId: ins.id, chunkIdx: 0, text: `${ins.title}: ${ins.content}` })
  }

  if (chunks.length === 0) return { stored: 0 }
  const { stored } = await embedChunks(chunks, call.id)
  return { stored }
}

/** Re-index all analyzed calls (embedding model switch, Ch. 10). */
export async function runReindexAll(): Promise<{ calls: number; stored: number }> {
  const db = getDb()
  const calls = await db.call.findMany({ where: { status: { in: ['READY', 'REVIEWED'] } }, select: { id: true } })
  let stored = 0
  for (const c of calls) {
    const r = await runIndexStage(c.id)
    stored += r.stored
  }
  return { calls: calls.length, stored }
}
