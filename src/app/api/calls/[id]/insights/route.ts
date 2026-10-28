import { NextRequest } from 'next/server'
import { handler, collection, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'
import type { InsightStatus, InsightType } from '@prisma/client'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const url = new URL(req.url)
  const status = url.searchParams.get('status')?.split(',').filter(Boolean) as InsightStatus[] | undefined
  const type = url.searchParams.get('type')?.split(',').filter(Boolean) as InsightType[] | undefined
  const history = url.searchParams.get('history') === '1'

  const where: Record<string, unknown> = { callId: id }
  if (!history) where.status = { in: ['ACTIVE', 'CONFIRMED'] }
  else if (status?.length) where.status = { in: status }
  if (type?.length) where.type = { in: type }

  const items = await getDb().insight.findMany({ where: where as never, orderBy: { createdAt: 'asc' } })
  return collection(items, items.length)
})
