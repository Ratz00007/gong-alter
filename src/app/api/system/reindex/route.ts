import { NextRequest } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { enqueue } from '@/lib/jobs/queue'

export const dynamic = 'force-dynamic'

/** Re-index trigger (WO-029): embedding model switch or manual rebuild. */
export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const job = await enqueue('REINDEX', { priority: 3 })
  return ok({ queued: true, jobId: job.id }, { status: 202 })
})
