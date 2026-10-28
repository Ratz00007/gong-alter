import { NextRequest } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { spendDashboard } from '@/lib/budget/ledger'
import { publish } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const dashboard = await spendDashboard()
  if (dashboard.percent >= 70) {
    publish('budget.warning', { spentUsd: dashboard.spentUsd, capUsd: dashboard.capUsd, percent: dashboard.percent })
  }
  return ok(dashboard)
})
