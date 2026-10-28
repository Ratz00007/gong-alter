import { NextRequest } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { getDb } from '@/lib/db'
import type { DealStage } from '@prisma/client'

export const dynamic = 'force-dynamic'

const STAGES: DealStage[] = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const deals = await db.deal.findMany({
    where: { archivedAt: null },
    include: {
      calls: { select: { id: true, title: true, status: true, occurredAt: true }, orderBy: { occurredAt: 'desc' } },
      insights: {
        where: { type: 'RISK_FLAG', status: { in: ['ACTIVE', 'CONFIRMED'] } },
        select: { title: true, content: true, dealId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      contacts: { select: { id: true, name: true, isChampion: true, isEconomicBuyer: true } },
    },
    orderBy: { lastActivityAt: 'desc' },
  })

  const byStage: Record<string, { id: string; title: string; account: string; valueCents: number | null; healthScore: number | null; riskFlags: string[]; nextStep: string | null; lastActivityAt: string; calls: number }[]> = {}
  for (const s of STAGES) byStage[s] = []
  const parked: typeof byStage['LEAD'] = []

  for (const d of deals) {
    const flags = [...new Set(d.insights.map((i) => (i.content as string).match(/^[A-Z_]+/)?.[0] ?? i.title))]
    const row = {
      id: d.id,
      title: d.title,
      account: d.account,
      valueCents: d.valueCents,
      healthScore: d.healthScore,
      riskFlags: flags,
      nextStep: d.nextStep,
      lastActivityAt: d.lastActivityAt.toISOString(),
      calls: d.calls.length,
    }
    if (d.stage === 'PARKED') parked.push(row)
    else byStage[d.stage]?.push(row)
  }

  const totalValue = deals.reduce((sum, d) => sum + (d.valueCents ?? 0), 0)
  return ok({ stages: STAGES, byStage, parked, total: { deals: deals.length, valueCents: totalValue } })
})
