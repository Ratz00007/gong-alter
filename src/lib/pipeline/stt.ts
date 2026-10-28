// AMBER — transcribe stage (WO-010, T01 local-fixed). Bindings, in priority order:
//  - `whisper`: a local whisper CLI (faster-whisper / whisper-ctranslate2); the
//    command is configurable so a personal install matches its runtime of choice.
//  - `scripted` (default in CI/demo): deterministic sidecar scripts per Ch. 9 mocks.
// Under 25 words -> TRANSCRIBE_EMPTY (honesty contract, Table 3.6).
import { spawn } from 'node:child_process'
import { readFile, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { config } from '../config'
import { vaultPath, loadScript } from '../media/vault'
import { logger } from '../logger'
import type { Call, MediaAsset } from '@prisma/client'

export interface SttSegment {
  speaker: string // SPEAKER_00 / SPEAKER_01 (pre-relabel)
  startMs: number
  endMs: number
  text: string
}

export interface SttOutput {
  language: string
  segments: SttSegment[]
  sttModel: string
  provider: 'LOCAL_STT' | 'ZAI' | 'OPENAI'
}

/** Command construction for the real whisper binding (unit-tested; sandbox runs scripted). */
export function whisperCommand(model: string, device: string, compute: string, inputWav: string): { cmd: string; args: string[] } {
  return {
    cmd: 'whisper-ctranslate2',
    args: [
      '--model', model,
      '--device', device,
      '--compute_type', compute,
      '--output_format', 'json',
      '--output_dir', path.join(os.tmpdir(), 'amber-stt'),
      '--task', 'transcribe',
      '--fp16', 'False',
      inputWav,
    ],
  }
}

export function runScripted(call: Call, wav: MediaAsset | null): SttOutput {
  const script = loadScript(call.id)
  if (!script || !Array.isArray(script.segments) || script.segments.length === 0) {
    return { language: script?.language ?? 'en', segments: [], sttModel: `whisper-${config.stt.model} (scripted: no script)`, provider: 'LOCAL_STT' }
  }
  const durationMs = Math.max(1, Math.round((call.durationSec ?? wav?.durationSec ?? 60) * 1000))
  const segments = script.segments.map((s, i) => ({
    speaker: s.speaker === 'SPEAKER_01' ? 'SPEAKER_01' : 'SPEAKER_00',
    startMs: Math.max(0, Math.min(durationMs, s.startMs ?? i * 5000)),
    endMs: Math.max(1, Math.min(durationMs, s.endMs ?? (s.startMs ?? i * 5000) + 4000)),
    text: String(s.text ?? ''),
  })).sort((a, b) => a.startMs - b.startMs)
  return { language: script.language ?? 'en', segments, sttModel: `whisper-${config.stt.model} (scripted)`, provider: 'LOCAL_STT' }
}

export const mockTranscript = runScripted

export async function runWhisperBinding(_call: Call, wavAbsPath: string): Promise<SttOutput> {
  const outDir = path.join(os.tmpdir(), 'amber-stt')
  await mkdir(outDir, { recursive: true })
  const baseName = path.parse(wavAbsPath).name
  const expectedJsonPath = path.join(outDir, `${baseName}.json`)
  const { cmd, args } = whisperCommand(config.stt.model, config.stt.device, config.stt.compute, wavAbsPath)

  return new Promise<SttOutput>((resolve, reject) => {
    // whisper-ctranslate2 writes <name>.json in outDir; we check disk first, then stdout fallback:
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => reject(new Error(`TRANSCRIBE_FAILED: whisper binding unavailable (${e.message})`)))
    child.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`TRANSCRIBE_FAILED: whisper exited ${code}: ${err.slice(-300)}`))
        return
      }
      try {
        let jsonStr = ''
        let fromDisk = false
        if (existsSync(expectedJsonPath)) {
          jsonStr = await readFile(expectedJsonPath, 'utf8')
          fromDisk = true
        } else {
          jsonStr = out
        }
        const parsed = JSON.parse(jsonStr || '{}') as {
          language?: string
          segments?: { start?: number; end?: number; text?: string }[]
        }
        const segments = (parsed.segments ?? []).map((s) => ({
          speaker: 'SPEAKER_00', // no diarization from vanilla whisper; the relabel pass clusters
          startMs: Math.round((s.start ?? 0) * 1000),
          endMs: Math.round((s.end ?? (s.start ?? 0) + 4) * 1000),
          text: (s.text ?? '').trim(),
        }))
        if (fromDisk || existsSync(expectedJsonPath)) {
          try {
            await unlink(expectedJsonPath)
          } catch {}
        }
        resolve({ language: parsed.language ?? 'en', segments, sttModel: `whisper-${config.stt.model}`, provider: 'LOCAL_STT' })
      } catch (e) {
        reject(new Error(`TRANSCRIBE_FAILED: unparseable whisper output (${e instanceof Error ? e.message : String(e)})`))
      }
    })
  })
}

