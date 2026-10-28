// AMBER — mock-brain: deterministic per-task answers for the mock provider.
// This is a TEST FIXTURE (Ch. 9), not a model: heuristics over the task context
// produce schema-valid outputs so the pipeline, gates, ledger and eval harness
// are all exercisable offline. Quality is honest about absence (NOT_FOUND).
import type { TaskContext, MockTaskId } from './registry'

interface Seg { idx: number; speaker: string; text: string }

const STOP = new Set(['the','a','an','and','or','but','if','then','else','for','to','of','in','on','at','by','with','from','as','is','are','was','were','be','been','it','its','this','that','these','those','i','you','we','they','he','she','them','our','your','their','my','me','us','what','how','why','when','where','who','do','does','did','can','could','would','should','will','have','has','had','not','no','yes','so','like','just','really','about','into','over','than','them','there','here','also','more','some','any','all','get','got','let','okay','right','sure','well','one','two','up','out','down','off','your','you','and','our'])

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t))
}

function contentWords(text: string): string[] {
  return tokenize(text)
}

function findSeg(segs: Seg[], re: RegExp, afterIdx = -1): { idx: number; quote: string; text: string } | null {
  for (const s of segs) {
    if (s.idx <= afterIdx) continue
    const m = s.text.match(re)
    if (m) return { idx: s.idx, quote: m[0], text: s.text }
  }
  return null
}

