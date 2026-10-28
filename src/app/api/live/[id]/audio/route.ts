// AMBER Live Assist — mic audio chunk intake (FR-025). Raw bytes appended to the
// disk-backed session temp file; content-addressed into the vault at finalize. Audio never
// leaves the machine — same invariant as uploads.
import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { appendAudioChunk } from '@/lib/live/engine'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MAX_CHUNK = 2 * 1024 * 1024 // 2 MiB per chunk; ~2s of opus

type Ctx = { params: Promise<{ id: string }> }

export const POST = handler(async (req: NextRequest, ctx: Ctx) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const session = await db.liveSession.findUnique({ where: { id } })
  if (!session) return notFound('Live session')
  if (session.status !== 'LIVE') return fail('PIPELINE_CONFLICT', 'Session is not LIVE', undefined, 409)
  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length === 0) return fail('VALIDATION_ERROR', 'Empty audio chunk')
  if (buf.length > MAX_CHUNK) return fail('VALIDATION_ERROR', 'Audio chunk too large')
  const maxSessionBytes = config.audio.maxMb * 1024 * 1024
  if (Number(session.bytesReceived) + buf.length > maxSessionBytes) {
    return fail('VALIDATION_ERROR', `Session audio limit (${config.audio.maxMb} MB) exceeded`, undefined, 413)
  }
  let bytes: number
  try {
    bytes = appendAudioChunk(id, buf)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return fail('VALIDATION_ERROR', msg, undefined, 413)
  }
  await db.liveSession.update({ where: { id }, data: { bytesReceived: BigInt(bytes) } })
  return ok({ sessionId: id, bytesReceived: bytes })
})
