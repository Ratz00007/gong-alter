import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const draft = await getDb().followUpDraft.findUnique({ where: { callId: id } })
  if (!draft) return notFound('Follow-up draft')
  return ok({ draft })
})
