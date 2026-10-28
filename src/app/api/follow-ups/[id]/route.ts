import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(20000).optional(),
  tone: z.string().max(60).optional(),
  channel: z.enum(['EMAIL', 'LINKEDIN', 'OTHER']).optional(),
  status: z.enum(['DRAFT', 'EDITED', 'COPIED', 'SENT', 'DISCARDED']).optional(),
})

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const draft = await db.followUpDraft.findUnique({ where: { id } })
  if (!draft) return notFound('Follow-up draft')
  const parsed = PatchBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid patch', parsed.error.issues.map((i) => i.path.join('.')))
  const nextStatus = parsed.data.status
  const updated = await db.followUpDraft.update({
    where: { id },
    data: {
      ...(parsed.data.subject ? { subject: parsed.data.subject } : {}),
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.tone ? { tone: parsed.data.tone } : {}),
      ...(parsed.data.channel ? { channel: parsed.data.channel } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(nextStatus === 'SENT' ? { sentAt: new Date() } : {}),
      ...(parsed.data.subject || parsed.data.body ? { status: nextStatus ?? 'EDITED' } : {}),
    },
  })
  return ok({ draft: updated })
})
