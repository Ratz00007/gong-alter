import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, fail } from '@/lib/http'
import { processCopilotQuery } from '@/lib/copilot/query-engine'

export const dynamic = 'force-dynamic'

const Body = z.object({
  q: z.string().trim().min(1).max(500),
  activeDealId: z.string().optional().nullable(),
  activeCallId: z.string().optional().nullable(),
})

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const json = await req.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return fail('VALIDATION_ERROR', 'Invalid query request', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }

  const result = await processCopilotQuery({
    q: parsed.data.q,
    activeDealId: parsed.data.activeDealId,
    activeCallId: parsed.data.activeCallId,
  })

  return ok(result)
})
