// Unit: ZAI adapter internals + cloud-STT sentence segmentation + routing with ZAI.
import { describe, test, expect } from 'bun:test'
import { sentencesToSegments, whisperCommand, wavFacts, splitWavChunks } from '@/lib/pipeline/stt'
import { planRoute } from '@/lib/routing/router'

function makeWav(sampleRate: number, seconds: number): Buffer {
  const frames = sampleRate * seconds
  const body = Buffer.alloc(frames * 2) // 16-bit mono
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + body.length, 4); head.write('WAVE', 8)
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28)
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(body.length, 40)
  return Buffer.concat([head, body])
}

describe('wavFacts + splitWavChunks (platform ASR 30s cap)', () => {
  test('parses a PCM wav header', () => {
    const f = wavFacts(makeWav(16000, 1))
    expect(f.sampleRate).toBe(16000)
    expect(f.channels).toBe(1)
    expect(f.bitsPerSample).toBe(16)
    expect(f.dataBytes).toBe(32000)
  })

  test('short files pass through unsplit', () => {
    const buf = makeWav(16000, 10)
    expect(splitWavChunks(buf, 25_000)).toEqual([buf])
  })

  test('47s file splits into ceil(47/25)=2 valid wavs, bytes preserved', () => {
    const buf = makeWav(24000, 47)
    const chunks = splitWavChunks(buf, 25_000)
    expect(chunks.length).toBe(2)
    for (const c of chunks) {
      const f = wavFacts(c)
      const frameBytes = (f.bitsPerSample / 8) * f.channels
      expect(f.sampleRate).toBe(24000)
      expect(f.dataBytes % 2).toBe(0)
      expect(f.dataBytes / frameBytes / f.sampleRate).toBeLessThanOrEqual(25_000 / 1000 + 0.001)
    }
    const totalFrames = chunks.reduce((n, c) => n + wavFacts(c).dataBytes / 2, 0)
    expect(totalFrames).toBe(24000 * 47)
  })

  test('rejects non-wav buffers honestly', () => {
    expect(() => wavFacts(Buffer.from('not a wav at all'))).toThrow()
  })
})

describe('sentencesToSegments (cloud ASR text -> segments)', () => {
  test('spreads sentences across the duration weighted by word count', () => {
    const text = 'Hello there, thanks for joining. Our team is drowning in manual CRM updates. Can we talk about pricing?'
    const segs = sentencesToSegments(text, 30_000)
    expect(segs.length).toBe(3)
    expect(segs[0].startMs).toBe(0)
    // monotonic, non-overlapping (each ends before the next starts)
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startMs).toBeGreaterThanOrEqual(segs[i - 1].startMs)
    }
    // all text preserved
    expect(segs.map((s) => s.text).join(' ')).toBe(text)
    // every speaker starts unlabeled; relabel pass owns clustering
    expect(segs.every((s) => s.speaker === 'SPEAKER_00')).toBe(true)
  })

  test('tiny durations still get sane spans (no zero-length segments)', () => {
    const segs = sentencesToSegments('One. Two. Three.', 100)
    expect(segs.length).toBe(3)
    for (const s of segs) expect(s.endMs).toBeGreaterThan(s.startMs)
  })

  test('empty / whitespace text returns no segments (honesty gate downstream)', () => {
    expect(sentencesToSegments('   ', 1000)).toEqual([])
  })
})

describe('ZAI routing rows (Table 6.4 additions)', () => {
  const health = (zaiUp: boolean) => ({
    OLLAMA: { up: false, configured: true },
    ZAI: { up: zaiUp, configured: true },
    OPENAI: { up: false, configured: false },
    ANTHROPIC: { up: false, configured: false },
    GEMINI: { up: false, configured: false },
    COMPATIBLE: { up: false, configured: false },
    MOCK: { up: true, configured: true },
  })

  test('sandbox shape (ollama down, keys absent): ZAI is the first live leg, mock behind it', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 4000, routingMode: 'LOCAL_FIRST',
      budget: { spentUsd: 0, capUsd: 5 }, health: health(true), mockEnabled: true,
    })
    expect(r.chain[0].provider).toBe('ZAI')
    expect(r.chain[0].kind).toBe('cloud')
    expect(r.chain.some((c) => c.provider === 'MOCK')).toBe(true)
  })

  test('ZAI unhealthy -> skipped with note, mock still reachable (graceful degradation)', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 4000, routingMode: 'LOCAL_FIRST',
      budget: { spentUsd: 0, capUsd: 5 }, health: health(false), mockEnabled: true,
    })
    expect(r.chain.some((c) => c.provider === 'ZAI')).toBe(false)
    expect(r.chain.some((c) => c.provider === 'MOCK')).toBe(true)
    expect(r.notes.some((n) => n.includes('ZAI'))).toBe(true)
  })

  test('LOCAL_ONLY removes the ZAI cloud leg', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 4000, routingMode: 'LOCAL_ONLY',
      budget: { spentUsd: 0, capUsd: 5 }, health: health(true), mockEnabled: true,
    })
    expect(r.chain.some((c) => c.provider === 'ZAI')).toBe(false)
  })
})

describe('whisperCommand (unchanged contract)', () => {
  test('still builds the faster-whisper invocation', () => {
    const { cmd, args } = whisperCommand('small', 'cpu', 'int8', '/tmp/a.wav')
    expect(cmd).toBe('whisper-ctranslate2')
    expect(args).toContain('small')
    expect(args.at(-1)).toBe('/tmp/a.wav')
  })
})
