// Unit: Live Assist cue matcher (WO-LA2, FR-026) — pure functions, no IO.
import { describe, test, expect } from 'bun:test'
import { matchDelta, freshMatcherState, normalize, countWords, countQuestions, type CueDef } from '@/lib/live/matcher'

const priceCue: CueDef = {
  id: 'cue-price',
  name: 'Pricing objection',
  category: 'OBJECTION',
  kind: 'PHRASE',
  triggers: ['too expensive', 'out of budget'],
  guidance: 'Anchor value before defending price.',
  cooldownSec: 240,
  enabled: true,
}

const cadenceCue: CueDef = {
  id: 'cue-cadence',
  name: 'Ask a question',
  category: 'COACHING',
  kind: 'RULE_NO_QUESTION',
  triggers: { wordsSinceQuestion: 20 },
  guidance: 'You have been talking for a while.',
  cooldownSec: 60,
  enabled: true,
}

describe('normalize / counters', () => {
  test('folds case and punctuation so triggers survive spoken phrasing', () => {
    expect(normalize('Too expensive!')).toBe(normalize('too expensive'))
    expect(normalize("That's way TOO pricey…")).toContain('too pricey')
  })
  test('counters', () => {
    expect(countWords('one two three')).toBe(3)
    expect(countQuestions('really? yes? no.')).toBe(2)
  })
})

describe('phrase cues', () => {
  test('fires on trigger with a captured snippet', () => {
    const st = freshMatcherState()
    const { fires } = matchDelta('Honestly, this feels too expensive for our team.', 5_000, [priceCue], st)
    expect(fires.length).toBe(1)
    expect(fires[0].cueId).toBe('cue-price')
    expect(fires[0].snippet).toContain('too expensive')
  })

  test('cooldown suppresses refire, elapsed time re-arms it', () => {
    const st = freshMatcherState()
    const first = matchDelta('too expensive', 1_000, [priceCue], st)
    expect(first.fires.length).toBe(1)
    const second = matchDelta('too expensive again', 10_000, [priceCue], st) // 9s later, cooldown 240s
    expect(second.fires.length).toBe(0)
    const third = matchDelta('still too expensive', 300_000, [priceCue], st) // past cooldown
    expect(third.fires.length).toBe(1)
  })

  test('disabled cue never fires', () => {
    const st = freshMatcherState()
    const { fires } = matchDelta('too expensive', 1_000, [{ ...priceCue, enabled: false }], st)
    expect(fires.length).toBe(0)
  })

  test('word count is zero after a fire (state bookkeeping intact)', () => {
    const st = freshMatcherState()
    const r = matchDelta('too expensive today', 1_000, [priceCue], st)
    expect(r.words).toBe(3)
    expect(st.lastFired['cue-price']).toBe(1_000)
  })
})

describe('cadence rule (RULE_NO_QUESTION)', () => {
  test('fires when the rolling word count crosses the threshold, resets on a question', () => {
    const st = freshMatcherState()
    const ten = 'one two three four five six seven eight nine ten'
    const r1 = matchDelta(ten, 1_000, [cadenceCue], st)
    expect(r1.fires.length).toBe(0) // 10 words < 20
    const r2 = matchDelta(ten, 2_000, [cadenceCue], st)
    expect(r2.fires.length).toBe(1) // 20 words >= 20
    expect(r2.fires[0].snippet).toContain('20 words since your last question')
    // a question resets the counter mid-stream
    matchDelta('what matters most to you?', 3_000, [cadenceCue], st)
    expect(st.wordsSinceQuestion).toBe(0)
    const r4 = matchDelta(ten, 4_000, [cadenceCue], st)
    expect(r4.fires.length).toBe(0) // 10 words again, under threshold (and in cooldown)
  })

  test('cadence cue respects its own cooldown', () => {
    const st = freshMatcherState()
    const words = Array.from({ length: 25 }, () => 'word').join(' ')
    matchDelta(words, 1_000, [cadenceCue], st) // fires (25 >= 20)
    const again = matchDelta(words, 5_000, [cadenceCue], st) // 4s later, cooldown 60s
    expect(again.fires.length).toBe(0)
  })
})
