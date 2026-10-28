// AMBER Live Assist API (WO-LA4, FR-025). GET: session history. POST: start.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, collection, parseIntParam, requireSession, fail } from '@/lib/http'
import { getDb } from '@/lib/db'
import { startLiveSession, getActiveSession } from '@/lib/live/engine'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const url = new URL(req.url)
  const limit = parseIntParam(url.searchParams.get('limit'), 20)
  const items = await getDb().liveSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { deal: { select: { id: true, title: true } }, cueFires: { select: { id: true } } },
  })
  return collection(items.map((s) => ({ ...s, cueFireCount: s.cueFires.length, cueFires: undefined })), items.length)
})

const StartSchema = z.object({
  title: z.string().trim().max(120).optional(),
  dealId: z.string().trim().min(1).nullish(),
  source: z.enum(['BROWSER_MIC', 'INJECTED']).default('INJECTED'),
})

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const body = await req.json().catch(() => ({}))
  const parsed = StartSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid start payload', parsed.error.flatten())
  try {
    const session = await startLiveSession(parsed.data)
    return ok(session, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('LIVE_SESSION_EXISTS')) {
      const active = await getActiveSession()
      return fail('PIPELINE_CONFLICT', 'A live session is already running', { sessionId: active?.id }, 409)
    }
    throw e
  }
})
