// AMBER — synchronous redaction for the T09 scorer (Ch. 9): same semantics as the
// async engine, same rule ORDER (IBAN and card before the greedy phone matcher).
import { getDb } from '../db'
import { loadRedactionContext, redactTextWithContext } from './engine'

export function sync(text: string): string {
  const rules: { pattern: RegExp; action: 'MASK' | 'REPLACE' | 'SKIP'; replacement: string; guard?: (m: string, before: string) => boolean }[] = [
    { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, action: 'MASK', replacement: '[EMAIL]' },
    { pattern: /\b[A-Z]{2}[0-9]{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{2})?\b/g, action: 'MASK', replacement: '[IBAN]' },
    { pattern: /\b(?:[0-9][ -]?){13,19}\b/g, action: 'SKIP', replacement: '' },
    { pattern: /(\+?[0-9][0-9 ()-]{7,18}[0-9])/g, action: 'MASK', replacement: '[PHONE]' },
    { pattern: /\b\d[\d.,]*\s?(?:€|EUR|euros?|dollars?|USD|\$|k\b)/gi, action: 'MASK', replacement: '[AMOUNT]' },
    {
      // Capitalized pairs not preceded by an article/common word — catches
      // sentence-start names like "Sarah Klein will countersign."
      pattern: /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g,
      action: 'REPLACE',
      replacement: '<PERSON>',
      guard: (m: string, before: string) => {
        if (/\b(The|A|An|Our|Your|This|These|Those|My|It|We|They|And|But|So|Then)\s+$/.test(before)) return false
        if (/^(The|This|That|These|Those|Our|Your|It|We|They|Thanks|Thank|Hi|Hey|Yes|No|Sure|Well|Also|Then|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(m.split(' ')[0])) return false
        return true
      },
    },
  ]
  let out = text
  for (const r of rules) {
    if (r.action === 'MASK' || r.action === 'REPLACE') {
      if ('guard' in r && typeof r.guard === 'function') {
        const g = r.guard as (m: string, before: string) => boolean
        out = out.replace(r.pattern, (m, ...rest) => {
          const offset = rest[rest.length - 2] as number
          const before = out.slice(Math.max(0, offset - 24), offset)
          return g(m, before) ? (r as { replacement: string }).replacement : m
        })
      } else {
        out = out.replace(r.pattern, r.replacement)
      }
    } else if (r.action === 'SKIP') {
      const sentences = out.split(/(?:(?<=[.!?])\s+|\r?\n+)/)
      const kept = sentences.filter((s) => {
        r.pattern.lastIndex = 0
        return !r.pattern.test(s)
      })
      r.pattern.lastIndex = 0
      if (kept.length !== sentences.length) {
        out = kept.join(' ')
      }
    }
  }
  return out
}

/** Batch segment redaction helper that preloads redaction context once instead of per-segment DB queries. */
export async function syncTranscriptRedaction(callId: string): Promise<number> {
  const db = getDb()
  const transcript = await db.transcript.findUnique({
    where: { callId },
    include: { segments: { orderBy: { idx: 'asc' } } },
  })
  if (!transcript) return 0
  const ctx = await loadRedactionContext('STORAGE')
  let updated = 0
  for (const seg of transcript.segments) {
    const res = redactTextWithContext(seg.text, ctx)
    if (res.changed) {
      await db.segment.update({ where: { id: seg.id }, data: { text: res.redacted } })
      updated++
    }
  }
  if (updated > 0) {
    const fullRes = redactTextWithContext(transcript.fullText, ctx)
    await db.transcript.update({ where: { id: transcript.id }, data: { fullText: fullRes.redacted } })
  }
  return updated
}
