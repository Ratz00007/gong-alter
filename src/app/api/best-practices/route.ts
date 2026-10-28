import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, fail, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'
import { embedChunks } from '@/lib/search/embed'
import { logDealEvent } from '@/lib/timeline/assemble'

export const dynamic = 'force-dynamic'

const PromoteBody = z.object({
  fromSegmentIds: z.array(z.string()).min(1),
  title: z.string().min(3).max(200),
  category: z.enum(['Discovery', 'Objections', 'Value', 'Next steps', 'Rapport', 'Other']),
  body: z.string().min(10).max(5000),
  tags: z.array(z.string().max(40)).optional(),
})

const AcceptBody = z.object({ acceptId: z.string() })

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const raw = await req.json().catch(() => null)

  // Mode 1: accept a MODEL_SUGGESTED candidate
  const accept = AcceptBody.safeParse(raw)
  if (accept.success) {
    const candidate = await db.bestPractice.findUnique({ where: { id: accept.data.acceptId } })
    if (!candidate) return notFound('Practice candidate')
    if (candidate.origin !== 'MODEL_SUGGESTED') return fail('PIPELINE_CONFLICT', 'Only MODEL_SUGGESTED candidates can be accepted here')
    const updated = await db.bestPractice.update({ where: { id: candidate.id }, data: { status: 'ACCEPTED' } })
    await embedChunks([{ resourceType: 'BEST_PRACTICE', resourceId: updated.id, chunkIdx: 0, text: `${updated.title}: ${updated.body}` }])
    if (updated.sourceCallId) {
      const call = await db.call.findUnique({ where: { id: updated.sourceCallId }, select: { dealId: true } })
      if (call?.dealId) await logDealEvent(call.dealId, 'PRACTICE_ACCEPTED', { practiceId: updated.id, title: updated.title })
    }
    return ok({ practice: updated })
  }

  // Mode 2: user promotion from transcript selection (FR-016)
  const parsed = PromoteBody.safeParse(raw)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Provide fromSegmentIds+title+category+body, or acceptId', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))

  const segments = await db.segment.findMany({ where: { id: { in: parsed.data.fromSegmentIds } }, include: { transcript: { select: { callId: true } } } })
  if (segments.length === 0) return fail('VALIDATION_ERROR', 'fromSegmentIds do not resolve to segments')
  const callId = segments[0].transcript.callId
  const call = await db.call.findUnique({ where: { id: callId }, select: { dealId: true } })

  const practice = await db.bestPractice.create({
    data: {
      title: parsed.data.title,
      category: parsed.data.category,
      body: parsed.data.body,
      sourceCallId: callId,
      evidenceSegmentIds: parsed.data.fromSegmentIds as object,
      origin: 'USER_PROMOTED',
      status: 'ACCEPTED',
      tags: (parsed.data.tags ?? []) as object,
    },
  })
  await embedChunks([{ resourceType: 'BEST_PRACTICE', resourceId: practice.id, chunkIdx: 0, text: `${practice.title}: ${practice.body}` }])
  if (call?.dealId) await logDealEvent(call.dealId, 'PRACTICE_ACCEPTED', { practiceId: practice.id, title: practice.title })
  return ok({ practice }, { status: 201 })
})
