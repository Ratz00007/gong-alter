import { NextRequest } from 'next/server'
import { z } from 'zod'
import { handler, ok, collection, parseIntParam, requireSession, fail } from '@/lib/http'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { storeAsset, isAcceptedMime, loadScript, storeScript, ACCEPT_EXTENSIONS } from '@/lib/media/vault'
import { intakeCall } from '@/lib/pipeline/orchestrator'
import type { CallStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const url = new URL(req.url)
  const limit = parseIntParam(url.searchParams.get('limit'), 50)
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
  const status = url.searchParams.get('status')?.split(',').filter(Boolean) as CallStatus[] | undefined
  const dealId = url.searchParams.get('dealId') ?? undefined
  const q = url.searchParams.get('q') ?? undefined
  const from = url.searchParams.get('from') ?? undefined
  const to = url.searchParams.get('to') ?? undefined
  const includeArchived = url.searchParams.get('archived') === '1'

  const where: Record<string, unknown> = {}
  if (status?.length) where.status = { in: status }
  if (dealId) where.dealId = dealId
  if (q) where.title = { contains: q }
  if (from || to) {
    where.occurredAt = {}
    if (from) (where.occurredAt as Record<string, unknown>).gte = new Date(from)
    if (to) (where.occurredAt as Record<string, unknown>).lte = new Date(to)
  }
  if (!includeArchived) where.status = status?.length ? { in: status.filter((s) => s !== 'ARCHIVED') } : { not: 'ARCHIVED' }

  const [items, total] = await Promise.all([
    db.call.findMany({
      where: where as never,
      orderBy: { occurredAt: 'desc' },
      take: limit,
      skip: offset,
      include: { deal: { select: { id: true, title: true, stage: true } }, contact: { select: { id: true, name: true } } },
    }),
    db.call.count({ where: where as never }),
  ])
  return collection(items, total)
})

const Meta = z.object({
  title: z.string().min(1).max(200).optional(),
  dealId: z.string().optional(),
  contactId: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
})

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()
  const form = await req.formData().catch(() => null)
  if (!form) return fail('VALIDATION_ERROR', 'Expected multipart/form-data')
  const file = form.get('file')
  if (!(file instanceof File)) return fail('VALIDATION_ERROR', 'Missing "file" field')

  // FR-001: format + size rules, stated in the rejection message
  const mime = file.type || 'application/octet-stream'
  const nameExt = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!isAcceptedMime(mime) && !ACCEPT_EXTENSIONS.includes(nameExt)) {
    return fail('UNSUPPORTED_MEDIA', `Unsupported format "${mime}". Accepted: ${ACCEPT_EXTENSIONS.join(', ')} up to ${config.audio.maxMb} MB and ${config.audio.maxHours} hours.`)
  }
  if (file.size === 0) {
    return fail('VALIDATION_ERROR', 'Uploaded audio file is empty')
  }
  if (file.size > config.audio.maxMb * 1024 * 1024) {
    return fail('UNSUPPORTED_MEDIA', `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${config.audio.maxMb} MB and ${config.audio.maxHours} hours.`)
  }

  const metaParsed = Meta.safeParse({
    title: (form.get('title') as string) || undefined,
    dealId: (form.get('dealId') as string) || undefined,
    contactId: (form.get('contactId') as string) || undefined,
    occurredAt: (form.get('occurredAt') as string) || undefined,
  })
  if (!metaParsed.success) {
    return fail('VALIDATION_ERROR', 'Invalid metadata', metaParsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
  const meta = metaParsed.data

  const bytes = Buffer.from(await file.arrayBuffer())
  const { asset, created } = await storeAsset(bytes, mime, file.name)

  // FR-002: duplicate by hash links to the existing call; no second job
  if (!created) {
    const existingCall = await db.call.findFirst({ where: { audioSha256: asset.sha256 }, orderBy: { createdAt: 'desc' } })
    if (existingCall) {
      return ok({ call: existingCall, duplicate: true, message: 'Already in your library' }, { status: 202 })
    }
  }

  // sidecar script (test path, WHISPER_BINDING=scripted)
  const scriptRaw = form.get('script')
  let scriptJson: string | null = null
  if (typeof scriptRaw === 'string' && scriptRaw.trim().startsWith('{')) {
    try {
      JSON.parse(scriptRaw)
      scriptJson = scriptRaw
    } catch {
      return fail('VALIDATION_ERROR', 'script field is not valid JSON')
    }
  }

  const call = await intakeCall({
    title: meta.title ?? file.name.replace(/\.[^.]+$/, ''),
    dealId: meta.dealId ?? null,
    contactId: meta.contactId ?? null,
    occurredAt: meta.occurredAt ? new Date(meta.occurredAt) : new Date(),
    mediaAssetId: asset.id,
    audioSha256: asset.sha256,
  })
  if (scriptJson) storeScript(call.id, scriptJson)
  void loadScript // scripted binding reads from media/scripted/<callId>.json
  return ok({ call, duplicate: false }, { status: 202 })
})
