// AMBER — job queue (Table 4.19): lease-based claiming, exponential backoff,
// stale-lock reclaim on boot (FR-008 crash safety boundary).
import { getDb } from '../db'
import type { Job, JobType } from '@prisma/client'
import { publish } from '../events'
import { config } from '../config'

export async function enqueue(type: JobType, opts: { callId?: string; priority?: number; runAfter?: Date } = {}): Promise<Job> {
  const db = getDb()
  const job = await db.job.create({
    data: {
      type,
      callId: opts.callId,
      priority: opts.priority ?? 5,
      runAfter: opts.runAfter ?? new Date(),
    },
  })
  publish('job.updated', { jobId: job.id, status: job.status, attempts: job.attempts })
  return job
}

/** Atomically claim the next runnable job (priority asc, then runAfter asc). */
export async function claimNext(): Promise<Job | null> {
  const db = getDb()
  const now = new Date()
  const candidates = await db.job.findMany({
    where: { status: 'QUEUED', runAfter: { lte: now } },
    orderBy: [{ priority: 'asc' }, { runAfter: 'asc' }, { createdAt: 'asc' }],
    take: 5,
  })
  for (const job of candidates) {
    // Conditional update: only flip if still QUEUED (single-writer guard).
    const updated = await db.job.updateMany({
      where: { id: job.id, status: 'QUEUED' },
      data: { status: 'RUNNING', lockedAt: now, attempts: { increment: 1 } },
    })
    if (updated.count > 0) {
      const claimed = await db.job.findUniqueOrThrow({ where: { id: job.id } })
      publish('job.updated', { jobId: job.id, status: 'RUNNING', attempts: claimed.attempts })
      return claimed
    }
  }
  return null
}

export async function finishJob(jobId: string): Promise<void> {
  const db = getDb()
  const job = await db.job.update({ where: { id: jobId }, data: { status: 'DONE', lockedAt: null } })
  publish('job.updated', { jobId, status: 'DONE', attempts: job.attempts })
}

/** Failed attempt: backoff re-queue until attempts ceiling, then park as FAILED. */
export async function failJob(job: Job, error: string): Promise<void> {
  const db = getDb()
  const ceiling = job.maxAttempts || config.jobMaxAttempts
  if (job.attempts < ceiling) {
    const backoffMs = Math.min(60_000, 5_000 * 2 ** job.attempts)
    const updated = await db.job.update({
      where: { id: job.id },
      data: { status: 'QUEUED', lockedAt: null, lastError: error, runAfter: new Date(Date.now() + backoffMs) },
    })
    publish('job.updated', { jobId: job.id, status: 'QUEUED', attempts: updated.attempts })
  } else {
    await db.job.update({ where: { id: job.id }, data: { status: 'FAILED', lockedAt: null, lastError: error } })
    publish('job.updated', { jobId: job.id, status: 'FAILED', attempts: job.attempts })
  }
}

/** Boot-time and periodic reclaim: RUNNING jobs whose lease expired. */
export async function reclaimStale(leaseMs = 5 * 60_000): Promise<number> {
  const db = getDb()
  const cutoff = new Date(Date.now() - leaseMs)
  const stale = await db.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'QUEUED', lockedAt: null },
  })
  return stale.count
}

export async function cancelJobsForCall(callId: string): Promise<void> {
  const db = getDb()
  await db.job.updateMany({
    where: { callId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'CANCELED', lockedAt: null },
  })
}

export async function activeJobs(limit = 50) {
  const db = getDb()
  const active = await db.job.findMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  })
  const recent = await db.job.findMany({
    where: { status: { in: ['DONE', 'FAILED', 'CANCELED'] } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })
  return { active, recent }
}

export function queueDepth(): Promise<number> {
  return getDb().job.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } })
}
