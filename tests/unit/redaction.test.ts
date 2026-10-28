// Unit: redaction (T09) — zero leaks on the G10 torture fixture, bounded over-redaction;
// mock-brain determinism + the honesty contract (NOT_FOUND on thin calls).
import { describe, test, expect } from 'bun:test'
import { sync as syncRedact } from '@/lib/redact/sync'
import { mockAnswer, mockEmbedVectors } from '@/lib/tasks/mock-brain'

const torture = [
  'Send the details to sarah.klein@northwind-gmbh.de and copy ops@northwind-gmbh.de on anything final.',
  'Also +49 171 555 0123 reaches me directly; the office is +353 1 555 0199.',
  'For the wire, our IBAN is DE89 3704 0044 0532 0130 00, and the budget band is 40,000 EUR.',
  'My card 4111 1111 1111 1111 expired anyway, so use the IBAN. Sarah Klein will countersign.',
].join(' ')

describe('redaction T09 (egress boundary)', () => {
  test('zero known-pattern leaks (the build-failing invariant, NFR-05)', () => {
    const out = syncRedact(torture)
    const leaks = ['sarah.klein@northwind-gmbh.de', '+49 171 555 0123', 'DE89 3704 0044 0532 0130 00', '4111 1111 1111 1111', 'Sarah Klein'].filter((p) =>
      out.toLowerCase().includes(p.toLowerCase()),
    )
    expect(leaks).toEqual([])
  })

  test('emails, phones, IBAN, amounts are masked with typed tokens', () => {
    const out = syncRedact(torture)
    expect(out).toContain('[EMAIL]')
    expect(out).toContain('[PHONE]')
    expect(out).toContain('[IBAN]')
    expect(out).toContain('[AMOUNT]')
  })

  test('card numbers SKIP the containing sentence entirely', () => {
    const out = syncRedact('My card 4111 1111 1111 1111 expired anyway, so use the IBAN. Sarah Klein will countersign.')
    expect(out).not.toContain('expired anyway')
    expect(out).toContain('countersign')
  })

  test('over-redaction is bounded, not zero (legit prose survives)', () => {
    const clean = 'The onboarding takes 6 weeks and reporting is manual. It is the biggest pain honestly.'
    const out = syncRedact(clean)
    expect(out).toContain('onboarding takes 6 weeks')
    expect(out).toContain('biggest pain')
  })
})

describe('mock-brain (Ch. 9 fixture determinism)', () => {
  test('T03 is deterministic for identical input', () => {
    const ctx = {
      segments: [
        { idx: 0, speaker: 'PROSPECT', text: 'Our onboarding takes 6 weeks and reporting is manual, that is the pain.' },
        { idx: 1, speaker: 'REP', text: 'What would cutting the 6 weeks be worth?' },
        { idx: 2, speaker: 'PROSPECT', text: 'The process would be procurement then signature by the end of October.' },
      ],
    }
    const a = mockAnswer('T03', ctx)
    const b = mockAnswer('T03', ctx)
    expect(a).toEqual(b)
  })

  test('T04 honors the honesty contract: thin call -> NOT_FOUND, never hallucinated', () => {
    const out = mockAnswer('T04', {
      segments: [{ idx: 0, speaker: 'PROSPECT', text: 'Nothing much to report this week.' }],
    }) as { fields: { notFound: boolean; key: string }[] }
    for (const f of out.fields) {
      expect(f.notFound).toBe(true)
    }
  })

  test('T04 extracts from a rich call without inventing ids', () => {
    const out = mockAnswer('T04', {
      segments: [
        { idx: 0, speaker: 'PROSPECT', text: 'Our onboarding takes 6 weeks today, all manual, that is the real pain.' },
        { idx: 1, speaker: 'PROSPECT', text: 'The CFO signs after procurement by the end of October.' },
        { idx: 2, speaker: 'PROSPECT', text: 'Criteria are rollout speed and the audit trail. I will champion it internally.' },
      ],
    }) as { fields: { key: string; notFound: boolean; evidenceIdx: number[] }[] }
    const m = out.fields.find((f) => f.key === 'M')!
    expect(m.notFound).toBe(false)
    expect(m.evidenceIdx.every((i) => i >= 0 && i < 3)).toBe(true)
  })

  test('mock embeddings: cosine of identical text is 1, disjoint text near 0', () => {
    const [a, b, c] = mockEmbedVectors(['onboarding takes six weeks', 'onboarding takes six weeks', 'quarterly tax filings'], 768)
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0)
    expect(dot(a, b)).toBeCloseTo(1, 5)
    expect(Math.abs(dot(a, c))).toBeLessThan(0.35)
  })
})
