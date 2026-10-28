import { NextRequest } from 'next/server'
import { handler, collection, parseIntParam, requireSession } from '@/lib/http'
import { activeJobs } from '@/lib/jobs/queue'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const limit = parseIntParam(new URL(req.url).searchParams.get('limit'), 50)
  const { active, recent } = await activeJobs(limit)
  return collection([...active, ...recent], active.length + recent.length)
})
