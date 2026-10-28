// VALENCE Agent API v1 — Deals (List & Create)
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { z } from 'zod'

const createDealSchema = z.object({
  title: z.string().min(1),
  account: z.string().min(1),
  stage: z.enum(['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED']).default('QUALIFIED'),
  valueCents: z.number().int().nonnegative().optional(),
  currency: z.string().default('USD'),
  healthScore: z.number().int().min(0).max(100).optional(),
  nextStep: z.string().optional(),
  contacts: z
    .array(
      z.object({
        name: z.string().min(1),
        title: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        isChampion: z.boolean().default(false),
        isEconomicBuyer: z.boolean().default(false),
      }),
    )
    .optional(),
})

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const stage = searchParams.get('stage')
  const minHealth = searchParams.get('minHealth')
  const search = searchParams.get('search')

  const where: Record<string, unknown> = { archivedAt: null }
  if (stage) where.stage = stage
  if (minHealth) where.healthScore = { gte: Number(minHealth) }
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { account: { contains: search } },
    ]
  }

  const items = await db.deal.findMany({
    where,
    orderBy: { lastActivityAt: 'desc' },
    include: {
      contacts: true,
      _count: { select: { calls: true, emailMessages: true, insights: true } },
    },
  })

  return NextResponse.json({
    total: items.length,
    deals: items.map((d) => ({
      id: d.id,
      title: d.title,
      account: d.account,
      stage: d.stage,
      valueCents: d.valueCents,
      currency: d.currency,
      healthScore: d.healthScore,
      nextStep: d.nextStep,
      lastActivityAt: d.lastActivityAt,
      contacts: d.contacts,
      callCount: d._count.calls,
      emailCount: d._count.emailMessages,
      insightCount: d._count.insights,
    })),
  })
}

export async function POST(req: NextRequest) {
  const db = getDb()
  try {
    const body = await req.json()
    const parsed = createDealSchema.parse(body)

    const deal = await db.deal.create({
      data: {
        title: parsed.title,
        account: parsed.account,
        stage: parsed.stage,
        valueCents: parsed.valueCents ?? null,
        currency: parsed.currency,
        healthScore: parsed.healthScore ?? 75,
        nextStep: parsed.nextStep ?? null,
        contacts: parsed.contacts?.length
          ? {
              create: parsed.contacts.map((c) => ({
                name: c.name,
                title: c.title ?? null,
                email: c.email ?? null,
                phone: c.phone ?? null,
                isChampion: c.isChampion,
                isEconomicBuyer: c.isEconomicBuyer,
              })),
            }
          : undefined,
      },
      include: { contacts: true },
    })

    return NextResponse.json({ ok: true, deal })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'INVALID_DEAL', message: e instanceof Error ? e.message : 'Invalid deal data' } },
      { status: 400 },
    )
  }
}
