// AMBER Live Assist — the active LIVE session, if any (dashboard banner source).
import { NextRequest } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { getActiveSession, sessionElapsedMs } from '@/lib/live/engine'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const session = await getActiveSession()
  if (!session) return ok({ session: null })
  return ok({
    session,
    elapsedMs: sessionElapsedMs(session),
    deal: session.dealId ?? null,
  })
})
