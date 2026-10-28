// AMBER — S5 talk metrics (FR-005): pure arithmetic over segments; never estimated.
export interface MetricSegment {
  speaker: string
  startMs: number
  endMs: number
  text: string
  idx: number
}

export interface TalkMetrics {
  talkRatioRep: number // percent, 1 decimal
  questionCount: number
  longestMonologueSec: number
  coverageRatio: number // percent of duration covered by segments
  repMs: number
  prospectMs: number
  totalMs: number
}

export function computeTalkMetrics(segments: MetricSegment[], durationSec: number): TalkMetrics {
  const totalMs = Math.max(1, Math.round(durationSec * 1000))
  const isRep = (s: MetricSegment) => s.speaker === 'REP'
  const segMs = (s: MetricSegment) => Math.max(0, s.endMs - s.startMs)

  const repMs = segments.filter(isRep).reduce((sum, s) => sum + segMs(s), 0)
  const prospectMs = segments.filter((s) => s.speaker === 'PROSPECT').reduce((sum, s) => sum + segMs(s), 0)
  const coveredMs = segments.reduce((sum, s) => sum + segMs(s), 0)

  const questionCount = segments.filter(isRep).reduce((n, s) => n + (s.text.match(/\?/g)?.length ?? 0), 0)

  // Longest monologue: longest consecutive run of adjacent REP segments.
  let longestRunMs = 0
  let runMs = 0
  let prevIdx: number | null = null
  for (const s of [...segments].sort((a, b) => a.idx - b.idx)) {
    if (isRep(s)) {
      runMs = prevIdx !== null && s.idx === prevIdx + 1 ? runMs + segMs(s) : segMs(s)
      longestRunMs = Math.max(longestRunMs, runMs)
      prevIdx = s.idx
    } else {
      runMs = 0
      prevIdx = null
    }
  }

  return {
    talkRatioRep: Math.round((repMs / totalMs) * 1000) / 10,
    questionCount,
    longestMonologueSec: Math.round(longestRunMs / 1000),
    coverageRatio: Math.round((coveredMs / totalMs) * 1000) / 10,
    repMs,
    prospectMs,
    totalMs,
  }
}
