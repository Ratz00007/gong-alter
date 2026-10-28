import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, collection, requireSession, notFound } from '@/lib/http'
import { getDb } from '@/lib/db'
import { logDealEvent } from '@/lib/timeline/assemble'

export const dynamic = 'force-dynamic'

const CreateBody = z.object({ body: z.string().min(1).max(20000), pinned: z.boolean().optional() })

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const notes = await getDb().note.findMany({ where: { callId: id }, orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }] })
  return collection(notes, notes.length)
})

export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const call = await db.call.findUnique({ where: { id } })
  if (!call) return notFound('Call')
  const parsed = CreateBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return ok({ error: 'VALIDATION_ERROR' }, { status: 400 })
  const note = await db.note.create({
    data: { callId: id, body: parsed.data.body, pinned: parsed.data.pinned ?? false, origin: 'user' },
  })
  if (call.dealId) await logDealEvent(call.dealId, 'NOTE_ADDED', { noteId: note.id, callId: id, preview: parsed.data.body.slice(0, 80) })
  return ok({ note }, { status: 201 })
})
