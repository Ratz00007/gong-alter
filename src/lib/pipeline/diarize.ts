// AMBER — diarization + speaker relabel (WO-011, T02). Cluster labels come from
// the STT path (scripted turns or pause clustering); one LLM pass decides which
// cluster is REP. Provenance: the T02 ProviderRun row.
import { readFileSync, existsSync } from 'node:fs'
import { getDb } from '../db'
import { runTask } from '../tasks/engine'
import type { Segment, Transcript } from '@prisma/client'

export interface RelabelResult {
  repCluster: 'SPEAKER_00' | 'SPEAKER_01' | 'UNKNOWN'
  mapping: Record<string, 'REP' | 'PROSPECT' | 'UNKNOWN'>
}

interface SegmentInput {
  startMs: number
  endMs: number
  text: string
  speaker: string
}

function extractAcousticFeatures(buf: Buffer, segments: SegmentInput[]): number[][] | null {
  try {
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
    const channels = buf.readUInt16LE(22)
    const sampleRate = buf.readUInt32LE(24)
    const bitsPerSample = buf.readUInt16LE(34)
    if (bitsPerSample !== 16 || channels === 0 || sampleRate === 0) return null

    let off = 12
    let dataOffset = -1
    let dataBytes = 0
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4)
      const size = buf.readUInt32LE(off + 4)
      if (id === 'data') {
        dataOffset = off + 8
        dataBytes = Math.min(size, buf.length - dataOffset)
        break
      }
      off += 8 + size + (size % 2)
    }
    if (dataOffset < 0 || dataBytes <= 0) return null

    const totalSamples = Math.floor(dataBytes / (2 * channels))
    const features: number[][] = []

    for (const seg of segments) {
      const startSample = Math.max(0, Math.min(totalSamples - 1, Math.floor((seg.startMs / 1000) * sampleRate)))
      const endSample = Math.max(startSample + 1, Math.min(totalSamples, Math.ceil((seg.endMs / 1000) * sampleRate)))
      const nSamples = endSample - startSample

      if (nSamples < 10) {
        features.push([0, 0, 0])
        continue
      }

      let sumSq = 0
      let zeroCrossings = 0
      let prevVal = 0

      const step = Math.max(1, Math.floor(nSamples / 16000))
      const sampleVals: number[] = []

      for (let s = startSample; s < endSample; s += step) {
        let sampleVal = 0
        for (let ch = 0; ch < channels; ch++) {
          const byteIdx = dataOffset + (s * channels + ch) * 2
          if (byteIdx + 2 <= buf.length) {
            sampleVal += buf.readInt16LE(byteIdx) / 32768
          }
        }
        sampleVal /= channels
        sampleVals.push(sampleVal)

        sumSq += sampleVal * sampleVal
        if (sampleVals.length > 1 && sampleVal * prevVal < 0) {
          zeroCrossings++
        }
        prevVal = sampleVal
      }

      const count = sampleVals.length
      const rms = Math.sqrt(sumSq / Math.max(1, count))
      const logRms = Math.log(Math.max(1e-5, rms))
      const zcr = zeroCrossings / Math.max(1, count)

      const effSampleRate = sampleRate / step
      const minLag = Math.max(1, Math.floor(effSampleRate / 400))
      const maxLag = Math.min(sampleVals.length - 1, Math.floor(effSampleRate / 80))
      let maxCorr = -1
      let bestLag = minLag

      if (maxLag > minLag && count > maxLag * 2) {
        for (let lag = minLag; lag <= maxLag; lag += 2) {
          let num = 0
          let denom1 = 0
          let denom2 = 0
          const checkN = Math.min(count - lag, 500)
          for (let i = 0; i < checkN; i++) {
            num += sampleVals[i] * sampleVals[i + lag]
            denom1 += sampleVals[i] * sampleVals[i]
            denom2 += sampleVals[i + lag] * sampleVals[i + lag]
          }
          const corr = num / (Math.sqrt(denom1 * denom2) || 1)
          if (corr > maxCorr) {
            maxCorr = corr
            bestLag = lag
          }
        }
      }

      features.push([logRms, zcr, bestLag])
    }

    return features
  } catch {
    return null
  }
}

