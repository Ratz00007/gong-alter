import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  body: z.string().min(1).max(20000).optional(),
  pinned: z.boolean().optional(),
})

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const note = await db.note.findUnique({ where: { id } })
  if (!note) return notFound('Note')
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid patch', parsed.error.issues.map((i) => i.path.join('.')))
  // An edit accepts an AI draft: origin flips to user (Table 4.9).
  const wasAi = note.origin === 'ai'
  const updated = await db.note.update({
    where: { id },
    data: {
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      ...(parsed.data.body && wasAi ? { origin: 'user' as const } : {}),
    },
  })
  return ok({ note: updated })
})

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const note = await db.note.findUnique({ where: { id } })
  if (!note) return notFound('Note')
  await db.embedding.deleteMany({ where: { resourceType: 'NOTE', resourceId: id } })
  await db.note.delete({ where: { id } })
  return ok({ deleted: id })
})
