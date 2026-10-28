import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  title: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  isChampion: z.boolean().optional(),
  isEconomicBuyer: z.boolean().optional(),
})

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const contact = await db.contact.findUnique({ where: { id } })
  if (!contact) return notFound('Contact')
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid patch', parsed.error.issues.map((i) => i.path.join('.')))
  const updated = await db.contact.update({
    where: { id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.isChampion !== undefined ? { isChampion: parsed.data.isChampion } : {}),
      ...(parsed.data.isEconomicBuyer !== undefined ? { isEconomicBuyer: parsed.data.isEconomicBuyer } : {}),
    },
  })
  return ok({ contact: updated })
})

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const contact = await db.contact.findUnique({ where: { id } })
  if (!contact) return notFound('Contact')
  await db.contact.delete({ where: { id } })
  return ok({ deleted: id })
})
