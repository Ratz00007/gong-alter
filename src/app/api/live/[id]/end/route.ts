// AMBER Live Assist — end (FR-028). process=true hands the session to the
// six-stage pipeline; process=false keeps it as a record only.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { endLiveSession } from '@/lib/live/engine'
import { finalizeSession } from '@/lib/live/finalize'

export const dynamic = 'force-dynamic'

const EndSchema = z.object({ process: z.boolean().default(true) })

type Ctx = { params: Promise<{ id: string }> }

export const POST = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const parsed = EndSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid end payload', parsed.error.flatten())
  const db = (await import('@/lib/db')).getDb()
  const session = await db.liveSession.findUnique({ where: { id } })
  if (!session) return notFound('Live session')
  const result = await finalizeSession(id, { process: parsed.data.process })
  if (!result.ok && result.reason === 'TOO_SHORT') {
    return ok({ sessionId: id, callId: null, reason: 'TOO_SHORT', message: 'Under 25 words and no audio — kept as a record, no call created' })
  }
  return ok({ sessionId: id, callId: result.callId ?? null, reason: result.reason ?? null, mode: result.mode ?? null })
})
