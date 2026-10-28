// VALENCE Agent API v1 — Deal Detail (Get & Update)
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { z } from 'zod'

const updateDealSchema = z.object({
  title: z.string().optional(),
  stage: z.enum(['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED']).optional(),
  valueCents: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  healthScore: z.number().int().min(0).max(100).optional(),
  nextStep: z.string().optional(),
  expectedCloseAt: z.string().optional().transform((v) => (v ? new Date(v) : undefined)),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = getDb()
  const { id } = await params

  const deal = await db.deal.findUnique({
    where: { id },
    include: {
      contacts: true,
      calls: {
        include: {
          summary: true,
          scorecard: true,
          insights: { where: { status: 'ACTIVE' } },
        },
        orderBy: { occurredAt: 'desc' },
      },
      emailMessages: {
        orderBy: { sentAt: 'desc' },
        take: 20,
      },
      events: {
        orderBy: { occurredAt: 'desc' },
        take: 30,
      },
      insights: { where: { status: 'ACTIVE' } },
      notes: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!deal) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } }, { status: 404 })
  }

  return NextResponse.json({ deal })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = getDb()
  const { id } = await params

  try {
    const body = await req.json()
    const parsed = updateDealSchema.parse(body)

    const updated = await db.deal.update({
      where: { id },
      data: parsed,
    })

    return NextResponse.json({ ok: true, deal: updated })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'UPDATE_FAILED', message: e instanceof Error ? e.message : 'Update failed' } },
      { status: 400 },
    )
  }
}