/** Cloud transcription via OpenAI-compatible API when cloud is allowed and key is available. */
export async function runOpenAiWhisperBinding(call: Call, wavAbsPath: string): Promise<SttOutput> {
  const apiKey = (config as any).keys?.openai || config.providers.openai?.apiKey
  const baseUrl = (config as any).providers?.openai?.baseUrl || 'https://api.openai.com/v1'
  if (!apiKey) throw new Error('TRANSCRIBE_FAILED: OpenAI API key not configured')

  const buf = await readFile(wavAbsPath)
  const formData = new FormData()
  const blob = new Blob([buf], { type: 'audio/wav' })
  formData.append('file', blob, path.basename(wavAbsPath))
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'verbose_json')

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`TRANSCRIBE_FAILED: OpenAI whisper returned ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    language?: string
    text?: string
    segments?: { start?: number; end?: number; text?: string }[]
  }

  const durationMs = Math.max(1, Math.round((call.durationSec ?? 60) * 1000))
  const segments: SttSegment[] =
    Array.isArray(data.segments) && data.segments.length > 0
      ? data.segments.map((s) => ({
          speaker: 'SPEAKER_00',
          startMs: Math.round((s.start ?? 0) * 1000),
          endMs: Math.round((s.end ?? (s.start ?? 0) + 4) * 1000),
          text: (s.text ?? '').trim(),
        }))
      : sentencesToSegments(data.text ?? '', durationMs)

  return {
    language: data.language ?? 'en',
    segments,
    sttModel: 'whisper-1 (openai cloud)',
    provider: 'OPENAI',
  }
}

/** Split flat ASR text into sentence segments spread across the duration,
 *  weighted by word count, with synthetic inter-sentence gaps so the pause
 *  clustering pass has structure to work with. Pure + unit-testable. */
export function sentencesToSegments(text: string, durationMs: number): SttSegment[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (sentences.length === 0) return []
  const words = sentences.map((s) => s.split(/\s+/).length)
  const total = words.reduce((a, b) => a + b, 0) || 1
  const span = Math.max(durationMs, total * 350)
  let cursor = 0
  return sentences.map((s, i) => {
    const startMs = Math.round((cursor / total) * span)
    cursor += words[i]
    const endMs = Math.round(((cursor - words[i] * 0.15) / total) * span)
    return { speaker: 'SPEAKER_00', startMs, endMs: Math.max(startMs + 200, endMs), text: s }
  })
}

/** Parse a RIFF/WAVE header: returns byte offset of the data chunk, frame size,
 *  and total frames. Pure + unit-testable. Throws on non-PCM shapes. */
export function wavFacts(buf: Buffer): { dataOffset: number; dataBytes: number; sampleRate: number; channels: number; bitsPerSample: number } {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE buffer')
  }
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bitsPerSample = buf.readUInt16LE(34)
  // walk subchunks to find `data` (robust against LIST/fact chunks)
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      const dataBytes = Math.min(size, buf.length - off - 8)
      return { dataOffset: off + 8, dataBytes, sampleRate, channels, bitsPerSample }
    }
    off += 8 + size + (size % 2) // chunks are word-aligned
  }
  throw new Error('no data chunk in WAVE buffer')
}

/** Split a PCM wav into <=maxChunkMs pieces (platform ASR caps file duration),
 *  each a standalone wav with its own 44-byte header. Pure + unit-testable. */
export function splitWavChunks(buf: Buffer, maxChunkMs: number): Buffer[] {
  const f = wavFacts(buf)
  const bytesPerFrame = Math.max(1, (f.bitsPerSample / 8) * f.channels)
  const frames = Math.floor(f.dataBytes / bytesPerFrame)
  const chunkFrames = Math.max(1, Math.floor((maxChunkMs / 1000) * f.sampleRate))
  if (frames <= chunkFrames) return [buf]
  const pcm = buf.subarray(f.dataOffset, f.dataOffset + f.dataBytes)
  const chunks: Buffer[] = []
  for (let start = 0; start < frames; start += chunkFrames) {
    const n = Math.min(chunkFrames, frames - start)
    const body = pcm.subarray(start * bytesPerFrame, (start + n) * bytesPerFrame)
    const head = Buffer.alloc(44)
    head.write('RIFF', 0); head.writeUInt32LE(36 + body.length, 4); head.write('WAVE', 8)
    head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(f.channels, 22)
    head.writeUInt32LE(f.sampleRate, 24); head.writeUInt32LE(f.sampleRate * bytesPerFrame, 28)
    head.writeUInt16LE(bytesPerFrame, 32); head.writeUInt16LE(f.bitsPerSample, 34)
    head.write('data', 36); head.writeUInt32LE(body.length, 40)
    chunks.push(Buffer.concat([head, body]))
  }
  return chunks
}

export async function runTranscribeStage(call: Call, wav: MediaAsset | null): Promise<SttOutput> {
  if (config.stt.binding === 'whisper' && wav) {
    try {
      return await runWhisperBinding(call, vaultPath(wav.filePath))
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      logger.warn('local whisper binding failed', { callId: call.id, error: reason })
      throw new Error(`Local transcription failed: ${reason}`)
    }
  }

  // Scripted sidecars are useful for demos but cannot transcribe real recordings.
  const scripted = mockTranscript(call, wav)
  if (!scripted.segments.length) {
    throw new Error('Local transcription is not configured. Install whisper-ctranslate2 and set WHISPER_BINDING=whisper.')
  }
  return scripted
}

/** Word-count gate: under 25 words is TRANSCRIBE_EMPTY, not ANALYZING (Table 3.6). */
export function wordCountOf(segments: SttSegment[]): number {
  return segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0)
}
