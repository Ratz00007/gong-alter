// AMBER — prompt engine (NFR-14): templates are data; exactly one active version
// per task; edits create versions; activation is explicit (and eval-gated in P5).
import { getDb } from '../db'
import type { PromptTemplate } from '@prisma/client'

export async function getActiveTemplate(taskId: string): Promise<PromptTemplate | null> {
  return getDb().promptTemplate.findFirst({ where: { taskId, active: true }, orderBy: { version: 'desc' } })
}

export async function listTemplates(): Promise<PromptTemplate[]> {
  return getDb().promptTemplate.findMany({ orderBy: [{ taskId: 'asc' }, { version: 'desc' }] })
}

/** Mustache-style {{var}} rendering; unknown placeholders are removed. */
export function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = vars[k]
    return v === undefined ? '' : String(v)
  })
}

export async function createVersion(taskId: string, data: {
  systemPrompt: string
  userTemplate: string
  outputSchema: object
  modelHint?: string | null
  minContextChars?: number
}): Promise<PromptTemplate> {
  const db = getDb()
  const last = await db.promptTemplate.findFirst({ where: { taskId }, orderBy: { version: 'desc' } })
  return db.promptTemplate.create({
    data: {
      taskId,
      version: (last?.version ?? 0) + 1,
      systemPrompt: data.systemPrompt,
      userTemplate: data.userTemplate,
      outputSchema: data.outputSchema as object,
      modelHint: data.modelHint ?? null,
      minContextChars: data.minContextChars ?? 0,
      active: false,
    },
  })
}

/** Activation is exclusive per task; the eval gate is consulted by the caller (P5). */
export async function activateVersion(id: string): Promise<void> {
  const db = getDb()
  const target = await db.promptTemplate.findUniqueOrThrow({ where: { id } })
  await db.$transaction([
    db.promptTemplate.updateMany({ where: { taskId: target.taskId, active: true }, data: { active: false } }),
    db.promptTemplate.update({ where: { id }, data: { active: true } }),
  ])
}
