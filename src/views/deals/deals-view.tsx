'use client'
// VALENCE — Deal detail and pipeline view
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { navigate } from '@/lib/router'
import { formatCurrency } from '@/lib/format'
import { EmptyState, PageHeader } from '@/components/valence/primitives'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import type { DealStage, InsightType } from '@prisma/client'

// ---------------- list ----------------

interface DealRow { id: string; title: string; account: string; stage: DealStage; valueCents: number | null; healthScore: number | null; lastActivityAt: string; nextStep: string | null }

export function DealsView() {
  const dealsRev = useAmber((s) => s.dealsRev)
  const [q, setQ] = useState('')
  const deals = useQuery({
    queryKey: ['deals', q, dealsRev],
    queryFn: () => api.get<{ items: DealRow[] }>(`/api/deals${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  })
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3 pb-1">
        <h1 className="font-editorial text-[length:var(--text-display)] font-semibold tracking-tight">Deals</h1>
        <Input className="w-56" placeholder="search title/account…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button className="ml-auto" onClick={() => navigate('/deals/new')}>New deal</Button>
      </header>
      {deals.isLoading ? <EmptyState title="Loading deals…" /> : (deals.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No deals yet" hint="Deals give calls a home: MEDDIC, timeline, health, and the board all hang off them." action={<Button onClick={() => navigate('/deals/new')}>Create your first deal</Button>} />
      ) : (
        <ul className="space-y-2">
          {deals.data!.items.map((d) => (
            <li key={d.id}>
              <Card role="button" tabIndex={0} onClick={() => navigate(`/deals/${d.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/deals/${d.id}`)} className="glass-panel card-lift cursor-pointer transition-all">
                <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[var(--text-body)] font-semibold">{d.title}</div>
                    <div className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
                      {d.account} · <span className="font-medium text-[var(--foreground)]">{d.stage}</span> · <span className="tnum font-mono">{d.valueCents !== null ? formatCurrency(d.valueCents, 'EUR') : 'no value set'}</span> · last activity {new Date(d.lastActivityAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge variant="outline" className="tabular-nums font-mono border-[var(--border-strong)]">health {d.healthScore ?? '—'}</Badge>
                  {d.nextStep && <span className="max-w-56 truncate text-[var(--text-micro)] text-[var(--ink-secondary)]" title={d.nextStep}>→ {d.nextStep}</span>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------- create / detail ----------------

export function DealFormView() {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [account, setAccount] = useState('')
  const [stage, setStage] = useState<DealStage>('LEAD')
  const [value, setValue] = useState('')
  const [expectedClose, setExpectedClose] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.post<{ deal: { id: string } }>('/api/deals', {
        title,
        account,
        stage,
        valueCents: value ? Math.round(Number(value) * 100) : null,
        expectedCloseAt: expectedClose ? new Date(expectedClose).toISOString() : null,
      }),
    onSuccess: (res) => {
      toast.success('Deal created')
      qc.invalidateQueries({ queryKey: ['deals'] })
      navigate(`/deals/${res.deal.id}`)
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create deal'),
  })

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader><CardTitle>New deal</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="d-title">Title</Label>
            <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme — Expansion Q4" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-account">Account</Label>
            <Input id="d-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Acme GmbH" />
          </div>
          <div className="grid gap-1.5">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={(v) => setStage(v as DealStage)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-value">Value (EUR)</Label>
            <Input id="d-value" type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder="12000" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-close">Expected close</Label>
            <Input id="d-close" type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Button disabled={!title || !account || create.isPending} onClick={() => create.mutate()}>Create</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface DealDetailPayload {
  deal: {
    id: string
    title: string
    account: string
    stage: DealStage
    valueCents: number | null
    healthScore: number | null
    nextStep: string | null
    nextStepDueAt: string | null
    expectedCloseAt: string | null
    lastActivityAt: string
    contacts: { id: string; name: string; title?: string | null; isChampion: boolean; isEconomicBuyer: boolean; email?: string | null }[]
    calls: { id: string; title: string; status: string; occurredAt: string; durationSec?: number | null }[]
    insights: { id: string; type: InsightType; title: string; content: string; confidence: number }[]
    emailMessages?: { id: string; subject: string; from: string; sentAt: string; sentiment?: string | null; bodyText: string; direction: string }[]
  }
  timeline: { id: string; kind: string; occurredAt: string; payload: Record<string, unknown> }[]
}

export function DealDetailView({ id }: { id: string }) {
  const qc = useQueryClient()
  const dealsRev = useAmber((s) => s.dealsRev)
  const detail = useQuery({ queryKey: ['deal', id, dealsRev], queryFn: () => api.get<DealDetailPayload>(`/api/deals/${id}`) })
  const [nextStep, setNextStep] = useState('')

  const patch = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(`/api/deals/${id}`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deal', id] }); toast.success('Deal updated — health recomputed') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  })
  const addContact = useMutation({
    mutationFn: (payload: { name: string; title?: string }) => api.post('/api/contacts', { dealId: id, ...payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deal', id] }); toast.success('Contact added') },
  })
  const archive = useMutation({
    mutationFn: () => api.del(`/api/deals/${id}`),
    onSuccess: () => { toast.info('Deal archived'); qc.invalidateQueries({ queryKey: ['deal', id] }) },
  })

  if (detail.isLoading) return <EmptyState title="Loading deal…" />
  if (detail.isError || !detail.data) return <EmptyState title="Deal not found" action={<Button onClick={() => navigate('/deals')}>Back to deals</Button>} />

  const d = detail.data.deal
  const meddic = detail.data.deal.insights.filter((i) => i.type.startsWith('MEDDIC_'))
  const meddicFilled = meddic.filter((i) => !/not found/i.test(i.title)).length

  return (
    <div className="space-y-4">
      <header className="glass-panel flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-[var(--border)] px-5 py-4 shadow-[var(--shadow-sm)]">
        <div className="min-w-0">
          <h1 className="font-editorial truncate text-[length:var(--text-title)] font-semibold">{d.title}</h1>
          <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
            {d.account} · <span className="tnum font-mono">{d.valueCents !== null ? formatCurrency(d.valueCents, 'EUR') : 'no value'}</span> · expected close {d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString() : '—'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className={`tnum text-3xl font-semibold tabular-nums font-mono ${d.healthScore === null ? 'text-[var(--muted-foreground)]' : d.healthScore >= 66 ? 'text-[var(--positive)]' : d.healthScore >= 33 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}>
              {d.healthScore ?? '—'}
            </div>
            <div className="text-[var(--text-micro)] text-[var(--muted-foreground)]">health v1</div>
          </div>
          <div className="tnum text-[var(--text-micro)] text-[var(--muted-foreground)] font-mono">MEDDIC {meddicFilled}/6</div>
        </div>
        <Select value={d.stage} onValueChange={(v) => patch.mutate({ stage: v })}>
          <SelectTrigger className="ml-auto w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => archive.mutate()}>Archive</Button>
      </header>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>Next step</CardTitle>{d.nextStepDueAt && <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">due {new Date(d.nextStepDueAt).toLocaleDateString()}</span>}</CardHeader>
            <CardContent className="space-y-3">
              {d.nextStep ? (
                <p className="text-[var(--text-body)]">{d.nextStep}</p>
              ) : (
                <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">No next step — this feeds the NO_NEXT_STEP flag and the health score.</p>
              )}
              <div className="flex gap-2">
                <Input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="set the next step…" />
                <Button disabled={!nextStep.trim()} onClick={() => { patch.mutate({ nextStep: nextStep.trim() }); setNextStep('') }}>Set</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Timeline (FR-012)</CardTitle></CardHeader>
            <CardContent className="max-h-96 overflow-y-auto scroll-warm">
              {detail.data.timeline.length === 0 ? <EmptyState title="Timeline is empty" hint="Calls, insights, stage changes, and notes appear here automatically." /> : (
                <ol className="space-y-2">
                  {detail.data.timeline.map((ev) => (
                    <li key={ev.id} className="rounded-xl bg-[var(--raised)] px-3 py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[var(--text-small)] font-medium">{formatEvent(ev.kind, ev.payload)}</span>
                        <span className="shrink-0 text-[var(--text-micro)] text-[var(--muted-foreground)]">{new Date(ev.occurredAt).toLocaleString()}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Calls ({d.calls.length})</CardTitle></CardHeader>
            <CardContent>
              {d.calls.length === 0 ? <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">No calls linked yet — link one at upload or from the call page.</p> : (
                <ul className="divide-y divide-[var(--border)]">
                  {d.calls.map((c) => (
                    <li key={c.id}>
                      <button className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[var(--raised)]" onClick={() => navigate(`/calls/${c.id}`)}>
                        <span className="min-w-0">
                          <span className="block truncate text-[var(--text-small)] font-medium">{c.title}</span>
                          <span className="block text-[var(--text-micro)] text-[var(--muted-foreground)]">{new Date(c.occurredAt).toLocaleString()} · {c.status}</span>
                        </span>
                        <span className="text-[var(--text-micro)] text-[var(--accent-ink)]">open →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Ingested Emails ({d.emailMessages?.length ?? 0})</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs text-[var(--primary)]" onClick={() => navigate('/integrations')}>
                Connect More Inboxes →
              </Button>
            </CardHeader>
            <CardContent>
              {!d.emailMessages || d.emailMessages.length === 0 ? (
                <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">
                  No emails linked to this deal yet. Incoming emails matching {d.account} will attach here automatically.
                </p>
              ) : (
                <ul className="space-y-2">
                  {d.emailMessages.map((em) => (
                    <li key={em.id} className="rounded-xl border border-[var(--border)] bg-[var(--raised)] p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[var(--foreground)]">{em.subject}</span>
                        {em.sentiment && (
                          <Badge
                            variant="outline"
                            className={
                              em.sentiment === 'POSITIVE'
                                ? 'border-emerald-500/30 text-emerald-600'
                                : em.sentiment === 'OBJECTION'
                                ? 'border-red-500/30 text-red-600'
                                : 'border-amber-500/30 text-amber-600'
                            }
                          >
                            {em.sentiment}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--muted-foreground)]">
                        From: {em.from} · {new Date(em.sentAt).toLocaleDateString()}
                      </div>
                      <p className="text-[var(--ink-secondary)] line-clamp-2">{em.bodyText}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {d.contacts.map((c) => (
                <div key={c.id} className="rounded-xl bg-[var(--raised)] px-3 py-2">
                  <div className="text-[var(--text-small)] font-medium">{c.name}{c.title ? ` — ${c.title}` : ''}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.isChampion && <Badge className="bg-[var(--accent-soft)] text-[var(--accent-ink)]">champion</Badge>}
                    {c.isEconomicBuyer && <Badge variant="outline">economic buyer</Badge>}
                    {c.email && <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">{c.email}</span>}
                  </div>
                </div>
              ))}
              <ContactAdder onAdd={(name, title) => addContact.mutate({ name, title })} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>MEDDIC ({meddicFilled}/6)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {meddic.length === 0 ? <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">Fields appear here as calls get analyzed.</p> : meddic.map((m) => (
                <div key={m.id} className={`rounded-xl border p-3 ${/not found/i.test(m.title) ? 'border-dashed border-[var(--border-strong)]' : 'border-[var(--border)] bg-[var(--accent-soft)]'}`}>
                  <div className="text-[var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">{m.type.replace('MEDDIC_', '')}</div>
                  <div className="mt-1 text-[var(--text-small)]">{m.content}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ContactAdder({ onAdd }: { onAdd: (name: string, title?: string) => void }) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  return (
    <div className="flex gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" className="w-32" />
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="role" className="w-28" />
      <Button size="sm" disabled={!name.trim()} onClick={() => { onAdd(name.trim(), title.trim() || undefined); setName(''); setTitle('') }}>Add</Button>
    </div>
  )
}

function formatEvent(kind: string, payload: Record<string, unknown>): string {
  const p = payload as Record<string, string | number | null | undefined>
  switch (kind) {
    case 'STAGE_CHANGE': return `Stage: ${p.from} → ${p.to}`
    case 'CALL_UPLOADED': return `Call uploaded: ${p.title ?? ''}`
    case 'CALL_ANALYZED': return `Call analyzed: ${p.title ?? ''} (score ${p.overall ?? '—'})`
    case 'INSIGHT_CONFIRMED': return `Insight confirmed: ${p.title ?? ''}`
    case 'INSIGHT_DISMISSED': return `Insight dismissed: ${p.title ?? ''}`
    case 'NOTE_ADDED': return `Note: ${String(p.preview ?? '').slice(0, 60)}`
    case 'HEALTH_RECOMPUTED': return `Health ${p.previous ?? '—'} → ${p.score ?? '—'}`
    case 'NEXT_STEP_SET': return `Next step: ${String(p.nextStep ?? '').slice(0, 60)}`
    case 'PRACTICE_ACCEPTED': return `Practice accepted: ${p.title ?? ''}`
    case 'DEAL_CREATED': return `Deal created (${p.stage ?? 'LEAD'})`
    case 'EMAIL_ACTIVITY': return `Email: "${p.subject ?? ''}" (${p.sentiment ?? 'NEUTRAL'} from ${p.from ?? ''})`
    case 'CRM_PUSH': return `Synced to CRM (${p.crm ?? 'HubSpot'}): ${p.callTitle ?? ''}`
    default: return kind
  }
}
