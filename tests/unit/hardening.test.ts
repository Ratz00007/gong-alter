// Unit: P0/P1 hardening regression tests — stateful /g regex redaction, newline sentence splitting,
// multi-signal speaker diarization, and realistic router token cost estimation.
import { describe, test, expect } from 'bun:test'
import { sync as syncRedact } from '@/lib/redact/sync'
import { pauseClusterSpeakers } from '@/lib/pipeline/diarize'
import { estimateCost } from '@/lib/routing/router'
import { createSessionToken, verifySessionToken } from '@/lib/auth'

describe('P0 redaction hardening (stateful /g lastIndex & newline splitting)', () => {
  test('two consecutive sentences matching a SKIP rule (credit cards) are BOTH skipped', () => {
    const input = [
      'First card is 4111 1111 1111 1111 on file.',
      'Backup card is 5500 0000 0000 0004 for emergencies.',
      'Everything else is approved for Tuesday.',
    ].join(' ')
    const out = syncRedact(input)
    expect(out).not.toContain('4111 1111')
    expect(out).not.toContain('5500 0000')
    expect(out).toContain('Everything else is approved for Tuesday.')
  })

  test('newline-joined transcripts split cleanly on SKIP rules without wiping valid lines', () => {
    const input = [
      'Welcome to the discovery call.',
      'My card number is 4111 1111 1111 1111 please do not share it.',
      'We want to roll out to 40 reps next month.',
    ].join('\n')
    const out = syncRedact(input)
    expect(out).toContain('Welcome to the discovery call.')
    expect(out).not.toContain('4111 1111')
    expect(out).toContain('We want to roll out to 40 reps next month.')
  })
})

describe('P0 multi-signal speaker diarization', () => {
  test('does not flip speaker on a short mid-thought pause, but switches on question-answer turn', () => {
    const segments = [
      { idx: 0, speaker: 'SPEAKER_00', startMs: 0, endMs: 2500, text: 'We are looking at replacing our current spreadsheets' },
      // 850ms breath pause mid-explanation (no question mark, no response marker)
      { idx: 1, speaker: 'SPEAKER_00', startMs: 3350, endMs: 6000, text: 'because the manual rollups take six hours every Friday.' },
      // Rep asks a question
      { idx: 2, speaker: 'SPEAKER_00', startMs: 8000, endMs: 10500, text: 'How many managers are involved in that Friday review?' },
      // Prospect answers
      { idx: 3, speaker: 'SPEAKER_00', startMs: 11200, endMs: 14000, text: 'Yeah, four regional directors and the VP of Sales.' },
    ]
    const labeled = pauseClusterSpeakers(segments)
    expect(labeled[0].speaker).toBe('SPEAKER_00')
    expect(labeled[1].speaker).toBe('SPEAKER_00')
    expect(labeled[2].speaker).not.toBe(labeled[3].speaker)
  })
})

describe('P1 router cost estimation & session HMAC', () => {
  test('estimateCost prices realistic prompt tokens rather than the full context window', () => {
    const model = {
      provider: 'GEMINI' as const,
      model: 'gemini-2.0-flash',
      contextTokens: 1_000_000,
      pricePerMTokens: { input: 0.1, output: 0.4 },
    }
    const cost = estimateCost(model, { inputTokens: 1000, outputTokens: 500 })
    // 1000 * $0.10/1M + 500 * $0.40/1M = $0.0001 + $0.0002 = $0.0003
    expect(cost).toBeCloseTo(0.0003, 6)
    const defaultCost = estimateCost(model)
    expect(defaultCost).toBeLessThan(0.01)
  })

  test('session token creation and HMAC verification round-trip cleanly', () => {
    const { token } = createSessionToken()
    const verified = verifySessionToken(token)
    expect(verified).not.toBeNull()
    expect(verifySessionToken(`${token}tampered`)).toBeNull()
  })
})
