// AMBER — media vault (WO-007): SHA-256 content addressing, two-level fan-out
// ab/cd/<sha256>.<ext>, dedup by hash (FR-002). Assets are immutable.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { config } from '../config'
import { getDb } from '../db'
import type { MediaAsset } from '@prisma/client'

const EXT_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

const ACCEPT_MIMES = new Set(Object.keys(EXT_BY_MIME))

export const ACCEPT_EXTENSIONS = ['mp3', 'm4a', 'mp4', 'wav', 'webm']

export function isAcceptedMime(mime: string): boolean {
  return ACCEPT_MIMES.has(mime)
}

export function extFor(mime: string, fallbackName: string): string {
  const byMime = EXT_BY_MIME[mime]
  if (byMime) return byMime
  const byName = fallbackName.split('.').pop()?.toLowerCase()
  if (byName && ACCEPT_EXTENSIONS.includes(byName)) return byName
  return 'bin'
}

export function vaultPath(relPath: string): string {
  const root = resolve(config.mediaDir)
  const target = resolve(root, relPath)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('VAULT_PATH_TRAVERSAL: path escapes mediaDir')
  }
  return target
}

export function sha256Of(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Content-addressed store. Returns the asset (existing row on dedup) + created flag. */
export async function storeAsset(bytes: Buffer, mimeType: string, originalName: string): Promise<{ asset: MediaAsset; created: boolean }> {
  const db = getDb()
  const sha256 = sha256Of(bytes)
  const existing = await db.mediaAsset.findUnique({ where: { sha256 } })
  if (existing) return { asset: existing, created: false }

  const ext = extFor(mimeType, originalName)
  const rel = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${ext}`
  const abs = vaultPath(rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  try {
    const asset = await db.mediaAsset.upsert({
      where: { sha256 },
      update: {},
      create: {
        sha256,
        filePath: rel,
        mimeType,
        sizeBytes: BigInt(bytes.length),
      },
    })
    return { asset, created: true }
  } catch {
    const raced = await db.mediaAsset.findUniqueOrThrow({ where: { sha256 } })
    return { asset: raced, created: false }
  }
}

export async function assetBytes(asset: MediaAsset): Promise<Buffer> {
  return readFileSync(vaultPath(asset.filePath))
}

/** Delete the vault file + row only when no call references it (dedup-safe, Table 5.3). */
export async function deleteAssetIfUnreferenced(assetId: string): Promise<void> {
  const db = getDb()
  const asset = await db.mediaAsset.findUnique({
    where: { id: assetId },
    include: { calls: true, callsNormalized: true },
  })
  if (!asset) return
  if (asset.calls.length > 0 || asset.callsNormalized.length > 0) return
  await db.mediaAsset.delete({ where: { id: asset.id } })
  try {
    unlinkSync(vaultPath(asset.filePath))
  } catch {
    /* already gone */
  }
}

/** Store the normalized WAV as a second content-addressed asset. */
export async function storeNormalizedAsset(wavAbsPath: string, sha256: string, sizeBytes: number, sampleRateHz: number, channels: number): Promise<MediaAsset> {
  const db = getDb()
  const existing = await db.mediaAsset.findUnique({ where: { sha256 } })
  if (existing) return existing
  const rel = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.wav`
  const abs = vaultPath(rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, readFileSync(wavAbsPath))
  try {
    return await db.mediaAsset.upsert({
      where: { sha256 },
      update: {},
      create: { sha256, filePath: rel, mimeType: 'audio/wav', sizeBytes: BigInt(sizeBytes), sampleRateHz, channels },
    })
  } catch {
    return db.mediaAsset.findUniqueOrThrow({ where: { sha256 } })
  }
}

/** Test-path sidecar scripts (WHISPER_BINDING=scripted, Ch. 9 mocks). */
export function scriptDir(): string {
  return join(config.mediaDir, 'scripted')
}

function scriptPathFor(callId: string): string {
  const root = resolve(scriptDir())
  const target = resolve(root, `${callId}.json`)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('VAULT_PATH_TRAVERSAL: invalid callId')
  }
  return target
}

export function storeScript(callId: string, json: string): string {
  const p = scriptPathFor(callId)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, json)
  return p
}

export function loadScript(callId: string): { language?: string; segments?: { speaker?: string; startMs?: number; endMs?: number; text?: string }[] } | null {
  try {
    const p = scriptPathFor(callId)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export function mediaStats(): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else {
        files++
        try {
          bytes += statSync(p).size
        } catch {
          /* racing delete */
        }
      }
    }
  }
  walk(config.mediaDir)
  return { bytes, files }
}
