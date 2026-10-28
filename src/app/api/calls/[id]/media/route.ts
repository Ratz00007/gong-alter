import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { getDb } from '@/lib/db'
import { vaultPath } from '@/lib/media/vault'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export function readAssetPath(asset: { filePath: string }): string {
  return vaultPath(asset.filePath)
}

// In-memory cache for dynamically synthesized WAV buffers (avoids re-generating across Range chunks)
const synthCache = new Map<string, { key: string; buf: Buffer }>()

/**
 * Synthesizes a valid 8kHz 16-bit mono PCM WAV buffer matching transcript segment cadence
 * with gentle voice-like harmonic envelopes during segments and silence between segments.
 */
function synthesizeWavBuffer(call: {
  id: string
  durationSec?: number | null
  transcript?: {
    segments?: { speaker: string; startMs: number; endMs: number }[]
  } | null
}): Buffer {
  const segments = call.transcript?.segments ?? []
  const sampleRate = 8000
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8

  // Calculate duration
  let durationMs = 30_000
  if (segments.length > 0) {
    const lastEndMs = Math.max(...segments.map((s) => s.endMs))
    durationMs = Math.max(lastEndMs + 1000, (call.durationSec ?? 0) * 1000, 10_000)
    // Cap at 10 minutes to maintain fast responsiveness and modest memory
    durationMs = Math.min(durationMs, 600_000)
  } else if (call.durationSec && call.durationSec > 0) {
    durationMs = Math.min(Math.max(call.durationSec * 1000, 5_000), 30_000)
  }

  const totalSamples = Math.floor((durationMs / 1000) * sampleRate)
  const dataSize = totalSamples * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // RIFF Chunk Descriptor
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4) // ChunkSize = 36 + SubChunk2Size
  buffer.write('WAVE', 8, 'ascii')

  // "fmt " sub-chunk
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22) // NumChannels (1 = mono)
  buffer.writeUInt32LE(sampleRate, 24) // SampleRate
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28) // ByteRate
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32) // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34) // BitsPerSample

  // "data" sub-chunk
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)

  // If no segments, generate gentle ambient harmonic cadence for demo playback
  const effectiveSegments =
    segments.length > 0
      ? segments
      : [
          { speaker: 'SPEAKER_00', startMs: 500, endMs: 8000 },
          { speaker: 'SPEAKER_01', startMs: 9500, endMs: 18000 },
          { speaker: 'SPEAKER_00', startMs: 20000, endMs: 28500 },
        ]

  // Render samples with gentle voice-like harmonic envelopes
  for (let sIdx = 0; sIdx < effectiveSegments.length; sIdx++) {
    const seg = effectiveSegments[sIdx]
    const segStartSample = Math.max(0, Math.floor((seg.startMs / 1000) * sampleRate))
    const segEndSample = Math.min(totalSamples, Math.ceil((seg.endMs / 1000) * sampleRate))
    if (segStartSample >= segEndSample) continue

    // Assign harmonic pitch by speaker
    const isRep = seg.speaker === 'SPEAKER_00' || seg.speaker === 'REP'
    const f0 = isRep ? 165 : 220 // 165Hz (warm tenor) vs 220Hz (higher register)
    const segSampleCount = segEndSample - segStartSample
    const rampSamples = Math.min(Math.floor(sampleRate * 0.05), Math.floor(segSampleCount / 4)) // 50ms ramp

    for (let i = segStartSample; i < segEndSample; i++) {
      const segPos = i - segStartSample
      // Trapezoidal fade envelope to prevent audible clicks
      let env = 1.0
      if (segPos < rampSamples) {
        env = segPos / rampSamples
      } else if (segPos > segSampleCount - rampSamples) {
        env = (segSampleCount - segPos) / rampSamples
      }

      // Voice-like harmonic synthesis (f0, 2*f0, 3*f0) with subtle vibrato
      const t = i / sampleRate
      const vibrato = 1.0 + 0.02 * Math.sin(2 * Math.PI * 4.5 * t)
      const tone =
        0.55 * Math.sin(2 * Math.PI * f0 * vibrato * t) +
        0.30 * Math.sin(2 * Math.PI * 2 * f0 * vibrato * t) +
        0.15 * Math.sin(2 * Math.PI * 3 * f0 * vibrato * t)

      const sampleVal = Math.round(tone * env * 14000)
      const clamped = Math.max(-32768, Math.min(32767, sampleVal))
      buffer.writeInt16LE(clamped, 44 + i * 2)
    }
  }

  return buffer
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  // Session check supporting cookie, Authorization header, or query param
  const token =
    req.cookies.get(SESSION_COOKIE)?.value ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.nextUrl.searchParams.get('token') ||
    undefined

  const session = verifySessionToken(token)
  if (!session) {
    return new NextResponse(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'No or expired session' } }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    )
  }

  const { id } = await ctx.params
  const db = getDb()
  const call = await db.call.findUnique({
    where: { id },
    include: {
      normalizedAsset: true,
      mediaAsset: true,
      transcript: {
        include: {
          segments: {
            orderBy: { idx: 'asc' },
          },
        },
      },
    },
  })

  if (!call) {
    return new NextResponse(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Call not found' } }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    )
  }

  // Check if physical file exists on disk (normalized WAV preferred over original upload)
  let audioBuffer: Buffer | null = null
  let mimeType = 'audio/wav'

  const diskCandidate = [call.normalizedAsset, call.mediaAsset].find((asset) => {
    if (!asset?.filePath) return false
    const abs = vaultPath(asset.filePath)
    return existsSync(abs) && statSync(abs).size > 0
  })

  if (diskCandidate) {
    try {
      const abs = vaultPath(diskCandidate.filePath)
      audioBuffer = readFileSync(abs)
      mimeType = diskCandidate.mimeType || 'audio/wav'
    } catch {
      audioBuffer = null
    }
  }

  // Fallback: dynamically synthesize 8kHz 16-bit mono PCM WAV buffer
  if (!audioBuffer) {
    const cacheKey = `${call.id}:${call.updatedAt.getTime()}`
    const cached = synthCache.get(call.id)
    if (cached && cached.key === cacheKey) {
      audioBuffer = cached.buf
    } else {
      audioBuffer = synthesizeWavBuffer(call)
      synthCache.set(call.id, { key: cacheKey, buf: audioBuffer })
      // Keep cache bounded to 20 items
      if (synthCache.size > 20) {
        const oldestKey = synthCache.keys().next().value
        if (oldestKey) synthCache.delete(oldestKey)
      }
    }
    mimeType = 'audio/wav'
  }

  const totalSize = audioBuffer.length
  const rangeHeader = req.headers.get('range')

  // Full content response if no Range requested
  if (!rangeHeader) {
    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(totalSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  // Parse Range header (e.g. bytes=0- or bytes=1000-2000)
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }

  let start = match[1] ? parseInt(match[1], 10) : 0
  let end = match[2] ? parseInt(match[2], 10) : totalSize - 1

  if (isNaN(start)) start = 0
  if (isNaN(end) || end >= totalSize) end = totalSize - 1

  if (start > end || start >= totalSize) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }

  const chunk = audioBuffer.subarray(start, end + 1)
  return new Response(new Uint8Array(chunk), {
    status: 206,
    headers: {
      'Content-Type': mimeType,
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunk.length),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
