// Repro: run T04 (MEDDIC extraction) through the REAL ZAI adapter with the
// seeded prompt + the live demo transcript; print raw output and schema diff.
import { getDb } from '../src/lib/db'
import { getActiveTemplate, render } from '../src/lib/prompts/engine'
import { zaiChat } from '../src/lib/providers/zai'
import { TASK_SCHEMAS } from '../src/lib/tasks/registry'

async function main() {
  const db = getDb()
  const callId = 'cmvnye2i10002wrkny61b08k4'
  const transcript = await db.transcript.findFirst({ where: { callId }, include: { segments: { orderBy: { idx: 'asc' } } } })
  if (!transcript) throw new Error('no transcript')
  const segments = transcript.segments.map((s, i) => ({ idx: i, speaker: s.speaker, text: s.text }))

  const template = await getActiveTemplate('T04')
  if (!template) throw new Error('no T04 template')
  const vars = {
    segments: segments.map((s) => `[${s.idx}] ${s.speaker}: ${s.text}`).join('\n'),
    language: 'en',
    dealContext: '(none)',
  }
  const system = template.systemPrompt
  const user = render(template.userTemplate, vars)
  console.log('PROMPT user (first 300):', user.slice(0, 300), '...\n')

  const res = await zaiChat.chat({ model: 'glm-4.6', system, user, temperature: 0.2, maxTokens: 2048 })
  console.log('RAW RESPONSE (first 1500):\n', res.text.slice(0, 1500), '\n')

  // try parse
  const cleaned = res.text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const jsonText = start >= 0 ? cleaned.slice(start) : cleaned
  try {
    const parsed = JSON.parse(jsonText)
    console.log('JSON PARSED OK. Top keys:', Object.keys(parsed))
    const check = TASK_SCHEMAS.T04.safeParse(parsed)
    console.log('SCHEMA:', check.success ? 'PASS' : 'FAIL')
    if (!check.success) {
      console.log('ISSUES:', JSON.stringify(check.error.issues.slice(0, 8), null, 1).slice(0, 1200))
    }
  } catch (e) {
    console.log('JSON PARSE FAIL:', e instanceof Error ? e.message : String(e))
  }
}

main()
