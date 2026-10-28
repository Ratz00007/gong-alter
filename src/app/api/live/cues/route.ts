// AMBER Live Assist — battlecard library (FR-029). GET list / POST create.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, fail } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const items = await getDb().liveCue.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
  return ok({ items, total: items.length })
})

const PhraseCueSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(['OBJECTION', 'COMPETITOR', 'PROCESS', 'COACHING']),
  kind: z.literal('PHRASE'),
  triggers: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
  guidance: z.string().trim().min(1).max(600),
  cooldownSec: z.number().int().min(10).max(3600).default(180),
  enabled: z.boolean().default(true),
})

const RuleCueSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(['OBJECTION', 'COMPETITOR', 'PROCESS', 'COACHING']),
  kind: z.literal('RULE_NO_QUESTION'),
  triggers: z.object({ wordsSinceQuestion: z.number().int().min(20).max(1000) }),
  guidance: z.string().trim().min(1).max(600),
  cooldownSec: z.number().int().min(10).max(3600).default(180),
  enabled: z.boolean().default(true),
})

const CreateSchema = z.union([PhraseCueSchema, RuleCueSchema]).superRefine((v, ctx) => {
  if (v.kind === 'PHRASE' && v.triggers.some((t) => t.length < 2)) {
    ctx.addIssue({ code: 'custom', message: 'Triggers must be at least 2 characters' })
  }
})

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid battlecard', parsed.error.flatten())
  const db = getDb()
  const last = await db.liveCue.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
  const cue = await db.liveCue.create({
    data: { ...parsed.data, triggers: parsed.data.triggers, sortOrder: (last?.sortOrder ?? 0) + 1 },
  })
  return ok(cue, { status: 201 })
})
