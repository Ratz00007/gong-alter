// AMBER — budget ledger (Ch. 6): the monthly cap is enforced at the transaction
// that records spend (NFR-06). Local and mock runs write nothing.
import { getDb } from '../db'
import { HttpError } from '../http'
import { logger } from '../logger'

export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function capUsd(): Promise<number> {
  const row = await getDb().setting.findUnique({ where: { key: 'budget.monthlyCapUsd' } })
  const v = row?.value
  return typeof v === 'number' ? v : 5
}

export async function currentSpendUsd(month = monthKey()): Promise<number> {
  const db = getDb()
  const agg = await db.budgetEntry.aggregate({
    where: { month },
    _sum: { amountUsd: true },
  })
  return agg._sum.amountUsd ?? 0
}

export const spentThisMonth = currentSpendUsd

/** Conservative pre-flight check the engine runs before any cloud call. */
export async function authorize(projectedUsd: number, month = monthKey()): Promise<boolean> {
  const [spent, cap] = await Promise.all([currentSpendUsd(month), capUsd()])
  return spent + projectedUsd <= cap
}

export interface RecordInput {
  providerRunId: string
  amountUsd?: number
  costUsd?: number
  note?: string
}

/** Records spend transactionally; the final guard is here (hard stop, FR-022). */
export async function recordSpend(
  { providerRunId, amountUsd, costUsd, note }: RecordInput,
  month = monthKey(),
): Promise<{ runningTotalUsd: number; costUsd: number }> {
  const cost = costUsd ?? amountUsd ?? 0
  const db = getDb()
  return db.$transaction(async (tx) => {
    const agg = await tx.budgetEntry.aggregate({
      where: { month },
      _sum: { amountUsd: true },
    })
    const spent = agg._sum.amountUsd ?? 0

    const capRow = await tx.setting.findUnique({ where: { key: 'budget.monthlyCapUsd' } })
    const cap = typeof capRow?.value === 'number' ? capRow.value : 5
    if (spent + cost > cap) {
      throw new HttpError('BUDGET_EXCEEDED', 'Cloud run refused by the ledger', {
        month,
        spentUsd: spent,
        capUsd: cap,
        attemptedUsd: cost,
      })
    }
    const runningTotalUsd = spent + cost
    const entry = await tx.budgetEntry.create({
      data: { month, providerRunId, amountUsd: cost, runningTotalUsd, note },
    })
    return { runningTotalUsd: entry.runningTotalUsd as number, costUsd: cost }
  })
}

export const record = recordSpend

export async function spendDashboard() {
  const month = monthKey()
  const db = getDb()
  const [spent, cap, entries] = await Promise.all([
    spentThisMonth(month),
    capUsd(),
    db.budgetEntry.findMany({ where: { month }, orderBy: { createdAt: 'desc' }, take: 200 }),
  ])
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0
  return { month, capUsd: cap, spentUsd: spent, percent: pct, entries }
}

/** Price of a run in USD from the Setting price tables (kept honest, Ch. 11). */
export async function priceFor(provider: string, model: string, inputTokens: number, outputTokens: number): Promise<number> {
  if (provider === 'OLLAMA' || provider === 'MOCK' || provider === 'LOCAL_STT') return 0
  const db = getDb()
  const row = await db.setting.findUnique({ where: { key: `prices.${provider.toLowerCase()}` } })
  const table = (row?.value ?? {}) as Record<string, { input: number; output: number }>
  const p = table[model]
  if (!p) {
    logger.warn('no price table entry; cost recorded as 0', { provider, model })
    return 0
  }
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output
}
