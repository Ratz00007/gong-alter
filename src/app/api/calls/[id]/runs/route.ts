import { NextRequest } from 'next/server'
import { handler, collection, requireSession } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const runs = await getDb().providerRun.findMany({
    where: { callId: id },
    orderBy: { createdAt: 'asc' },
    include: { budgetEntry: { select: { amountUsd: true } }, fallbackFrom: { select: { id: true, provider: true, model: true, errorCode: true } } },
  })
  return collection(runs, runs.length)
})
