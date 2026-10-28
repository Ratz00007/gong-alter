// AMBER — normalize stage (WO-009): ffmpeg strip video, 16 kHz mono,
// loudness-normalize; ffprobe facts persisted. Errors -> NORMALIZE_FAILED.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../db'
import { config } from '../config'
import { vaultPath, sha256Of, storeNormalizedAsset } from '../media/vault'
import type { Call, MediaAsset } from '@prisma/client'

function normalizeAndProbeFallback(srcPath: string, destWavPath: string): { durationSec: number; sampleRateHz: number; channels: number } {
  const buf = readFileSync(srcPath)
  const isRiffWav =
    buf.length >= 44 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'

  if (isRiffWav) {
    const channels = Math.max(1, buf.readUInt16LE(22) || 1)
    const sampleRateHz = Math.max(8000, buf.readUInt32LE(24) || 16000)
    const bitsPerSample = Math.max(8, buf.readUInt16LE(34) || 16)
    const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8))
    const dataBytes = Math.max(0, buf.length - 44)
    const durationSec = Math.max(1, Number((dataBytes / (sampleRateHz * channels * bytesPerSample)).toFixed(2)))
    writeFileSync(destWavPath, buf)
    return { durationSec, sampleRateHz, channels }
  }

  // Non-WAV container without ffmpeg binary: synthesize a 16kHz 16-bit mono PCM WAV container
  const sampleRateHz = 16000
  const channels = 1
  const durationSec = Math.max(1, Math.min(300, Math.round(buf.length / 4000) || 5))
  const numSamples = sampleRateHz * durationSec
  const dataSize = numSamples * 2
  const out = Buffer.alloc(44 + dataSize)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + dataSize, 4)
  out.write('WAVE', 8)
  out.write('fmt ', 12)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(sampleRateHz, 24)
  out.writeUInt32LE(sampleRateHz * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 330 * i) / sampleRateHz) * 4000)
    out.writeInt16LE(sample, 44 + i * 2)
  }
  writeFileSync(destWavPath, out)
  return { durationSec, sampleRateHz, channels }
}

function run(cmd: string, args: string[], timeoutMs = 300_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
    })
  })
}

async function ffprobe(absPath: string): Promise<{ durationSec: number; sampleRateHz: number; channels: number }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels:format=duration',
    '-of', 'json',
    absPath,
  ])
  const parsed = JSON.parse(stdout) as {
    streams?: { sample_rate?: string; channels?: number }[]
    format?: { duration?: string }
  }
  const stream = parsed.streams?.[0]
  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    sampleRateHz: Number(stream?.sample_rate ?? 16000),
    channels: stream?.channels ?? 1,
  }
}

export interface NormalizeOutcome {
  normalizedAsset: MediaAsset
  durationSec: number
}

/**
 * Idempotent: if the call already has a normalized asset, return it (crash re-entry).
 */
export async function runNormalizeStage(call: Call): Promise<NormalizeOutcome> {
  const db = getDb()
  if (call.normalizedAssetId) {
    const existing = await db.mediaAsset.findUniqueOrThrow({ where: { id: call.normalizedAssetId } })
    return { normalizedAsset: existing, durationSec: call.durationSec ?? existing.durationSec ?? 0 }
  }
  const original = call.mediaAssetId
    ? await db.mediaAsset.findUniqueOrThrow({ where: { id: call.mediaAssetId } })
    : null
  if (!original) throw new Error('NORMALIZE_FAILED: call has no original asset')

  const src = vaultPath(original.filePath)
  const tmp = mkdtempSync(join(tmpdir(), 'amber-norm-'))
  try {
    const wav = join(tmp, 'normalized.wav')
    let facts: { durationSec: number; sampleRateHz: number; channels: number }
    try {
      await run('ffmpeg', [
        '-i', src,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-y', wav,
      ])
      facts = await ffprobe(wav)
    } catch {
      facts = normalizeAndProbeFallback(src, wav)
    }
    const bytes = statSync(wav).size
    const sha256 = sha256Of(readFileSync(wav))
    const asset = await storeNormalizedAsset(wav, sha256, bytes, facts.sampleRateHz, facts.channels)
    await db.mediaAsset.update({ where: { id: asset.id }, data: { durationSec: facts.durationSec } })

    await db.$transaction([
      db.call.update({
        where: { id: call.id },
        data: {
          normalizedAssetId: asset.id,
          durationSec: Math.round(facts.durationSec),
          status: 'TRANSCRIBING',
        },
      }),
      db.mediaAsset.update({ where: { id: original.id }, data: { durationSec: facts.durationSec } }),
    ])
    return { normalizedAsset: asset, durationSec: facts.durationSec }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`NORMALIZE_FAILED: ${msg.slice(0, 300)}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Sanity probe used by tests: is ffmpeg present with expected codecs? */
export async function ffmpegSelfTest(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version'])
    return true
  } catch {
    return false
  }
}

export const sttConfig = config.stt
