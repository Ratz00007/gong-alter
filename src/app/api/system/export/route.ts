import { NextRequest } from 'next/server'
import { handler, requireSession } from '@/lib/http'
import { getDb } from '@/lib/db'
import { loadRedactionContext, redactTextWithContext } from '@/lib/redact/engine'
import { mediaStats } from '@/lib/media/vault'
import { config } from '@/lib/config'

export const dynamic = 'force-dynamic'

/** FR-024: one JSON bundle, everything except media bytes, redacted per scope ALL. */
export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const db = getDb()

  const [deals, contacts, calls, transcripts, segments, insights, scorecards, summaries, notes, drafts, practices, events, runs, budget, settings, evalCases, evalRuns, jobs, ctx] =
    await Promise.all([
      db.deal.findMany(),
      db.contact.findMany(),
      db.call.findMany(),
      db.transcript.findMany(),
      db.segment.findMany({ orderBy: { idx: 'asc' } }),
      db.insight.findMany(),
      db.scorecard.findMany(),
      db.callSummary.findMany(),
      db.note.findMany(),
      db.followUpDraft.findMany(),
      db.bestPractice.findMany(),
      db.dealEvent.findMany({ orderBy: { occurredAt: 'desc' } }),
      db.providerRun.findMany(),
      db.budgetEntry.findMany(),
      db.setting.findMany(),
      db.evalCase.findMany(),
      db.evalRun.findMany(),
      db.job.findMany(),
      loadRedactionContext('EXPORT'),
    ])

  // Redaction scope ALL applies to exported conversation and PII text synchronously in memory (Ch. 8).
  const redactText = (t: string) => redactTextWithContext(t, ctx).redacted
  const redactOpt = (t: string | null | undefined) => (typeof t === 'string' ? redactText(t) : t)
  const redactJson = (v: unknown): unknown => {
    if (typeof v === 'string') return redactText(v)
    if (Array.isArray(v)) return v.map(redactJson)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, redactJson(val)]))
    }
    return v
  }

  const redactedCalls = calls.map((c) => ({ ...c, title: redactText(c.title) }))
  const redactedTranscripts = transcripts.map((t) => ({ ...t, fullText: redactText(t.fullText) }))
  const redactedSegments = segments.map((s) => ({ ...s, text: redactText(s.text) }))
  const redactedSummaries = summaries.map((s) => ({
    ...s,
    summary: redactText(s.summary),
    nextStepSuggested: redactOpt(s.nextStepSuggested),
  }))
  const redactedNotes = notes.map((n) => ({ ...n, body: redactText(n.body) }))
  const redactedDrafts = drafts.map((d) => ({
    ...d,
    subject: redactText(d.subject),
    body: redactText(d.body),
  }))
  const redactedContacts = contacts.map((c) => ({
    ...c,
    name: redactText(c.name),
    email: redactOpt(c.email),
    title: redactOpt(c.title),
    phone: redactOpt(c.phone),
    notes: redactOpt(c.notes),
  }))
  const redactedInsights = insights.map((i) => {
    const extra = i as Record<string, unknown>
    return {
      ...i,
      title: redactText(i.title),
      content: redactText(i.content),
      ...(typeof extra.label === 'string' ? { label: redactText(extra.label) } : {}),
      ...(typeof extra.detail === 'string' ? { detail: redactText(extra.detail) } : {}),
      ...(typeof extra.value === 'string' ? { value: redactText(extra.value) } : {}),
    }
  })
  const redactedEvents = events.map((e) => {
    const extra = e as Record<string, unknown>
    return {
      ...e,
      payload: redactJson(e.payload),
      ...(typeof extra.summary === 'string' ? { summary: redactText(extra.summary) } : {}),
    }
  })

  const media = await db.mediaAsset.findMany()
  const manifest = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 2,
    routingMode: config.routingMode,
    stt: config.stt.binding,
    media: { stats: mediaStats(), hashes: media.map((m) => ({ sha256: m.sha256, filePath: m.filePath, sizeBytes: m.sizeBytes.toString() })) },
  }

  const body = {
    manifest,
    deals,
    contacts: redactedContacts,
    calls: redactedCalls,
    transcripts: redactedTranscripts,
    segments: redactedSegments,
    insights: redactedInsights,
    scorecards,
    summaries: redactedSummaries,
    notes: redactedNotes,
    followUpDrafts: redactedDrafts,
    bestPractices: practices,
    dealEvents: redactedEvents,
    providerRuns: runs,
    budgetEntries: budget,
    settings, // keys never present by schema (NFR-13)
    evalCases,
    evalRuns,
    jobs,
  }

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="amber-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
})
