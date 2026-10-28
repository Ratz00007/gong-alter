// AMBER — test helpers: point at the test DB (fresh per run) and seed once.
import { useTestDatabase, getDb } from '@/lib/db'
import { runSeed } from '@/lib/seed'
import { resetZaiGateCache } from '@/lib/providers/zai'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

let seeded = false
let schemaPushed = false

export { createPureWavBuffer } from '@/lib/audio/wav'

export function useTestDb(): void {
  const dbDir = join(process.cwd(), 'db')
  mkdirSync(dbDir, { recursive: true })
  const absDbPath = process.env.VALENCE_TEST_DB_PATH ?? join(dbDir, 'test.db')
  const url = process.env.VALENCE_TEST_DB_PATH ? `file:${absDbPath.replaceAll('\\', '/')}` : 'file:../db/test.db'
  if (!schemaPushed && (!existsSync(absDbPath) || statSync(absDbPath).size < 32768)) {
    const prismaCli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
    const r = spawnSync('node', [prismaCli, 'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    if (r.status !== 0) {
      console.error('prisma db push failed in useTestDb:', r.stderr?.toString())
    }
    schemaPushed = true
  }
  useTestDatabase(url)
}

export async function seedOnce(): Promise<void> {
  if (seeded) return
  const db = getDb()
  // Fast in-process cleanup so each test file starts with a clean slate in <5ms
  await db.embedding.deleteMany()
  await db.job.deleteMany()
  await db.liveCueFire.deleteMany()
  await db.liveSession.deleteMany()
  await db.budgetEntry.deleteMany()
  await db.providerRun.deleteMany()
  await db.integrationSyncLog.deleteMany()
  await db.emailMessage.deleteMany()
  await db.integrationConnection.deleteMany()
  await db.call.deleteMany()
  await db.contact.deleteMany()
  await db.deal.deleteMany()
  await db.mediaAsset.deleteMany()
  await runSeed()
  // Determinism pins: the bundled ZAI provider and cloud-STT egress stay OFF
  // for the whole suite (golden-set parity, no network, no rate limits).
  // ZAI-specific tests flip these per-case and restore after.
  await db.setting.update({ where: { key: 'providers.zaiEnabled' }, data: { value: false } })
  await db.setting.update({ where: { key: 'stt.cloudEgressEnabled' }, data: { value: false } })
  resetZaiGateCache()
  seeded = true
}

/** Sidecar script for the scripted STT binding (mirrors lib/media/vault.storeScript). */
export function writeScript(callId: string, script: unknown): string {
  const p = join(process.env.MEDIA_DIR ?? './data/media', 'scripted', `${callId}.json`)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(script))
  return p
}

export { getDb }
