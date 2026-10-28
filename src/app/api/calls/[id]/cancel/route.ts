import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'
import { cancelJobsForCall } from '@/lib/jobs/queue'
import { publish } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const call = await db.call.findUnique({ where: { id } })
  if (!call) return notFound('Call')
  if (call.status === 'CANCELED') return ok({ call }) // idempotent
  if (call.status === 'ARCHIVED' || call.status === 'REVIEWED') {
    return ok({ call }) // terminal user states: nothing to cancel
  }
  await cancelJobsForCall(id)
  const before = call.status
  await db.call.update({ where: { id }, data: { status: 'CANCELED' } })
  publish('call.stage', { callId: id, from: before, to: 'CANCELED', at: new Date().toISOString() })
  const refreshed = await db.call.findUniqueOrThrow({ where: { id } })
  return ok({ call: refreshed })
})
