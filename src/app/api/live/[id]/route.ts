// AMBER Live Assist — session detail with fired cues (audit trail).
import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'
import { sessionElapsedMs } from '@/lib/live/engine'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const session = await db.liveSession.findUnique({
    where: { id },
    include: {
      deal: { select: { id: true, title: true } },
      call: { select: { id: true, title: true, status: true } },
      cueFires: { orderBy: { atMs: 'asc' }, include: { cue: { select: { name: true, category: true, guidance: true } } } },
    },
  })
  if (!session) return notFound('Live session')
  return ok({ ...session, elapsedMs: sessionElapsedMs(session) })
})
