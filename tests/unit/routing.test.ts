// Unit: routing decision procedure — every row of Table 6.4 (pure function, zero I/O).
import { describe, test, expect } from 'bun:test'
import { planRoute } from '@/lib/routing/router'

const healthAll = (up: boolean) => ({
  OLLAMA: { up, configured: true },
  OPENAI: { up, configured: true },
  ANTHROPIC: { up, configured: true },
  GEMINI: { up, configured: true },
  COMPATIBLE: { up: false, configured: false },
  MOCK: { up: true, configured: true },
  LOCAL_STT: { up: true, configured: true },
})

describe('planRoute (Table 6.4)', () => {
  test('default LOCAL_FIRST: local first, cloud legs behind, mock last', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 4000, routingMode: 'LOCAL_FIRST',
      budget: { spentUsd: 0, capUsd: 5 }, health: healthAll(true), mockEnabled: true,
    })
    expect(r.chain[0].provider).toBe('OLLAMA')
    expect(r.chain.some((c) => c.provider === 'OPENAI')).toBe(true)
    expect(r.chain[r.chain.length - 1].kind).toBe('mock')
  })

  test('context overflow skips the local model (measured, not guessed)', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 600_000, // ~150k tokens > 128k ctx (phi-4-mini)
      routingMode: 'LOCAL_FIRST', budget: { spentUsd: 0, capUsd: 5 }, health: healthAll(true), mockEnabled: true,
    })
    expect(r.chain.some((c) => c.provider === 'OLLAMA')).toBe(false)
    expect(r.notes.some((n) => n.includes('context overflow'))).toBe(true)
    expect(r.chain.some((c) => c.provider === 'ANTHROPIC')).toBe(true) // long-context cloud leg (200k ctx)
  })

  test('BUDGET_EXCEEDED: cloud refused when projected spend beats remaining headroom', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 4000, routingMode: 'LOCAL_FIRST',
      budget: { spentUsd: 5, capUsd: 0.01 }, // no headroom for a conservative max-token estimate
      health: healthAll(true), mockEnabled: true,
    })
    expect(r.chain.every((c) => c.kind !== 'cloud')).toBe(true)
    expect(r.refusedByBudget).toBe(true)
    expect(r.notes.some((n) => n.includes('BUDGET_EXCEEDED'))).toBe(true)
  })

  test('unhealthy provider is skipped with a note (15-min window)', () => {
    const health = healthAll(true)
    health.OPENAI = { up: false, configured: true }
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 4000, routingMode: 'CLOUD_ONLY',
      budget: { spentUsd: 0, capUsd: 5 }, health, mockEnabled: true,
    })
    expect(r.chain.some((c) => c.provider === 'OPENAI')).toBe(false)
    expect(r.notes.some((n) => n.includes('skipped (unhealthy'))).toBe(true)
  })

  test('LOCAL_ONLY removes all cloud legs for non-fixed tasks', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 1000, routingMode: 'LOCAL_ONLY',
      budget: { spentUsd: 0, capUsd: 5 }, health: healthAll(true), mockEnabled: true,
    })
    expect(r.chain.every((c) => c.kind !== 'cloud')).toBe(true)
    expect(r.chain.some((c) => c.provider === 'OLLAMA')).toBe(true)
    expect(r.notes.some((n) => n.includes('LOCAL_ONLY'))).toBe(true)
  })

  test('CLOUD_FIRST moves cloud legs ahead of local', () => {
    const r = planRoute({
      taskId: 'T04', hint: 'medium', inputChars: 4000, routingMode: 'CLOUD_FIRST',
      budget: { spentUsd: 0, capUsd: 5 }, health: healthAll(true), mockEnabled: true,
    })
    expect(r.chain[0].kind).toBe('cloud')
  })

  test('mock disabled removes the fixture leg entirely', () => {
    const r = planRoute({
      taskId: 'T03', hint: 'small', inputChars: 1000, routingMode: 'LOCAL_ONLY',
      budget: { spentUsd: 0, capUsd: 5 }, health: healthAll(false), mockEnabled: false,
    })
    expect(r.chain.length).toBe(0) // ollama unhealthy AND mock disabled -> honest empty chain
  })

  test('local-fixed tiers: stt hint never routes cloud', () => {
    const r = planRoute({
      taskId: 'T01', hint: 'stt', inputChars: 1000, routingMode: 'CLOUD_ONLY',
      budget: { spentUsd: 0, capUsd: 5 }, health: healthAll(true), mockEnabled: true,
    })
    expect(r.chain.every((c) => c.kind !== 'cloud')).toBe(true)
  })
})
