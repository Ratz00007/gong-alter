// AMBER — idempotent seed (Ch. 4 migration policy rule 4): settings, redaction rules,
// prompt templates. Safe to re-run; never overwrites user edits.
import { getDb } from './db'
import { seedPromptTemplates } from './seed-prompts'
import { logger } from './logger'

// ---------- Setting defaults (Table 11.2) ----------
export const SETTING_DEFAULTS: Record<string, unknown> = {
  'budget.monthlyCapUsd': 5.0,
  'providers.mockEnabled': true, // sandbox/demo; disable once real providers are configured
  'providers.zaiEnabled': true, // bundled platform cloud provider; kill switch for eval/tests/offline
  'stt.cloudEgressEnabled': false, // cloud STT (audio egress) — opt-in only, never default
  'rubric.v1': {
    version: 'v1',
    dimensions: [
      { key: 'discovery', weight: 0.25, fullMarks: 'Open questions surfaced pain, metrics, and process; prospect spoke unprompted about their world; at least 4 diagnostic questions' },
      { key: 'value', weight: 0.20, fullMarks: 'Value stated in the prospect\'s metrics, tied to named pain; no unexplained jargon monologues' },
      { key: 'objections', weight: 0.15, fullMarks: 'Objections acknowledged, isolated, and answered or parked honestly; no steamrolling' },
      { key: 'next_step', weight: 0.15, fullMarks: 'A specific next step with a date agreed before the call ends' },
      { key: 'talk_balance', weight: 0.15, fullMarks: 'Rep talk ratio 40-60%; no monologue over 120 seconds; questions outnumber statements in discovery' },
      { key: 'rapport', weight: 0.10, fullMarks: 'Natural openings, names used, humor or warmth present without time theft' },
    ],
  },
  'competitors.list': ['Salesforce', 'HubSpot', 'Zoho', 'Pipedrive'],
  'prices.openai': { 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
  'prices.anthropic': { 'claude-sonnet': { input: 3.0, output: 15.0 } },
  'prices.gemini': { 'gemini-flash': { input: 0.1, output: 0.4 } },
  'prices.zai': { 'glm-4.6': { input: 0, output: 0 } }, // platform-provided in hosted sandbox; personal installs price their own endpoint
  // OAuth provider apps (user-supplied; browser sign-in, tokens sealed on disk)
  'integrations.gmailClientId': '',
  'integrations.gmailClientSecret': '',
  'integrations.outlookClientId': '',
  'integrations.outlookTenantId': 'common',
  'ui.tone': 'warm-professional',
  'redaction.nerEnabled': true,
  'transcript.readerFont': 'serif',
  'search.minScore': 0.24,
  'pipeline.autoArchiveDays': 0,
  'health.formulaVersion': 'v1',
  'schemaFeature': 1,
}

// ---------- Redaction rules (Ch. 8; priority lower runs first) ----------
// Order matters: IBAN and card patterns must run BEFORE the greedy phone
// matcher, or card-like digit groups get masked as [PHONE] instead of skipped.
const REDACTION_RULES = [
  { name: 'Email addresses', patternType: 'REGEX' as const, pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', action: 'MASK' as const, replacement: '[EMAIL]', scope: 'ALL' as const, priority: 10 },
  { name: 'IBAN', patternType: 'REGEX' as const, pattern: '\\b[A-Z]{2}[0-9]{2}(?:\\s?[A-Z0-9]{4}){3,7}(?:\\s?[A-Z0-9]{2})?\\b', action: 'MASK' as const, replacement: '[IBAN]', scope: 'ALL' as const, priority: 15 },
  { name: 'Credit card numbers', patternType: 'REGEX' as const, pattern: '\\b(?:[0-9][ -]?){13,19}\\b', action: 'SKIP' as const, scope: 'ALL' as const, priority: 20 },
  { name: 'Phone numbers (E.164 and common formats)', patternType: 'REGEX' as const, pattern: '(\\+?[0-9][0-9 ()-]{7,18}[0-9])', action: 'MASK' as const, replacement: '[PHONE]', scope: 'ALL' as const, priority: 25 },
  { name: 'Person names', patternType: 'NER' as const, entityType: 'PERSON' as const, action: 'REPLACE' as const, replacement: '<PERSON>', scope: 'ALL' as const, priority: 50 },
  { name: 'Organization names', patternType: 'NER' as const, entityType: 'ORG' as const, action: 'MASK' as const, replacement: '[ORG]', scope: 'CLOUD_ONLY' as const, priority: 60 },
  { name: 'Monetary amounts', patternType: 'NER' as const, entityType: 'AMOUNT' as const, action: 'MASK' as const, replacement: '[AMOUNT]', scope: 'CLOUD_ONLY' as const, priority: 70 },
]

// ---------- Live Assist battlecards (WO-LA1, FR-026/029) ----------
// Seeded by name (idempotent); user edits and additions are never overwritten.
const LIVE_CUES = [
  {
    name: 'Pricing objection',
    category: 'OBJECTION',
    kind: 'PHRASE',
    triggers: ['too expensive', 'too pricey', 'price is high', 'out of budget', 'budget is tight', 'costs too much'],
    guidance: 'Anchor value before defending price: ask what they compare it against, restate their named pain in their metrics, and offer the tier trade-off instead of a discount.',
    cooldownSec: 240,
    sortOrder: 10,
  },
  {
    name: 'Competitor mentioned',
    category: 'COMPETITOR',
    kind: 'PHRASE',
    triggers: ['gong', 'chorus', 'outreach', 'salesloft', 'clari copilot'],
    guidance: 'Do not attack. Ask what is working and what is missing, then position one difference that maps to the stated gap. Log the mention — it becomes a risk signal post-call.',
    cooldownSec: 300,
    sortOrder: 20,
  },
  {
    name: 'Security / compliance concern',
    category: 'OBJECTION',
    kind: 'PHRASE',
    triggers: ['security', 'compliance', 'soc 2', 'gdpr', 'data protection', 'encryption'],
    guidance: 'Acknowledge, then get specific: data residency, retention, and who can access recordings. Offer the security pack as the next-step artifact instead of improvising.',
    cooldownSec: 240,
    sortOrder: 30,
  },
  {
    name: 'Procurement / legal step',
    category: 'PROCESS',
    kind: 'PHRASE',
    triggers: ['procurement', 'legal review', 'contract', 'signature', 'sign the deal', 'paper process'],
    guidance: 'Confirm the paper path now: who signs, who reviews, how long each step takes. Set the next step as the contract delivery date, not a vague "send it over".',
    cooldownSec: 300,
    sortOrder: 40,
  },
  {
    name: 'Vague follow-up risk',
    category: 'PROCESS',
    kind: 'PHRASE',
    triggers: ['send me some information', 'send something over', 'let me think about it', 'circle back'],
    guidance: 'This is where deals stall. Propose a concrete alternative: "I will send the two-pager today and we book 20 minutes Thursday to walk the numbers — does 10:00 work?"',
    cooldownSec: 300,
    sortOrder: 50,
  },
  {
    name: 'Timeline surfaced',
    category: 'PROCESS',
    kind: 'PHRASE',
    triggers: ['timeline', 'when do you need', 'by when', 'end of quarter', 'deadline'],
    guidance: 'Lock the decision date: what happens if it slips, and what has to be true before then. This is MEDDIC decision criteria — capture it verbatim.',
    cooldownSec: 240,
    sortOrder: 60,
  },
  {
    name: 'Existing tool / status quo',
    category: 'COMPETITOR',
    kind: 'PHRASE',
    triggers: ['currently using', 'we already have', 'existing tool', 'status quo', 'we do this manually'],
    guidance: 'Discover before differentiating: what does the current workflow cost them per week, and where exactly does it break? No pitch until the breakage is named.',
    cooldownSec: 300,
    sortOrder: 70,
  },
  {
    name: 'Ask a question (cadence rule)',
    category: 'COACHING',
    kind: 'RULE_NO_QUESTION',
    triggers: { wordsSinceQuestion: 120 },
    guidance: 'You have been talking for a while. Ask an open question — the best closers listen more than they speak.',
    cooldownSec: 180,
    sortOrder: 80,
  },
]

export async function runSeed(): Promise<void> {
  const db = getDb()

  // Settings: insert defaults only where the key is missing (user edits win).
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    const existing = await db.setting.findUnique({ where: { key } })
    if (!existing) {
      await db.setting.create({ data: { key, value: value as object } })
    }
  }

  // Redaction rules: idempotent by name — re-running refreshes pattern/priority
  // (handles catalog corrections on existing installs without hand-edited SQL).
  for (const r of REDACTION_RULES) {
    const existing = await db.redactionRule.findFirst({ where: { name: r.name } })
    if (existing) {
      await db.redactionRule.update({ where: { id: existing.id }, data: r })
    } else {
      await db.redactionRule.create({ data: r })
    }
  }

  // Prompt templates: one active version per task.
  await seedPromptTemplates(db)

  // Live Assist battlecards: insert by name only (never overwrite user edits).
  for (const cue of LIVE_CUES) {
    const existing = await db.liveCue.findFirst({ where: { name: cue.name } })
    if (!existing) {
      await db.liveCue.create({
        data: {
          name: cue.name,
          category: cue.category,
          kind: cue.kind,
          triggers: cue.triggers as object,
          guidance: cue.guidance,
          cooldownSec: cue.cooldownSec,
          sortOrder: cue.sortOrder,
          enabled: true,
        },
      })
    }
  }

  logger.info('seed complete', { settings: Object.keys(SETTING_DEFAULTS).length, rules: REDACTION_RULES.length, liveCues: LIVE_CUES.length })
}