function topTopics(segs: Seg[], n = 2): { name: string; segmentIdx: number[] }[] {
  const freq = new Map<string, number>()
  const where = new Map<string, number[]>()
  for (const s of segs) {
    for (const w of new Set(contentWords(s.text))) {
      freq.set(w, (freq.get(w) ?? 0) + 1)
      where.set(w, [...(where.get(w) ?? []), s.idx])
    }
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  return ranked.map(([name, _c]) => ({ name, segmentIdx: (where.get(name) ?? []).slice(0, 3) }))
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

// ---------------- per-task deterministic answers ----------------

function t02(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const q = (sp: string) => segs.filter((s) => s.speaker === sp && s.text.includes('?')).length
  const c00 = 'SPEAKER_00', c01 = 'SPEAKER_01'
  const q00 = q(c00), q01 = q(c01)
  let repCluster: string = 'UNKNOWN'
  let reasoning = 'both clusters read equally ambiguous'
  if (q00 !== q01) {
    repCluster = q00 > q01 ? c00 : c01
    reasoning = `cluster asks more questions (${Math.max(q00, q01)} vs ${Math.min(q00, q01)})`
  } else {
    const pres = (sp: string) => segs.filter((s) => s.speaker === sp && /\b(we|our|product|solution|offer|demo)\b/i.test(s.text)).length
    const p00 = pres(c00), p01 = pres(c01)
    if (p00 !== p01) {
      repCluster = p00 > p01 ? c00 : c01
      reasoning = 'cluster presents the product and proposes next steps'
    }
  }
  return { repCluster, reasoning }
}

function t03(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const prospect = segs.filter((s) => /PROSPECT/.test(s.speaker))
  const want = prospect[0]?.text ?? segs[0]?.text ?? 'the prospect stated their goal'
  const agreed = findSeg(segs, /\b(agree|let'?s|we will|sounds good|deal)\b/i)
  const open = findSeg(segs, /\b(need to|should we|open question|still|remaining)\b/i)
  const nextStepRaw = findSeg(segs, /\b(next step|follow[- ]?up|schedule|circle back|by (monday|tuesday|wednesday|thursday|friday|next week|end of (the )?(month|quarter))|book)\b/i, Math.floor(segs.length * 0.6))
  const topics = topTopics(segs, 2)
  const summary = [
    `What the prospect wants: ${trunc(want, 160)}.`,
    `The conversation centred on ${topics.map((t) => t.name).join(' and ') || 'the evaluation at hand'}.`,
    agreed ? `What was agreed: ${trunc(agreed.text, 140)}.` : 'No explicit agreement was reached on the call.',
    open ? `What remains open: ${trunc(open.text, 140)}.` : 'No explicitly open items were stated.',
    `Across ${segs.length} segments the call covered discovery, the prospect's context, and the path forward.`,
    nextStepRaw ? `A next step was referenced: ${trunc(nextStepRaw.text, 120)}.` : 'No next step was secured by the end of the call.',
  ].join(' ')
  return {
    summary,
    topics: topics.length >= 2 ? topics : [
      { name: topics[0]?.name ?? 'qualification', segmentIdx: [segs[0]?.idx ?? 0] },
      { name: topics[1]?.name ?? 'process', segmentIdx: [segs[Math.min(1, segs.length - 1)]?.idx ?? 0] },
    ],
    nextStepSuggested: nextStepRaw ? trunc(nextStepRaw.text, 120) : null,
  }
}

function t04(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const prospect = segs.filter((s) => /PROSPECT/.test(s.speaker))
  const rep = segs.filter((s) => /REP/.test(s.speaker))
  const pick = (re: RegExp, from: Seg[]) => {
    const hit = from.find((s) => re.test(s.text)) ?? null
    return hit
  }
  const m = pick(/\b\d+(\.\d+)?\s*(%|percent|weeks?|days?|hours?|x)\b/i, prospect) ?? pick(/\b\d+(\.\d+)?\s*(%|percent|weeks?|days?|hours?|x)\b/i, rep)
  const e = pick(/\b(budget|sign|signature|approv|cfo|cio|procurement|economic)\b/i, prospect)
  const dc = pick(/\b(criteria|evaluate|compare|against|shortlist|benchmark)\b/i, prospect)
  const dp = pick(/\b(process|steps?|committee|stage|procurement|timeline|by (q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december))\b/i, prospect)
  const i = pick(/\b(pain|hurt|struggl|problem|challenge|frustrat|manual|slow|fail)\b/i, prospect)
  const c = pick(/\b(champion|internally|sell (this|it) (to|for)|advocate|drive (this|the process)|forward (this|it))\b/i, prospect) ?? pick(/\b(i'?ll (set up|arrange|organize|drive|champion)|happy to)\b/i, prospect)
  const fields = [
    { key: 'M', seg: m, value: m ? trunc(m.text, 140) : null },
    { key: 'E', seg: e, value: e ? trunc(e.text, 140) : null },
    { key: 'D_CRITERIA', seg: dc, value: dc ? trunc(dc.text, 140) : null },
    { key: 'D_PROCESS', seg: dp, value: dp ? trunc(dp.text, 140) : null },
    { key: 'I', seg: i, value: i ? trunc(i.text, 140) : null },
    { key: 'C', seg: c, value: c ? trunc(c.text, 140) : null },
  ].map((f) => ({
    key: f.key as 'M' | 'E' | 'D_CRITERIA' | 'D_PROCESS' | 'I' | 'C',
    value: f.value,
    notFound: !f.seg,
    confidence: f.seg ? (/PROSPECT/.test(f.seg.speaker) ? 0.88 : 0.62) : 0.2,
    evidenceIdx: f.seg ? [f.seg.idx] : [],
    quote: f.seg ? trunc(f.seg.text, 90) : 'not found in this call',
  }))
  return { fields }
}

function t05(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const signals: object[] = []
  const watch = (ctx.watchlist ?? []) as string[]
  const dup = new Set<string>()
  const push = (type: string, seg: Seg | null, title: string, content: string, confidence: number) => {
    if (!seg) return
    const k = `${type}:${title}`
    if (dup.has(k)) return
    dup.add(k)
    signals.push({ type, title, content, confidence, evidenceIdx: [seg.idx], quote: trunc(seg.text, 90) })
  }
  for (const s of segs) {
    if (/\b(concern|expensive|worried|not sure|hesitat|too (much|high|pricey)|objection)\b/i.test(s.text)) push('OBJECTION', s, 'Objection raised', trunc(s.text, 140), 0.8)
    if (/\b(looking forward|ready to|send over|sign(ing)? (up|the)|move (ahead|forward))\b/i.test(s.text)) push('BUYING_SIGNAL', s, 'Buying signal', trunc(s.text, 140), 0.75)
    for (const comp of watch) {
      if (new RegExp(`\\b${comp}\\b`, 'i').test(s.text)) push('COMPETITOR', s, `Competitor: ${comp}`, `The prospect referenced ${comp}.`, 0.85)
    }
    if (/\b(price|pricing|budget|discount|cost|per seat|quote)\b/i.test(s.text)) push('PRICING_SIGNAL', s, 'Pricing discussion', trunc(s.text, 140), 0.7)
    if (/\b(q[1-4]|deadline|by the end of|delay|push (it|this) (back|to)|timeline)\b/i.test(s.text)) push('TIMELINE_SIGNAL', s, 'Timeline signal', trunc(s.text, 140), 0.7)
    if (/\b(next step|follow[- ]?up|schedule|circle back|book)\b/i.test(s.text)) push('NEXT_STEP', s, 'Next step agreed', trunc(s.text, 140), 0.8)
  }
  return { signals }
}

function t06(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const facts = ctx.facts ?? { talkRatioRep: 50, questionCount: 5, longestMonologueSec: 60 }
  const ratio = facts.talkRatioRep
  const balanceScore = ratio >= 40 && ratio <= 60 ? 10 : ratio >= 30 && ratio <= 70 ? 8 : ratio >= 20 && ratio <= 80 ? 6 : 4
  const monoPenalty = facts.longestMonologueSec > 120 ? -2 : 0
  const hasNext = segs.some((s) => /\b(next step|follow[- ]?up|schedule|circle back|book)\b/i.test(s.text))
  const hasObjection = segs.some((s) => /\b(concern|expensive|worried|objection)\b/i.test(s.text))
  const hasNumbers = segs.some((s) => /\b\d+(\.\d+)?\s*(%|percent|weeks?|days?|x)\b/i.test(s.text))
  const dims = [
    { key: 'discovery', score: Math.min(10, Math.round(facts.questionCount >= 4 ? 8 : 4 + facts.questionCount)), evidenceIdx: segs.filter((s) => s.text.includes('?')).slice(0, 2).map((s) => s.idx), comment: `${facts.questionCount} diagnostic questions counted arithmetically.` },
    { key: 'value', score: hasNumbers ? 8 : 6, evidenceIdx: segs.filter((s) => /\b\d+/.test(s.text)).slice(0, 1).map((s) => s.idx), comment: hasNumbers ? 'Value tied to the prospect\'s stated numbers.' : 'Value stated generally; no prospect metrics referenced.' },
    { key: 'objections', score: hasObjection ? 7 : 5, evidenceIdx: segs.filter((s) => /\b(concern|expensive|worried|objection)\b/i.test(s.text)).slice(0, 1).map((s) => s.idx), comment: hasObjection ? 'Objection acknowledged and answered.' : 'No objections surfaced on this call.' },
    { key: 'next_step', score: hasNext ? 9 : 3, evidenceIdx: segs.filter((s) => /\b(next step|follow[- ]?up|schedule|circle back|book)\b/i.test(s.text)).slice(0, 1).map((s) => s.idx), comment: hasNext ? 'A specific next step was agreed before the call ended.' : 'No next step secured (matches NO_NEXT_STEP flag).' },
    { key: 'talk_balance', score: Math.max(1, balanceScore + monoPenalty), evidenceIdx: [], comment: `Rep talk ratio ${ratio}% (target 40-60); longest monologue ${facts.longestMonologueSec}s. Computed arithmetically, not estimated.` },
    { key: 'rapport', score: 7, evidenceIdx: segs.slice(0, 1).map((s) => s.idx), comment: 'Natural opening; names used; no time theft detected.' },
  ]
  return { dimensions: dims }
}

function t07(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const detail = segs.find((s) => /\b\d+(\.\d+)?\s*(%|percent|weeks?|days?|x)\b/i.test(s.text)) ?? segs.find((s) => /PROSPECT/.test(s.speaker))
  const next = segs.find((s) => /\b(next step|follow[- ]?up|schedule|circle back|book)\b/i.test(s.text))
  const topic = topTopics(segs, 1)[0]?.name ?? 'the evaluation'
  const subject = trunc(`Following up: ${topic}${next ? ' + next step' : ''}`, 80)
  const tone = ctx.tone ?? 'warm-professional'
  const body = [
    `Hi,`,
    ``,
    `Thanks for the time today. ${detail ? `What stayed with me: ${trunc(detail.text, 140)}` : `It was good to dig into ${topic}.`}`,
    ``,
    next ? `Next step as agreed: ${trunc(next.text, 120)}. I'll send the details ahead of it.` : `To keep this moving, I'd suggest a short working session next week - happy to propose two slots.`,
    ``,
    `Best,`,
  ].join('\n')
  return { subject, body: tone === 'warm-professional' ? body : body }
}

function t08(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const decisions = segs.filter((s) => /\b(agree|decided|we will|let'?s go|sounds good|deal)\b/i.test(s.text)).map((s) => trunc(s.text, 120)).slice(0, 5)
  const openQuestions = segs.filter((s) => s.text.includes('?')).map((s) => trunc(s.text, 120)).slice(0, 5)
  const actionItems = segs
    .filter((s) => /\b(i'?ll|we should|send|prepare|follow up|share|draft|set up)\b/i.test(s.text))
    .map((s) => `Follow through: ${trunc(s.text, 120)}`)
    .slice(0, 5)
  return { decisions, openQuestions, actionItems }
}

function t11(ctx: TaskContext) {
  const hits = (ctx.hits ?? []) as { id: string; score: number; source: string; text: string }[]
  const minScore = ctx.minScore ?? 0.24
  const usable = hits.filter((h) => h.score >= minScore)
  if (usable.length === 0) {
    return { answer: "I can't find that in your library.", citations: [] }
  }
  const top = usable[0]
  return {
    answer: `From your library (${top.source}): ${trunc(top.text, 220)}`,
    citations: usable.slice(0, 3).map((h) => ({ hitId: h.id, quote: trunc(h.text, 80) })),
  }
}

function t12(ctx: TaskContext) {
  const segs = ctx.segments ?? []
  const suggestions: object[] = []
  const obj = segs.find((s) => /\b(concern|expensive|worried|objection)\b/i.test(s.text))
  if (obj) {
    suggestions.push({
      title: 'Acknowledge, isolate, answer',
      category: 'Objections',
      body: 'When a pricing concern surfaces, acknowledge it, isolate it (is this the only thing holding us back?), then answer or park it honestly. Never steamroll.',
      evidenceIdx: [obj.idx],
    })
  }
  const ns = segs.find((s) => /\b(next step|follow[- ]?up|schedule|circle back|book)\b/i.test(s.text))
  if (ns) {
    suggestions.push({
      title: 'Close on a dated next step',
      category: 'Next steps',
      body: 'Before ending the call, agree a specific next step with a date and name the owner. Rehearse this line: "What should happen between now and then?"',
      evidenceIdx: [ns.idx],
    })
  }
  const disc = segs.filter((s) => s.text.includes('?'))
  if (disc.length >= 4) {
    suggestions.push({
      title: 'Diagnostic question ladder',
      category: 'Discovery',
      body: 'Open with situation questions, then probe impact, then invite the prospect to articulate the cost of doing nothing. Four or more diagnostic questions per call.',
      evidenceIdx: disc.slice(0, 3).map((s) => s.idx),
    })
  }
  return { suggestions }
}

const BRAINS: Record<MockTaskId, (ctx: TaskContext) => object> = {
  T02: t02, T03: t03, T04: t04, T05: t05, T06: t06, T07: t07, T08: t08, T11: t11, T12: t12,
}

export function mockAnswer(taskId: MockTaskId, ctx?: TaskContext): object {
  const fn = BRAINS[taskId]
  if (!fn) return {}
  return fn(ctx ?? { segments: [] })
}

/** Deterministic lexical embedding: bucket-token hashing, L2-normalized. */
export function mockEmbedVectors(texts: string[], dim: number): number[][] {
  return texts.map((t) => {
    const v = new Array<number>(dim).fill(0)
    for (const token of tokenize(t)) {
      let h = 2166136261
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i)
        h = Math.imul(h, 16777619) >>> 0
      }
      const bucket = h % dim
      v[bucket] += 1 + token.length / 20
      // bigram-ish second signature to spread related tokens
      v[(h >>> 7) % dim] += 0.5
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  })
}
