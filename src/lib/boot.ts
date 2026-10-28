// AMBER — boot sequence (instrumentation): dirs, seed, stale reclaim, worker.
import { mkdirSync } from 'node:fs'
import { config } from './config'
import { runSeed } from './seed'
import { reclaimStale } from './jobs/queue'
import { startWorker } from './jobs/worker'
import { logger } from './logger'

const g = globalThis as unknown as { __amberBooted?: boolean }

export async function boot() {
  if (g.__amberBooted) return // HMR guard
  g.__amberBooted = true
  try {
    mkdirSync(config.mediaDir, { recursive: true })
    mkdirSync(config.backupDir, { recursive: true })
    await runSeed()
    const reclaimed = await reclaimStale()
    if (reclaimed > 0) logger.info(`reclaimed ${reclaimed} stale job lease(s)`)
    startWorker()
    logger.info('AMBER boot complete', { routingMode: config.routingMode, stt: config.stt.binding })
  } catch (e) {
    g.__amberBooted = false
    logger.error('boot failed', { error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}