function clusterByAcoustics(features: number[][]): ('SPEAKER_00' | 'SPEAKER_01')[] | null {
  const n = features.length
  if (n <= 1) return ['SPEAKER_00']
  const dims = features[0].length

  const means = new Array(dims).fill(0)
  for (const f of features) {
    for (let d = 0; d < dims; d++) means[d] += f[d]
  }
  for (let d = 0; d < dims; d++) means[d] /= n

  const variances = new Array(dims).fill(0)
  for (const f of features) {
    for (let d = 0; d < dims; d++) {
      variances[d] += (f[d] - means[d]) ** 2
    }
  }
  for (let d = 0; d < dims; d++) variances[d] /= n

  const totalVariance = variances.reduce((a, b) => a + b, 0)
  if (totalVariance < 1e-4) return null

  const stds = variances.map((v) => Math.sqrt(v) || 1)
  const normFeatures = features.map((f) => f.map((val, d) => (val - means[d]) / stds[d]))

  const sums = normFeatures.map((f) => f.reduce((a, b) => a + b, 0))
  let minIdx = 0
  let maxIdx = 0
  for (let i = 1; i < n; i++) {
    if (sums[i] < sums[minIdx]) minIdx = i
    if (sums[i] > sums[maxIdx]) maxIdx = i
  }

  if (minIdx === maxIdx) return null

  let c0 = [...normFeatures[minIdx]]
  let c1 = [...normFeatures[maxIdx]]
  const assignments = new Array<'SPEAKER_00' | 'SPEAKER_01'>(n).fill('SPEAKER_00')

  for (let iter = 0; iter < 10; iter++) {
    let changed = false
    const group0: number[][] = []
    const group1: number[][] = []

    for (let i = 0; i < n; i++) {
      const f = normFeatures[i]
      const d0 = (f[0] - c0[0]) ** 2 + (f[1] - c0[1]) ** 2 + (f[2] - c0[2]) ** 2
      const d1 = (f[0] - c1[0]) ** 2 + (f[1] - c1[1]) ** 2 + (f[2] - c1[2]) ** 2
      const newAssign = d0 <= d1 ? 'SPEAKER_00' : 'SPEAKER_01'
      if (newAssign !== assignments[i]) {
        assignments[i] = newAssign
        changed = true
      }
      if (newAssign === 'SPEAKER_00') group0.push(f)
      else group1.push(f)
    }

    if (!changed || group0.length === 0 || group1.length === 0) break

    c0 = [0, 1, 2].map((d) => group0.reduce((s, x) => s + x[d], 0) / group0.length)
    c1 = [0, 1, 2].map((d) => group1.reduce((s, x) => s + x[d], 0) / group1.length)
  }

  const smoothed = [...assignments]
  for (let i = 1; i < n - 1; i++) {
    if (smoothed[i - 1] === smoothed[i + 1] && smoothed[i] !== smoothed[i - 1]) {
      smoothed[i] = smoothed[i - 1]
    }
  }

  return smoothed
}

function clusterByConversationalTurns(segments: SegmentInput[]): ('SPEAKER_00' | 'SPEAKER_01')[] {
  const n = segments.length
  if (n === 0) return []
  const assignments: ('SPEAKER_00' | 'SPEAKER_01')[] = ['SPEAKER_00']
  let currentSpeaker: 'SPEAKER_00' | 'SPEAKER_01' = 'SPEAKER_00'

  const repPrefix = /^(?:rep|agent|host|sales|seller|speake?r[\s_-]*0?0?)\s*:\s*/i
  const prospectPrefix = /^(?:prospect|customer|client|buyer|guest|speake?r[\s_-]*0?1?)\s*:\s*/i
  const responseMarker = /^(?:yes|yeah|yep|sure|no|nope|hi|hello|hey|thanks|thank you|ok|okay|got it|sounds good|definitely|absolutely|right|correct)\b/i

  for (let i = 1; i < n; i++) {
    const prev = segments[i - 1]
    const curr = segments[i]
    const gapMs = curr.startMs - prev.endMs
    const prevText = prev.text.trim()
    const currText = curr.text.trim()

    let switchSpeaker = false
    if (repPrefix.test(currText)) {
      currentSpeaker = 'SPEAKER_00'
    } else if (prospectPrefix.test(currText)) {
      currentSpeaker = 'SPEAKER_01'
    } else {
      const prevEndsQuestion = prevText.endsWith('?')
      const isResponse = responseMarker.test(currText)
      const prevSentenceEnd = /[.?!]$/.test(prevText)
      const longSilenceCompleted = gapMs >= 1500 && prevSentenceEnd

      if (prevEndsQuestion || isResponse || longSilenceCompleted) {
        switchSpeaker = true
      }
      if (switchSpeaker) {
        currentSpeaker = currentSpeaker === 'SPEAKER_00' ? 'SPEAKER_01' : 'SPEAKER_00'
      }
    }
    assignments.push(currentSpeaker)
  }

  return assignments
}

