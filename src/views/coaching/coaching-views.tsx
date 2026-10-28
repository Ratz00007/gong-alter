'use client'
// AMBER — screens 10/12/13/19: coaching home, best practices, library search, job monitor.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { navigate } from '@/lib/router'
import { useAmber } from '@/lib/store'
import { EmptyState } from '@/components/amber/primitives'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { GraduationCap } from 'lucide-react'
import type { CallStatus, JobType, JobStatus } from '@prisma/client'

// ---------------- Coaching home (screen 10, FR-015) ----------------

interface TrendsPayload {
  windowDays: number
  count: number
  calibration: boolean
  calibrationNote: string | null
  series: { callId: string; callTitle: string; occurredAt: string; overall: number; dimensions: Record<string, number>; talkRatioRep: number }[]
  rolling: (number | null)[]
  topQuartileMeans: Record<string, number>
}

export function CoachingView() {
  const [windowDays, setWindowDays] = useState('90')
  const trends = useQuery({
    queryKey: ['coaching-trends', windowDays],
    queryFn: () => api.get<TrendsPayload>(`/api/coaching/trends?window=${windowDays}`),
  })
  const data = trends.data
  const dims = ['discovery', 'value', 'objections', 'next_step', 'talk_balance', 'rapport'] as const

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div>
          <h1 className="text-[length:var(--text-display)] font-semibold tracking-tight">Coaching</h1>
          <p className="mt-1 text-[var(--text-small)] text-[var(--muted-foreground)]">Scorecards, trends, and how you land against your own best calls.</p>
        </div>
        <Select value={windowDays} onValueChange={setWindowDays}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </header>

      {trends.isLoading ? <EmptyState title="Loading trends…" /> : !data || data.count === 0 ? (
        <EmptyState title="Coaching starts with your first analyzed call" hint="Once a call is analyzed, it gets a six-dimension scorecard against rubric v1." />
      ) : data.calibration ? (
        <EmptyState
          title="Calibrating…"
          hint={`${data.calibrationNote} — a single great or terrible call means nothing. Three calls in, trends start meaning something; until then this screen explains instead of spiking.`}
          icon={<GraduationCap className="h-5 w-5" aria-hidden />}
        />
      ) : (
        <>
              <Card className="glass-panel">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="font-editorial">Overall trend (rolling mean of 5)</CardTitle>
                  <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">{data.count} calls in window</span>
                </CardHeader>
                <CardContent>
                  <svg viewBox={`0 0 ${Math.max(2, data.series.length) * 40} 120`} className={data.series.length < 4 ? "mx-auto h-28 w-2/3" : "h-36 w-full"} role="img" aria-label="Overall trend chart">
                    <defs>
                      <linearGradient id="valence-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                <polyline
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                  points={data.series.map((s, i) => `${i * 40 + 20},${120 - (s.overall / 100) * 110}`).join(' ')}
                />
                <polyline
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={data.rolling.map((v, i) => (v === null ? null : `${i * 40 + 20},${120 - (v / 100) * 110}`)).filter(Boolean).join(' ')}
                />
                {data.series.map((s, i) => (
                  <circle key={s.callId} cx={i * 40 + 20} cy={120 - (s.overall / 100) * 110} r="4" fill="var(--primary)" role="button" onClick={() => navigate(`/calls/${s.callId}?tab=scorecard`)} style={{ cursor: 'pointer' }}>
                    <title>{s.callTitle}: {s.overall}/100</title>
                  </circle>
                ))}
              </svg>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dims.map((dim) => {
              const quartile = data.topQuartileMeans[dim] ?? 0
              const mine = data.series.reduce((a, s) => a + (s.dimensions[dim] ?? 0), 0) / data.count
              const mean = Math.round(mine * 10) / 10
              return (
                <Card key={dim}>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="text-[var(--text-small)] capitalize">{dim.replace('_', ' ')}</CardTitle>
                    <span className="text-[var(--text-body)] font-semibold tabular-nums">{mean}<span className="text-[var(--text-micro)] font-normal text-[var(--muted-foreground)]">/10</span></span>
                  </CardHeader>
                  <CardContent>
                    <div className="relative h-1.5 rounded-full bg-[var(--raised)]">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--primary)]" style={{ width: `${mine * 10}%` }} />
                      <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-[var(--ink-secondary)]/70" style={{ left: `calc(${quartile * 10}% - 1px)` }} title={`top quartile ${(quartile / 10).toFixed(1)}`} />
                    </div>
                    <p className="mt-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">bar: your mean · line: your top quartile ({(quartile / 10).toFixed(1)})</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <Card>
            <CardHeader><CardTitle>Per-call table view</CardTitle></CardHeader>
            <CardContent className="max-h-80 overflow-y-auto scroll-warm">
              <table className="w-full text-[var(--text-small)]">
                <thead className="text-[var(--text-micro)] uppercase text-[var(--muted-foreground)]">
                  <tr className="text-left"><th className="pb-2">Call</th><th className="pb-2">When</th><th className="pb-2">Overall</th>{dims.map((d) => <th key={d} className="pb-2 capitalize">{d.replace('_', ' ')}</th>)}</tr>
                </thead>
                <tbody>
                  {data.series.map((s) => (
                    <tr key={s.callId} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--raised)]" onClick={() => navigate(`/calls/${s.callId}?tab=scorecard`)}>
                      <td className="py-2">{s.callTitle}</td>
                      <td className="py-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">{new Date(s.occurredAt).toLocaleDateString()}</td>
                      <td className="py-2 font-semibold tabular-nums">{s.overall}</td>
                      {dims.map((d) => <td key={d} className="py-2 tabular-nums">{s.dimensions[d] ?? '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ---------------- Best practices (screen 12, FR-016) ----------------

interface PracticeRow {
  id: string
  title: string
  category: string
  body: string
  origin: 'USER_PROMOTED' | 'MODEL_SUGGESTED'
  status: 'CANDIDATE' | 'ACCEPTED' | 'ARCHIVED'
  sourceCall?: { id: string; title: string } | null
  tags: string[]
}

export function PracticesView() {
  const qc = useQueryClient()
  const callsRev = useAmber((s) => s.callsRev)
  const [category, setCategory] = useState('all')
  const [q, setQ] = useState('')
  const params = new URLSearchParams()
  if (category !== 'all') params.set('category', category)
  if (q.trim()) params.set('q', q.trim())
  const practices = useQuery({
    queryKey: ['practices', category, q, callsRev],
    queryFn: () => api.get<{ items: PracticeRow[] }>(`/api/coaching/best-practices?${params.toString()}`),
  })
  const accept = useMutation({
    mutationFn: (id: string) => api.post('/api/best-practices', { acceptId: id }),
    onSuccess: () => { toast.success('Accepted into the playbook'); qc.invalidateQueries({ queryKey: ['practices'] }) },
  })
  const archive = useMutation({
    mutationFn: (id: string) => api.patch(`/api/best-practices/${id}`, { status: 'ARCHIVED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['practices'] }),
  })

  const items = practices.data?.items ?? []
  const candidates = items.filter((p) => p.status === 'CANDIDATE')
  const accepted = items.filter((p) => p.status === 'ACCEPTED')

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 pb-1">
        <h1 className="text-[length:var(--text-display)] font-semibold tracking-tight">Best practices</h1>
        <Input className="w-56" placeholder="search the playbook…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {['Discovery', 'Objections', 'Value', 'Next steps', 'Rapport', 'Other'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </header>

      {candidates.length > 0 && (
        <Card className="border-[var(--primary)]/40">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Suggested by the model ({candidates.length})</CardTitle>
            <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">suggestions need your accept</span>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {candidates.map((p) => (
              <div key={p.id} className="rounded-xl bg-[var(--raised)] p-4">
                <div className="flex items-center gap-2">
                  <Badge className="bg-[var(--accent-soft)] text-[var(--accent-ink)]">{p.category}</Badge>
                  <span className="text-[var(--text-small)] font-medium">{p.title}</span>
                </div>
                <p className="mt-2 text-[var(--text-small)] leading-relaxed text-[var(--ink-secondary)]">{p.body}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => accept.mutate(p.id)}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => archive.mutate(p.id)}>Decline</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {accepted.length === 0 && candidates.length === 0 ? (
        <EmptyState title="Your playbook is empty" hint="Promote moments from any transcript selection, or accept model suggestions as calls get analyzed." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accepted.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex-row items-center justify-between">
                <Badge variant="outline">{p.category}</Badge>
                <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">{p.origin === 'USER_PROMOTED' ? 'promoted by you' : 'from analysis'}</span>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-[var(--text-body)] font-medium">{p.title}</div>
                <p className="text-[var(--text-small)] leading-relaxed text-[var(--ink-secondary)]">{p.body}</p>
                {p.sourceCall && (
                  <button className="text-[var(--text-micro)] text-[var(--accent-ink)] underline decoration-dotted" onClick={() => navigate(`/calls/${p.sourceCall!.id}?tab=transcript`)}>
                    from: {p.sourceCall.title} →
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- Library (screen 13, FR-018/019/020) ----------------

interface SearchHit { id: string; resourceType: string; resourceId: string; callId: string | null; score: number; snippet: string; source: string; occurredAt?: string }
interface SearchResponse { mode: string; q?: string; degraded?: boolean; model?: string | null; minScore?: number; hits?: SearchHit[]; grouped?: { callId: string | null; top?: SearchHit; count: number }[]; recentCalls?: { id: string; title: string; occurredAt: string; deal?: { title: string } | null }[] }

export function LibraryView() {
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [group, setGroup] = useState(false)
  const [dealId, setDealId] = useState('all')
  const [speaker, setSpeaker] = useState('any')
  const [answer, setAnswer] = useState<{ refused: boolean; answer: string; citations: { hitId: string; quote: string }[] } | null>(null)

  const deals = useQuery({ queryKey: ['deals-lite'], queryFn: () => api.get<{ items: { id: string; title: string }[] }>('/api/deals?limit=200') })
  const search = useQuery({
    queryKey: ['library-search', submitted, group, dealId, speaker],
    queryFn: () =>
      api.post<SearchResponse>('/api/library/search', {
        q: submitted,
        group: group ? 'call' : undefined,
        filters: {
          dealId: dealId === 'all' ? undefined : dealId,
          speaker: speaker === 'any' ? undefined : speaker,
        },
      }),
    enabled: submitted.trim().length > 0,
  })
  const ask = useMutation({
    mutationFn: () => api.post<{ refused: boolean; answer: string; citations: { hitId: string; quote: string }[] }>('/api/library/answer', { q: submitted }),
    onSuccess: (res) => setAnswer(res),
  })

  const run = (e?: React.FormEvent) => {
    e?.preventDefault()
    setAnswer(null)
    setSubmitted(q)
  }

  return (
    <div className="space-y-6">
      <header className="pb-1">
        <h1 className="text-[length:var(--text-display)] font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-[var(--text-small)] text-[var(--muted-foreground)]">
          Semantic search across every transcript and insight — or ask a question and get a cited answer.
        </p>
      </header>
      <form onSubmit={run} className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="lib-q">Search everything said</Label>
          <Input id="lib-q" className="h-11 rounded-xl" value={q} onChange={(e) => setQ(e.target.value)} placeholder="quoted phrases also run a substring pass…" autoFocus />
        </div>
        <Button type="submit" className="h-11 rounded-xl" disabled={!q.trim()}>Search</Button>
        <Button type="button" variant="outline" className="h-11 rounded-xl" disabled={!submitted.trim() || ask.isPending} onClick={() => ask.mutate()}>Ask the library</Button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={dealId} onValueChange={setDealId}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All deals</SelectItem>
            {(deals.data?.items ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={speaker} onValueChange={setSpeaker}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any speaker</SelectItem>
            <SelectItem value="REP">You (rep)</SelectItem>
            <SelectItem value="PROSPECT">Prospect</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant={group ? 'default' : 'outline'} onClick={() => setGroup(!group)}>
          {group ? 'Grouped by call' : 'Flat list'}
        </Button>
        {search.data?.degraded && (
          <span className="text-[var(--text-micro)] text-[var(--warning)]" title="embedding provider unavailable; substring fallback active">
            degraded mode (lexical)
          </span>
        )}
      </div>

      {answer && (
        <Card className={answer.refused ? 'border-dashed' : undefined}>
          <CardHeader><CardTitle>{answer.refused ? 'Library answer: refused' : 'Library answer'}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[var(--text-body)]">{answer.answer}</p>
            {answer.citations.length > 0 && (
              <ul className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
                {answer.citations.map((c, i) => <li key={i}>[{i + 1}] “{c.quote.slice(0, 80)}…”</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!submitted ? (
        <EmptyState title="Find anything said" hint="One box searches transcripts, summaries, notes, practices, and confirmed insights — ranked by cosine similarity." />
      ) : search.isLoading ? (
        <EmptyState title="Searching…" />
      ) : (search.data?.hits?.length ?? 0) === 0 && (search.data?.grouped?.length ?? 0) === 0 ? (
        <EmptyState title="No hits" hint="Try different wording, drop filters, or lower the score floor in Settings." />
      ) : (
        <div className="space-y-2">
          {(group ? search.data!.grouped ?? [] : search.data!.hits ?? []).map((entry: { callId?: string | null; top?: SearchHit; count?: number } | SearchHit, i: number) => {
            const hit = 'top' in entry ? entry.top! : (entry as SearchHit)
            const count = 'count' in entry ? entry.count : undefined
            if (!hit) return null
            return (
              <Card key={hit.id + i} role="button" tabIndex={0} className="cursor-pointer transition-shadow hover:shadow-[var(--shadow-md)]" onClick={() => hit.callId && navigate(`/calls/${hit.callId}?tab=transcript`)}>
                <CardContent className="space-y-1.5 py-4">
                  <div className="flex items-center gap-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
                    <span className="rounded-full bg-[var(--raised)] px-2 py-0.5">{hit.source}</span>
                    <span className="tabular-nums">score {hit.score.toFixed(2)}</span>
                    {count !== undefined && <span>· {count} hits in this call</span>}
                    {hit.occurredAt && <span>· {new Date(hit.occurredAt).toLocaleDateString()}</span>}
                  </div>
                  <p className="text-[var(--text-small)] leading-relaxed">{hit.snippet}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------- Job monitor (screen 19) ----------------

interface JobRow { id: string; type: JobType; status: JobStatus; attempts: number; maxAttempts: number; lastError?: string | null; callId?: string | null; updatedAt: string }

export function JobsView() {
  const jobsRev = useAmber((s) => s.jobsRev)
  const jobs = useQuery({
    queryKey: ['jobs', jobsRev],
    queryFn: () => api.get<{ items: JobRow[]; total: number }>('/api/jobs'),
    refetchInterval: 5000,
  })
  const items = jobs.data?.items ?? []
  const active = items.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING')
  const recent = items.filter((j) => j.status !== 'QUEUED' && j.status !== 'RUNNING').slice(0, 30)

  return (
    <div className="space-y-4">
      <header className="flex items-baseline gap-4">
        <h1 className="text-[var(--text-title)] font-semibold">Job monitor</h1>
        <span className="text-[var(--text-small)] text-[var(--muted-foreground)]">stale locks are reclaimed on boot; attempts park at 3</span>
      </header>
      <Card>
        <CardHeader><CardTitle>Active ({active.length})</CardTitle></CardHeader>
        <CardContent className="max-h-72 overflow-y-auto scroll-warm">
          {active.length === 0 ? <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">Queue is idle.</p> : (
            <ul className="space-y-1.5">
              {active.map((j) => (
                <li key={j.id} className="flex items-center justify-between rounded-xl bg-[var(--raised)] px-3 py-2 text-[var(--text-small)]">
                  <span>{j.type}{j.callId ? ` · call …${j.callId.slice(-6)}` : ''}</span>
                  <span className="tabular-nums text-[var(--text-micro)] text-[var(--muted-foreground)]">{j.status} · attempt {j.attempts}/{j.maxAttempts}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent</CardTitle></CardHeader>
        <CardContent className="max-h-96 overflow-y-auto scroll-warm">
          {recent.length === 0 ? <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">Nothing yet.</p> : (
            <ul className="space-y-1.5">
              {recent.map((j) => (
                <li key={j.id} className="rounded-xl bg-[var(--raised)] px-3 py-2 text-[var(--text-small)]">
                  <div className="flex items-center justify-between">
                    <span>{j.type}{j.callId ? ` · call …${j.callId.slice(-6)}` : ''}</span>
                    <span className={`tabular-nums text-[var(--text-micro)] ${j.status === 'FAILED' ? 'text-[var(--danger)]' : 'text-[var(--muted-foreground)]'}`}>{j.status}</span>
                  </div>
                  {j.lastError && <p className="mt-0.5 truncate text-[var(--text-micro)] text-[var(--danger)]" title={j.lastError}>{j.lastError}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
