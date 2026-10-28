import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, collection, requireSession, fail } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CreateBody = z.object({
  dealId: z.string().min(1),
  name: z.string().min(1).max(200),
  title: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  isChampion: z.boolean().optional(),
  isEconomicBuyer: z.boolean().optional(),
})

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const url = new URL(req.url)
  const dealId = url.searchParams.get('dealId') ?? undefined
  const q = url.searchParams.get('q') ?? undefined
  const where: Record<string, unknown> = {}
  if (dealId) where.dealId = dealId
  if (q) where.name = { contains: q }
  const items = await db.contact.findMany({
    where: where as never,
    orderBy: { createdAt: 'asc' },
    include: { deal: { select: { id: true, title: true, account: true } } },
  })
  return collection(items, items.length)
})

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const parsed = CreateBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid contact', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const deal = await db.deal.findUnique({ where: { id: parsed.data.dealId } })
  if (!deal) return fail('NOT_FOUND', 'Deal does not exist')
  const contact = await db.contact.create({
    data: {
      dealId: parsed.data.dealId,
      name: parsed.data.name,
      title: parsed.data.title ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      notes: parsed.data.notes ?? null,
      isChampion: parsed.data.isChampion ?? false,
      isEconomicBuyer: parsed.data.isEconomicBuyer ?? false,
    },
  })
  return ok({ contact }, { status: 201 })
})
