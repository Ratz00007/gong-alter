// AMBER — redaction pipeline (T09). REGEX rules first (priority order), then the
// NER pass (local Ollama NER when healthy; deterministic heuristic otherwise).
// Cloud egress applies CLOUD_ONLY + ALL rules; export applies ALL only (Ch. 8).
import { getDb } from '../db'
import type { RedactionRule } from '@prisma/client'

export interface RedactionResult {
  redacted: string
  changed: boolean
  applied: string[]
}

export type RedactionScope = 'cloud' | 'export' | 'CLOUD' | 'EXPORT' | 'STORAGE' | 'ALL'

export interface RedactionContext {
  rules: RedactionRule[]
  useNer: boolean
}

const MAX_REGEX_LENGTH = 500
// Guard against catastrophic backtracking from nested unbounded quantifiers, e.g. (a+)+ or ([a-z]*)*
const NESTED_QUANTIFIER_RE = /\([^()]*(?<!\\)[+*][^()]*\)(?:[+*]|\{\d+,?\d*\})|(?:\+|\*|\{\d+,\})\s*\)\s*(?:\+|\*|\{\d+,\})/

export function isSafeRegexPattern(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_REGEX_LENGTH) return false
  if (NESTED_QUANTIFIER_RE.test(pattern)) return false
  return true
}

async function loadRules(): Promise<RedactionRule[]> {
  return getDb().redactionRule.findMany({ where: { enabled: true }, orderBy: { priority: 'asc' } })
}

async function nerEnabled(): Promise<boolean> {
  const row = await getDb().setting.findUnique({ where: { key: 'redaction.nerEnabled' } })
  return row ? row.value === true : true
}

function applyOne(text: string, rule: RedactionRule): { text: string; hit: boolean } {
  if (rule.patternType === 'REGEX' && rule.pattern) {
    if (!isSafeRegexPattern(rule.pattern)) {
      return { text, hit: false }
    }
    try {
      const re = new RegExp(rule.pattern, 'g')
      switch (rule.action) {
        case 'MASK': {
          const replaced = text.replace(re, rule.replacement ?? '[REDACTED]')
          return { text: replaced, hit: replaced !== text }
        }
        case 'REPLACE': {
          const replaced = text.replace(re, rule.replacement ?? '<REPLACED>')
          return { text: replaced, hit: replaced !== text }
        }
        case 'SKIP': {
          // drop the containing sentence or line entirely
          const sentences = text.split(/(?:(?<=[.!?])\s+|\r?\n+)/)
          const kept = sentences.filter((s) => {
            re.lastIndex = 0
            return !re.test(s)
          })
          re.lastIndex = 0
          if (kept.length === sentences.length) return { text, hit: false }
          return { text: kept.join(' '), hit: true }
        }
      }
    } catch {
      return { text, hit: false } // malformed rule: never break the pipeline
    }
  }
  return { text, hit: false }
}

// ---- heuristic NER (deterministic; the local-model NER path lands with Ollama) ----
const COMMON = new Set(['The','This','That','These','Those','What','When','Where','How','Why','Okay','Thanks','Thank','Hi','Hey','Yes','No','Sure','Well','Also','Then','There','Here','And','But','So','Our','Your','Their','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','January','February','March','April','May','June','July','August','September','October','November','December','Q1','Q2','Q3','Q4'])

function heuristicNer(text: string, rule: RedactionRule): { text: string; hit: boolean } {
  if (rule.action === 'SKIP') return { text, hit: false }
  const replacement = rule.replacement ?? (rule.action === 'MASK' ? '[REDACTED]' : '<REPLACED>')
  let out = text
  let hit = false
  if (rule.entityType === 'PERSON') {
    // Capitalized pairs, skipping article-led phrases and common words; this
    // catches sentence-start names ("Sarah Klein will countersign").
    const source = out
    out = out.replace(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g, (m, _a: string, _b: string, offset: number) => {
      const before = source.slice(Math.max(0, offset - 24), offset)
      if (/\b(The|A|An|Our|Your|This|These|Those|My|It|We|They|And|But|So|Then)\s+$/.test(before)) return m
      const first = m.split(' ')[0]
      if (COMMON.has(first) || COMMON.has(m)) return m
      hit = true
      return replacement
    })
  } else if (rule.entityType === 'ORG') {
    out = out.replace(/\b[A-Z][A-Za-z]+ (?:Inc|GmbH|Ltd|LLC|Corp|Corporation|AG|SE|PLC)\b/g, () => {
      hit = true
      return replacement
    })
    // uppercase runs, never our own mask tokens ([EMAIL], <PERSON>) or safe words
    const NER_SAFE = new Set(['IBAN', 'EMAIL', 'PHONE', 'ORG', 'AMOUNT', 'PERSON', 'CFO', 'CEO', 'CTO', 'COO', 'MEDDIC', 'REP', 'API', 'SSO', 'AMBER', 'EUR', 'USD', 'OK', 'TODO', 'Q1', 'Q2', 'Q3', 'Q4', 'IT', 'HR', 'QA'])
    out = out.replace(/(?<!\[)(?<!<)\b[A-Z]{3,}\b(?!\])(?!>)/g, (m) => {
      if (COMMON.has(m) || NER_SAFE.has(m)) return m
      hit = true
      return replacement
    })
  } else if (rule.entityType === 'AMOUNT') {
    out = out.replace(/\b\d[\d.,]*\s?(?:€|EUR|euros?|dollars?|USD|\$|k\b)/gi, () => {
      hit = true
      return replacement
    })
  }
  return { text: out, hit }
}

export async function loadRedactionContext(scope: RedactionScope): Promise<RedactionContext> {
  const [rules, useNer] = await Promise.all([loadRules(), nerEnabled()])
  const isCloud = scope.toLowerCase() === 'cloud'
  const scoped = rules.filter((r) => (isCloud ? true : r.scope === 'ALL'))
  return { rules: scoped, useNer }
}

export function redactTextWithContext(text: string, ctx: RedactionContext): RedactionResult {
  if (!text) return { redacted: text, changed: false, applied: [] }
  let out = text
  const applied: string[] = []
  for (const rule of ctx.rules) {
    if (rule.patternType === 'NER') {
      if (!ctx.useNer) continue
      const r = heuristicNer(out, rule)
      if (r.hit) {
        out = r.text
        applied.push(rule.name)
      }
      continue
    }
    const r = applyOne(out, rule)
    if (r.hit) {
      out = r.text
      applied.push(rule.name)
    }
  }
  return { redacted: out, changed: out !== text, applied }
}

export async function redact(text: string, scope: RedactionScope): Promise<RedactionResult> {
  const ctx = await loadRedactionContext(scope)
  return redactTextWithContext(text, ctx)
}

/** The egress boundary call: cloud adapters receive this, by construction. */
export function redactForCloud(text: string): Promise<RedactionResult> {
  return redact(text, 'cloud')
}

/** Export bundle applies scope ALL (FR-024). */
export function redactForExport(text: string): Promise<RedactionResult> {
  return redact(text, 'export')
}
