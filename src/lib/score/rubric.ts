// AMBER — rubric service (Ch. 3 Table 3.5): weights live in Setting rubric.v1;
// the weighted overall is computed in code, never in the model (FR-014).
import { getDb } from '../db'

export interface RubricDimension {
  key: string
  weight: number
  fullMarks: string
}

export interface Rubric {
  version: string
  dimensions: RubricDimension[]
}

export async function getRubric(): Promise<Rubric> {
  const row = await getDb().setting.findUnique({ where: { key: 'rubric.v1' } })
  const value = (row?.value ?? null) as Rubric | null
  if (value && Array.isArray(value.dimensions)) return value
  return { version: 'v1', dimensions: [] }
}

export interface ScoredDimension {
  key: string
  score: number // 0-10
  evidenceSegmentIds: string[]
  comment: string
}

/** Weighted mean scaled to 100; weights applied in code from the rubric table. */
export function weightedOverall(dims: ScoredDimension[], rubric: Rubric): number {
  const weightOf = new Map(rubric.dimensions.map((d) => [d.key, d.weight]))
  let total = 0
  let weightSum = 0
  for (const d of dims) {
    const w = weightOf.get(d.key) ?? 0
    total += d.score * w
    weightSum += w
  }
  if (weightSum === 0) return 0
  return Math.round((total / weightSum) * 10)
}

export function rubricText(rubric: Rubric): string {
  return rubric.dimensions
    .map((d) => `${d.key} (weight ${Math.round(d.weight * 100)}%): full marks = ${d.fullMarks}`)
    .join('\n')
}
