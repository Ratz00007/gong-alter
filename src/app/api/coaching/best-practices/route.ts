import { NextRequest } from 'next/server'
import { handler, collection, requireSession } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const status = url.searchParams.get('status')
  const tag = url.searchParams.get('tag')
  const q = url.searchParams.get('q')

  const where: Record<string, unknown> = {}
  if (category) where.category = category
  if (status) where.status = status
  if (q) where.OR = [{ title: { contains: q } }, { body: { contains: q } }]

  const items = await db.bestPractice.findMany({
    where: where as never,
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: { sourceCall: { select: { id: true, title: true, occurredAt: true } } },
  })
  const filtered = tag ? items.filter((p) => Array.isArray(p.tags) && (p.tags as string[]).includes(tag)) : items
  return collection(filtered, filtered.length)
})
