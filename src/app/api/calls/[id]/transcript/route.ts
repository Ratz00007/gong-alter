import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const transcript = await getDb().transcript.findUnique({
    where: { callId: id },
    include: { segments: { orderBy: { idx: 'asc' } } },
  })
  if (!transcript) return notFound('Transcript')
  return ok({ transcript })
})
