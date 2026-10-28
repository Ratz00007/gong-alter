import { NextRequest } from 'next/server'
import { handler, ok, requireSession, fail } from '@/lib/http'
import { config } from '@/lib/config'
import { getDb } from '@/lib/db'
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'

export const dynamic = 'force-dynamic'

function resolveBackupTarget(backupRoot: string, name: string): string {
  const target = resolve(backupRoot, name)
  const rel = relative(backupRoot, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('BACKUP_PATH_TRAVERSAL')
  }
  return target
}

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const backupRoot = resolve(config.backupDir)
  mkdirSync(backupRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = resolveBackupTarget(backupRoot, `amber-${stamp}.db`)
  if (/[\r\n\0]/.test(target)) {
    return fail('VALIDATION_ERROR', 'Invalid backup destination path')
  }

  // VACUUM INTO is the consistent snapshot path (Ch. 8).
  const db = getDb()
  await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`)

  // Cross-platform media sync using Node fs.cpSync
  const mediaLink = join(backupRoot, `media-${stamp}`)
  let mediaOk: boolean | null = null
  if (existsSync(config.mediaDir)) {
    try {
      cpSync(config.mediaDir, mediaLink, { recursive: true })
      mediaOk = true
    } catch {
      mediaOk = false
    }
  }

  return ok({ path: target, media: mediaLink, mediaOk }, { status: 202 })
})

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const dir = config.backupDir
  if (!existsSync(dir)) return ok({ backups: [] })
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith('amber-') && f.endsWith('.db'))
    .sort()
    .reverse()
  return ok({ backups })
})
