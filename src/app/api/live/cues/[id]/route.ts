// AMBER Live Assist — battlecard update / delete (FR-029).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    category: z.enum(['OBJECTION', 'COMPETITOR', 'PROCESS', 'COACHING']).optional(),
    triggers: z.union([
      z.array(z.string().trim().min(2).max(80)).min(1).max(12),
      z.object({ wordsSinceQuestion: z.number().int().min(20).max(1000) }),
    ]).optional(),
    guidance: z.string().trim().min(1).max(600).optional(),
    cooldownSec: z.number().int().min(10).max(3600).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Empty patch' })

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid battlecard patch', parsed.error.flatten())
  const db = getDb()
  const existing = await db.liveCue.findUnique({ where: { id } })
  if (!existing) return notFound('Battlecard')
  const cue = await db.liveCue.update({ where: { id }, data: parsed.data })
  return ok(cue)
})

export const DELETE = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const existing = await db.liveCue.findUnique({ where: { id } })
  if (!existing) return notFound('Battlecard')
  await db.liveCue.delete({ where: { id } })
  return ok({ deleted: id })
})
