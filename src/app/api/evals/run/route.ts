import { NextRequest } from 'next/server'
import { handler, ok, requireSession, fail } from '@/lib/http'
import { runEvalSuite, ensureEvalCases } from '@/lib/eval/harness'

export const dynamic = 'force-dynamic'

const g = globalThis as unknown as { __amberEvalAt?: number }
g.__amberEvalAt ??= 0

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  if (Date.now() - g.__amberEvalAt! < 10_000) {
    return fail('RATE_LIMITED_LOCAL', 'Eval runs are throttled to once per 10 seconds')
  }
  g.__amberEvalAt = Date.now()
  await ensureEvalCases()
  const summary = await runEvalSuite()
  return ok(summary)
})