/** Multi-signal speaker diarization for whisper output (glossary: pause clustering + LLM relabel). */
export function pauseClusterSpeakers(
  segments: { startMs: number; endMs: number; text: string; speaker: string }[],
  wavPath?: string,
): { speaker: string; startMs: number; endMs: number; text: string }[] {
  if (segments.length === 0) return []
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)

  // (a) If segments already have >1 distinct speaker, preserve them.
  const distinct = new Set(sorted.map((s) => s.speaker))
  if (distinct.size > 1) {
    return sorted
  }

  // (b) If wavPath exists on disk and is a valid 16-bit PCM WAV:
  let clusters: ('SPEAKER_00' | 'SPEAKER_01')[] | null = null
  if (wavPath && existsSync(wavPath)) {
    try {
      const buf = readFileSync(wavPath)
      const features = extractAcousticFeatures(buf, sorted)
      if (features) {
        clusters = clusterByAcoustics(features)
      }
    } catch {}
  }

  // (c) When no WAV is available (or acoustic variance is flat), use conversational turn-taking heuristics:
  if (!clusters) {
    clusters = clusterByConversationalTurns(sorted)
  }

  return sorted.map((s, i) => ({
    ...s,
    speaker: clusters![i] ?? 'SPEAKER_00',
  }))
}

export async function relabelSpeakers(callId: string, transcript: Transcript & { segments: Segment[] }): Promise<RelabelResult> {
  const db = getDb()
  const ordered = [...transcript.segments].sort((a, b) => a.idx - b.idx)
  const clusters = new Set(ordered.map((s) => s.speaker))
  const needsRelabel = clusters.has('SPEAKER_00') || clusters.has('SPEAKER_01')

  if (!needsRelabel) {
    // Already labeled (e.g. resume after crash); nothing to do — idempotent re-entry.
    return { repCluster: 'UNKNOWN', mapping: {} }
  }

  const ctxSegments = ordered.map((s) => ({ idx: s.idx, speaker: s.speaker, text: s.text }))
  const { data } = await runTask('T02', {
    callId,
    ctx: { segments: ctxSegments, language: transcript.language },
  })
  const repCluster = (data as { repCluster?: 'SPEAKER_00' | 'SPEAKER_01' | 'UNKNOWN' }).repCluster ?? 'UNKNOWN'
  const other: 'SPEAKER_00' | 'SPEAKER_01' = repCluster === 'SPEAKER_00' ? 'SPEAKER_01' : 'SPEAKER_00'
  let mapping: Record<string, 'REP' | 'PROSPECT' | 'UNKNOWN'>
  if (repCluster === 'UNKNOWN') {
    mapping = { SPEAKER_00: 'UNKNOWN', SPEAKER_01: 'UNKNOWN' }
  } else if (clusters.size <= 1) {
    mapping = { [repCluster]: 'REP' } as Record<string, 'REP'>
  } else {
    mapping = { [repCluster]: 'REP', [other]: 'PROSPECT' } as Record<string, 'REP' | 'PROSPECT'>
  }

  await db.$transaction(
    ordered.map((s) =>
      db.segment.update({
        where: { id: s.id },
        data: { speaker: (mapping[s.speaker as string] ?? 'UNKNOWN') as 'REP' | 'PROSPECT' | 'UNKNOWN' },
      }),
    ),
  )
  return { repCluster, mapping }
}
