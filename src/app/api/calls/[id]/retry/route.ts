import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'
import { retryCall } from '@/lib/pipeline/orchestrator'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const call = await db.call.findUnique({ where: { id } })
  if (!call) return notFound('Call')
  if (call.status !== 'FAILED') return fail('PIPELINE_CONFLICT', `Retry is only valid for a FAILED call (current: ${call.status})`, { status: call.status })
  await retryCall(id)
  const refreshed = await db.call.findUniqueOrThrow({ where: { id } })
  return ok({ call: refreshed })
})
