import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string; idx: string }> }) => {
  requireSession(req)
  const { id, idx } = await ctx.params
  const target = Number(idx)
  const transcript = await getDb().transcript.findUnique({ where: { callId: id }, include: { segments: { orderBy: { idx: 'asc' } } } })
  if (!transcript) return notFound('Transcript')
  const i = transcript.segments.findIndex((s) => s.idx === target)
  if (i < 0) return notFound('Segment')
  const window = 2
  return ok({
    focus: transcript.segments[i],
    before: transcript.segments.slice(Math.max(0, i - window), i),
    after: transcript.segments.slice(i + 1, i + 1 + window),
  })
})
