import { statfsSync } from 'node:fs'
import { dirname } from 'node:path'
import { NextRequest } from 'next/server'
import { handler, ok } from '@/lib/http'
import { getDb } from '@/lib/db'
import { config } from '@/lib/config'
import { queueDepth } from '@/lib/jobs/queue'
import { sessionFrom } from '@/lib/auth'
import { providerHealthCached } from '@/lib/providers/health'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  // Liveness is public; adds an `authed` flag so the SPA can bootstrap (Ch. 5 note).
  let dbOk = true
  try {
    await getDb().setting.count()
  } catch {
    dbOk = false
  }
  let bytesFree: number | null = null
  try {
    bytesFree = Number(statfsSync(dirname(config.mediaDir)).bfree) * 4096
  } catch {
    bytesFree = null
  }
  const ollama = await providerHealthCached('OLLAMA')
  return ok({
    db: dbOk ? 'ok' : 'error',
    media: { bytesFree },
    ollama: ollama.up,
    queueDepth: await queueDepth(),
    authed: sessionFrom(req) !== null,
    routingMode: config.routingMode,
    stt: config.stt.binding,
  })
})
