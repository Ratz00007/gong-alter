// AMBER Live Assist — deterministic cue matcher (WO-LA2, FR-026).
// Zero LLM latency by design: the real-time layer is phrase triggers and
// cadence rules; the heavy reasoning stays in the post-call pipeline.
// Pure functions only — the entire engine is unit-testable without IO.

export interface CueDef {
  id: string
  name: string
  category: string // OBJECTION | COMPETITOR | PROCESS | COACHING
  kind: string // PHRASE | RULE_NO_QUESTION
  triggers: unknown // PHRASE: string[]; RULE: { wordsSinceQuestion: number }
  guidance: string
  cooldownSec: number
  enabled: boolean
}

export interface CueFireResult {
  cueId: string
  name: string
  category: string
  guidance: string
  snippet: string
  atMs: number
}

export interface MatcherState {
  /** cueId -> last fired atMs (session-relative) */
  lastFired: Record<string, number>
  /** rolling word count since the last question mark was seen */
  wordsSinceQuestion: number
}

export function freshMatcherState(): MatcherState {
  return { lastFired: {}, wordsSinceQuestion: 0 }
}

/** Casefold + punctuation-flatten so "Too expensive!" matches "too expensive". */
export function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()} `
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length
}

function parsePhraseTriggers(triggers: unknown): string[] {
  if (Array.isArray(triggers)) return triggers.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
  return []
}

function parseRuleThreshold(triggers: unknown): number {
  if (triggers && typeof triggers === 'object' && !Array.isArray(triggers)) {
    const v = (triggers as Record<string, unknown>).wordsSinceQuestion
    if (typeof v === 'number' && v > 0) return v
  }
  return 120
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Grab a short window around the first match for the audit trail. */
function snippetAround(normalizedDelta: string, phrase: string): string {
  const escaped = escapeRegex(phrase)
  const re = new RegExp(`(?:^|\\W)(${escaped})(?:$|\\W)`, 'i')
  const match = re.exec(normalizedDelta)
  if (!match) return phrase
  const matchIdx = match.index + match[0].indexOf(match[1])
  const from = Math.max(0, matchIdx - 30)
  const to = Math.min(normalizedDelta.length, matchIdx + phrase.length + 30)
  return normalizedDelta.slice(from, to).trim()
}

/**
 * Run one text delta through the cue set.
 * Mutates `state` (cooldown bookkeeping + question cadence) and returns fires.
 */
export function matchDelta(
  delta: string,
  atMs: number,
  cues: CueDef[],
  state: MatcherState,
): { fires: CueFireResult[]; words: number; questions: number } {
  const words = countWords(delta)
  const questions = countQuestions(delta)
  const normalized = normalize(delta)
  const fires: CueFireResult[] = []

  // cadence bookkeeping BEFORE rule evaluation: the words just spoken count,
  // and a question in this delta cancels the nudge (they just asked one)
  state.wordsSinceQuestion = questions > 0 ? 0 : state.wordsSinceQuestion + words

  for (const cue of cues) {
    if (!cue.enabled) continue
    const last = state.lastFired[cue.id]
    if (last !== undefined && atMs - last < cue.cooldownSec * 1000) continue

    if (cue.kind === 'PHRASE') {
      const hit = parsePhraseTriggers(cue.triggers).find((p) => {
        const cleaned = normalize(p).trim()
        if (!cleaned) return false
        const escaped = escapeRegex(cleaned)
        const re = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, 'i')
        return re.test(normalized)
      })
      if (hit) {
        state.lastFired[cue.id] = atMs
        fires.push({
          cueId: cue.id,
          name: cue.name,
          category: cue.category,
          guidance: cue.guidance,
          snippet: snippetAround(normalized, normalize(hit).trim()),
          atMs,
        })
      }
    } else if (cue.kind === 'RULE_NO_QUESTION') {
      if (state.wordsSinceQuestion >= parseRuleThreshold(cue.triggers)) {
        state.lastFired[cue.id] = atMs
        fires.push({
          cueId: cue.id,
          name: cue.name,
          category: cue.category,
          guidance: cue.guidance,
          snippet: `${state.wordsSinceQuestion} words since your last question`,
          atMs,
        })
      }
    }
  }

  return { fires, words, questions }
}

export const matchLiveCues = matchDelta
