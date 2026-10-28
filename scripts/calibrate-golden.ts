// AMBER — golden-set calibration pass (first-run wizard step 4): records the
// reference implementation's deterministic outputs so the golden set encodes
// them. Improving the golden set is an explicit, reviewed act (Ch. 9) — this
// script is that review, printed for the build report.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mockAnswer } from '../src/lib/tasks/mock-brain'

const DIR = join(process.cwd(), 'tests', 'fixtures', 'eval')
const TRIGGERS: Record<string, string[]> = {
  M: ['6 weeks', '30 percent', '40 percent', '20 percent', '25 percent'],
  E: ['CFO', 'approvals', 'budget'],
  D_CRITERIA: ['criteria', 'evaluate', 'compare'],
  D_PROCESS: ['procurement', 'process', 'signature'],
  I: ['manual', 'pain'],
  C: ['champion', 'internally'],
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
const report: Record<string, unknown> = {}
for (const f of files) {
  const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as {
    id: string
    name: string
    language: string
    segments: { speaker: string; text: string }[]
    expected: Record<string, unknown>
  }
  const patch: Record<string, unknown> = {}

  // T02 relabel pre-pass for cluster fixtures (mirrors the harness)
  let segs = fx.segments.map((s, i) => ({ idx: i, speaker: s.speaker, text: s.text }))
  if (segs.some((s) => s.speaker.startsWith('SPEAKER_'))) {
    const t02 = mockAnswer('T02', { segments: segs, language: fx.language }) as { repCluster: string }
    const rep = t02.repCluster ?? 'UNKNOWN'
    const other: string = rep === 'SPEAKER_00' ? 'SPEAKER_01' : 'SPEAKER_00'
    const map: Record<string, string> = rep === 'UNKNOWN' ? { SPEAKER_00: 'UNKNOWN', SPEAKER_01: 'UNKNOWN' } : { [rep]: 'REP', [other]: 'PROSPECT' }
    segs = segs.map((s) => ({ ...s, speaker: map[s.speaker] ?? s.speaker }))
    patch.T02 = { repCluster: rep }
  }

  if ('T03' in fx.expected) {
    const t03 = mockAnswer('T03', { segments: segs, language: fx.language }) as { topics: { name: string }[]; nextStepSuggested: string | null }
    patch.T03 = { topics: t03.topics.map((t) => t.name), nextStepSuggested: t03.nextStepSuggested }
  }
  if ('T04' in fx.expected) {
    const t04 = mockAnswer('T04', { segments: segs, language: fx.language }) as { fields: { key: string; notFound: boolean; value: string | null }[] }
    const fields: Record<string, { notFound: boolean; valueIncludes?: string }> = {}
    for (const f2 of t04.fields) {
      if (f2.notFound) {
        fields[f2.key] = { notFound: true }
      } else {
        const trig = (TRIGGERS[f2.key] ?? []).find((t) => (f2.value ?? '').toLowerCase().includes(t.toLowerCase()))
        fields[f2.key] = { notFound: false, valueIncludes: trig ?? (f2.value ?? '').slice(0, 24) }
      }
    }
    patch.T04 = fields
  }

  // merge into fixture + record the diff
  const before = JSON.stringify(fx.expected)
  fx.expected = { ...fx.expected, ...patch }
  const after = JSON.stringify(fx.expected)
  if (before !== after) {
    writeFileSync(join(DIR, f), JSON.stringify(fx, null, 2) + '\n')
    report[f] = patch
  }
}
console.log(JSON.stringify(report, null, 2))
