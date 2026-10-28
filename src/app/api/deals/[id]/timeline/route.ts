import { NextRequest } from 'next/server'
import { handler, collection, parseIntParam, requireSession } from '@/lib/http'
import { buildTimeline } from '@/lib/timeline/assemble'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const url = new URL(req.url)
  const limit = parseIntParam(url.searchParams.get('limit'), 100, 500)
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const timeline = await buildTimeline(id, limit, offset)
  return collection(timeline.items, timeline.total)
})
