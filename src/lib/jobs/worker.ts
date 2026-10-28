// AMBER — worker loop (WO-006). Handlers are registered by pipeline modules
// (P1/P2/P4) via register-handlers.ts; unregistered types fail honestly.
import type { Job, JobType } from '@prisma/client'
import { claimNext, finishJob, failJob, reclaimStale } from './queue'
import { config } from '../config'
import { logger } from '../logger'
import { failCall } from '../pipeline/orchestrator'
import { StageError } from '../pipeline/analyze'

export type JobHandler = (job: Job) => Promise<void>

type Reg = {
  handlers: Map<JobType, JobHandler>
  timer?: ReturnType<typeof setInterval>
  ticking: boolean
  lastReclaimAt: number
  lastAutoSyncAt: number
}

const RECLAIM_INTERVAL_MS = 60_000
const AUTO_SYNC_INTERVAL_MS = 300_000

/** Lazy global registry — no module-init-order dependencies (ESM cycle safe). */
function S(): Reg {
  const g = globalThis as unknown as { __amberWorker?: Reg }
  return (g.__amberWorker ??= { handlers: new Map(), ticking: false, lastReclaimAt: 0, lastAutoSyncAt: 0 })
}

export function registerJobHandler(type: JobType, fn: JobHandler) {
  S().handlers.set(type, fn)
}

/** Run one claimed job to completion (success | backoff | park + call-level failure). */
export async function runJob(job: Job): Promise<void> {
  const handler = S().handlers.get(job.type)
  if (!handler) {
    await failJob(job, `no handler registered for ${job.type}`)
    return
  }
  try {
    await handler(job)
    await finishJob(job.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn(`job ${job.type} failed (attempt ${job.attempts})`, { callId: job.callId ?? null, error: msg.slice(0, 200) })
    await failJob(job, msg)
    // Only mark call FAILED when error is non-retryable or attempts are exhausted,
    // so calls stay in their processing state while retrying.
    const explicitRetryable =
      e && typeof e === 'object' && 'retryable' in e && typeof (e as { retryable?: unknown }).retryable === 'boolean'
        ? (e as { retryable: boolean }).retryable
        : undefined
    const retryable =
      explicitRetryable !== undefined
        ? explicitRetryable
        : !(e instanceof StageError && e.code === 'TRANSCRIBE_EMPTY')
    const maxAttempts = job.maxAttempts || config.jobMaxAttempts
    if (job.callId && (!retryable || job.attempts + 1 >= maxAttempts)) {
      const stage = e instanceof StageError ? e.stage : job.type.toLowerCase()
      const code = e instanceof StageError ? e.code : `${job.type}_FAILED`
      await failCall(job.callId, stage, code, msg)
    }
  }
}

async function autoSyncActiveIntegrations() {
  try {
    const { getDb } = await import('../db')
    const { syncIntegration } = await import('../integrations/manager')
    const db = getDb()
    const connections = await db.integrationConnection.findMany({
      where: { status: 'CONNECTED' },
    })
    for (const conn of connections) {
      const cfg = (conn.configJson as Record<string, unknown>) ?? {}
      if (cfg.autoSync !== false) {
        await syncIntegration(conn.type)
      }
    }
  } catch (e) {
    logger.warn('auto-sync integrations failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

async function tick() {
  const st = S()
  if (st.ticking) return
  st.ticking = true
  try {
    const now = Date.now()
    if (now - (st.lastReclaimAt ?? 0) >= RECLAIM_INTERVAL_MS) {
      st.lastReclaimAt = now
      await reclaimStale()
    }
    if (now - (st.lastAutoSyncAt ?? 0) >= AUTO_SYNC_INTERVAL_MS) {
      st.lastAutoSyncAt = now
      void autoSyncActiveIntegrations()
    }
    while (true) {
      const job = await claimNext()
      if (!job) break
      await runJob(job)
    }
  } catch (e) {
    logger.error('worker tick crashed', { error: e instanceof Error ? e.message : String(e) })
  } finally {
    S().ticking = false
  }
}

/** Drain the queue to completion — used by tests and after boot. */
export async function drainQueue(): Promise<void> {
  while (true) {
    const job = await claimNext()
    if (!job) break
    await runJob(job)
  }
}

export function startWorker() {
  const st = S()
  if (st.timer) return
  if (!config.workerEnabled) {
    logger.info('worker disabled (WORKER_ENABLED=false)')
    return
  }
  st.timer = setInterval(() => void tick(), 750)
  void tick()
  logger.info('worker loop started (poll 750ms)')
}

// Pipeline modules register their handlers here (P1/P2/P4/P5).
import '../pipeline/register-handlers'
