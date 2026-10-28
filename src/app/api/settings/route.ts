import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handler, ok, parseJson, requireSession } from '@/lib/http'
import { getDb } from '@/lib/db'
import { SETTING_DEFAULTS } from '@/lib/seed'
import { resetZaiGateCache } from '@/lib/providers/zai'
import { providerHealth } from '@/lib/providers/health'
import { logger } from '@/lib/logger'

const PatchBody = z.object({ key: z.string().min(1), value: z.unknown() })

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const rows = await getDb().setting.findMany({ orderBy: { key: 'asc' } })
  return ok({ items: rows.map((r) => ({ key: r.key, value: r.value })) })
})

export const PATCH = handler(async (req: NextRequest) => {
  requireSession(req)
  const { key, value } = await parseJson(req, PatchBody)
  const db = getDb()
  // Whitelist is code (Ch. 11): a new key is a deliberate act with a schema.
  if (!(key in SETTING_DEFAULTS)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: `Unknown setting key`, details: { key } } },
      { status: 400 },
    )
  }
  // budget cap changes are logged (FR-022 auditability)
  if (key === 'budget.monthlyCapUsd') logger.info('budget cap changed', { to: value })
  await db.setting.update({ where: { key }, data: { value: value as object } })
  // Provider gates have short-lived caches — drop them so the new value is
  // visible immediately (routing reads health within seconds of a toggle).
  if (key === 'providers.zaiEnabled' || key === 'providers.mockEnabled') {
    resetZaiGateCache()
    void providerHealth(key === 'providers.zaiEnabled' ? 'ZAI' : 'MOCK', true).catch(() => null)
  }
  const row = await db.setting.findUniqueOrThrow({ where: { key } })
  return ok({ key, value: row.value })
})
