// AMBER Live Assist — transcript delta intake (FR-026/027). Feeds the cue engine;
// 409 once the session is no longer LIVE.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { ingestDelta, sessionElapsedMs } from '@/lib/live/engine'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const DeltaSchema = z.object({
  text: z.string().min(1).max(4000),
  atMs: z.number().int().min(0).optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export const POST = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const parsed = DeltaSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid delta payload', parsed.error.flatten())
  const db = getDb()
  const session = await db.liveSession.findUnique({ where: { id } })
  if (!session) return notFound('Live session')
  const result = await ingestDelta(id, parsed.data.text, parsed.data.atMs)
  if (!result) return fail('PIPELINE_CONFLICT', 'Session is not LIVE', undefined, 409)
  return ok({
    sessionId: id,
    wordCount: result.session.wordCount,
    questionCount: result.session.questionCount,
    cueCount: result.session.cueCount,
    elapsedMs: sessionElapsedMs(result.session),
    fires: result.fires,
  })
})
