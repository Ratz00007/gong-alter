import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, parseJson, requireSession } from '@/lib/http'
import { beginOAuth } from '@/lib/integrations/oauth'

const Body = z.object({ provider: z.enum(['GMAIL', 'OUTLOOK']) })

// Starts the system-browser authorization flow (PKCE + loopback callback).
export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const { provider } = await parseJson(req, Body)
  const { requestId, authUrl } = await beginOAuth(provider)
  return ok({ requestId, authUrl })
})
