import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'
import { deleteAssetIfUnreferenced } from '@/lib/media/vault'
import { cancelJobsForCall } from '@/lib/jobs/queue'
import { unlinkSync, existsSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { config } from '@/lib/config'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const call = await getDb().call.findUnique({
    where: { id },
    include: {
      deal: { select: { id: true, title: true, stage: true, account: true } },
      contact: { select: { id: true, name: true, title: true } },
      summary: true,
      scorecard: true,
      followUpDraft: { select: { id: true, status: true, subject: true } },
      transcript: { select: { id: true, language: true, wordCount: true } },
      _count: { select: { insights: true, notes: true, runs: true } },
    },
  })
  if (!call) return notFound('Call')
  return ok({ call })
})

const PatchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  dealId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  occurredAt: z.string().datetime().optional(),
})

export const PATCH = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const body = await req.json().catch(() => null)
  const parsed = PatchBody.safeParse(body)
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid patch', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  const call = await db.call.findUnique({ where: { id } })
  if (!call) return notFound('Call')
  if (call.status === 'CANCELED') return fail('PIPELINE_CONFLICT', 'Call is canceled', { status: call.status })
  const updated = await db.call.update({
    where: { id },
    data: {
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      ...(parsed.data.dealId !== undefined ? { dealId: parsed.data.dealId } : {}),
      ...(parsed.data.contactId !== undefined ? { contactId: parsed.data.contactId } : {}),
      ...(parsed.data.occurredAt ? { occurredAt: new Date(parsed.data.occurredAt) } : {}),
    },
    include: { deal: { select: { id: true, title: true, stage: true } }, contact: { select: { id: true, name: true } } },
  })
  return ok({ call: updated })
})

export const DELETE = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const call = await db.call.findUnique({ where: { id }, include: { transcript: { include: { segments: true } }, notes: true, insights: true } })
  if (!call) return notFound('Call')

  await cancelJobsForCall(id)

  // remove embedding vectors in the same breath as their sources (Ch. 3 re-index rules)
  const segmentIds = call.transcript?.segments.map((s) => s.id) ?? []
  const noteIds = call.notes.map((n) => n.id)
  const insightIds = call.insights.map((i) => i.id)
  const originalId = call.mediaAssetId
  const normalizedId = call.normalizedAssetId

  await db.$transaction(async (tx) => {
    if (segmentIds.length) {
      await tx.embedding.deleteMany({ where: { resourceType: 'SEGMENT', resourceId: { in: segmentIds } } })
      await tx.embedding.deleteMany({ where: { resourceType: 'SEGMENT_WINDOW', resourceId: { in: segmentIds } } })
    }
    await tx.embedding.deleteMany({ where: { resourceType: 'CALL_SUMMARY', resourceId: id } })
    if (noteIds.length) await tx.embedding.deleteMany({ where: { resourceType: 'NOTE', resourceId: { in: noteIds } } })
    if (insightIds.length) await tx.embedding.deleteMany({ where: { resourceType: 'INSIGHT', resourceId: { in: insightIds } } })
    await tx.call.delete({ where: { id } }) // cascades transcript/segments/insights/notes/draft/scorecard/jobs
  })

  // dedup-safe media delete + sidecar cleanup
  if (originalId) await deleteAssetIfUnreferenced(originalId)
  if (normalizedId && normalizedId !== originalId) await deleteAssetIfUnreferenced(normalizedId)
  const scriptRoot = resolve(config.mediaDir, 'scripted')
  const script = resolve(scriptRoot, `${id}.json`)
  const rel = relative(scriptRoot, script)
  if (rel && !rel.startsWith('..') && !isAbsolute(rel) && existsSync(script)) {
    unlinkSync(script)
  }

  return ok({ deleted: id })
})
