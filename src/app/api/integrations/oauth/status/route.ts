import { NextRequest } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { awaitOAuth } from '@/lib/integrations/oauth'

export const dynamic = 'force-dynamic'

// Polled while the user completes sign-in in their browser.
export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const requestId = new URL(req.url).searchParams.get('requestId') ?? ''
  const status = await awaitOAuth(requestId)
  return ok(status)
})
