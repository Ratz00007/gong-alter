'use client'
// AMBER — screen 1: Dashboard. Today at a glance: recent calls, pipeline snapshot,
// review queue, spend meter (E/L/R states per Ch. 7).
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { navigate } from '@/lib/router'
import { StatCard, EmptyState, StatusChip, PageHeader, SkeletonList } from '@/components/amber/primitives'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Radio, Upload, PhoneCall, Handshake, Eye, CloudSun, ArrowRight, PhoneIncoming } from 'lucide-react'

interface CallRow { id: string; title: string; status: never; occurredAt: string; deal?: { title: string } | null; durationSec?: number | null }
interface PipelinePayload {
  byStage: Record<string, { id: string; title: string; account: string; healthScore: number | null; riskFlags: string[] }[]>
  total: { deals: number; valueCents: number }
}
interface Budget { month: string; capUsd: number; spentUsd: number; percent: number }

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late shift'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function LiveSessionBanner({ session }: { session: { title: string } }) {
  return (
    <button
      onClick={() => navigate('/live')}
      className="flex w-full items-center gap-4 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] p-5 text-left shadow-[var(--shadow-glow)] transition-transform duration-200 hover:scale-[1.01]"
    >
      <span className="relative flex h-3.5 w-3.5 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-[var(--accent)]" />
      </span>
      <div className="min-w-0">
        <p className="text-[var(--text-body)] font-semibold text-[var(--accent-ink)]">Live now: {session.title}</p>
        <p className="text-[var(--text-small)] text-[var(--ink-secondary)]">The console is running — jump back to the cue stack</p>
      </div>
      <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden />
    </button>
  )
}

export function DashboardView() {
  const callsRev = useAmber((s) => s.callsRev)
  const dealsRev = useAmber((s) => s.dealsRev)
  const budgetRev = useAmber((s) => s.budgetRev)
  const liveRev = useAmber((s) => s.liveRev)

  const liveActive = useQuery({
    queryKey: ['live-active', liveRev],
    queryFn: () => api.get<{ session: { id: string; title: string } | null }>('/api/live/active'),
  })

  const calls = useQuery({
    queryKey: ['dashboard-calls', callsRev],
    queryFn: () => api.get<{ items: CallRow[]; total: number }>('/api/calls?limit=6'),
  })
  const pipeline = useQuery({
    queryKey: ['dashboard-pipeline', dealsRev],
    queryFn: () => api.get<PipelinePayload>('/api/pipeline'),
  })
  const budget = useQuery({
    queryKey: ['budget', budgetRev],
    queryFn: () => api.get<Budget>('/api/budget'),
  })
  const review = useQuery({
    queryKey: ['dashboard-review', callsRev],
    queryFn: () => api.get<{ total: number }>('/api/calls?status=READY&limit=1'),
  })

  const failed = calls.isError || pipeline.isError

  if (failed) {
    return (
      <div className="space-y-6">
        <PageHeader title={greeting()} sub="Your day at a glance." />
        <EmptyState title="Dashboard failed to load" hint="Check the job monitor or system health, then reload." />
      </div>
    )
  }

  const activeDeals = pipeline.data?.total.deals ?? 0
  const pipelineValue = ((pipeline.data?.total.valueCents ?? 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  const reviewCount = review.data?.total ?? 0
  const openStages = Object.entries(pipeline.data?.byStage ?? {}).filter(([stage]) => stage !== 'WON' && stage !== 'LOST')
  const openCount = openStages.reduce((n, [, rows]) => n + rows.length, 0)

  const banner = liveActive.data?.session
  const loading = calls.isLoading || pipeline.isLoading

  return (
    <div className="space-y-6">
      <PageHeader
        title={greeting()}
        sub="Your day at a glance — calls, pipeline, and the coaching loop."
        actions={
          <>
            <Button size="sm" onClick={() => navigate('/live')}>
              <Radio className="h-3.5 w-3.5" aria-hidden /> Go live
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/upload')}>
              <Upload className="h-3.5 w-3.5" aria-hidden /> Upload recording
            </Button>
          </>
        }
      />

      {banner && <LiveSessionBanner session={banner} />}

      {reviewCount > 0 && (
        <button
          onClick={() => navigate('/inbox?status=READY')}
          className="group flex w-full items-center gap-4 rounded-2xl border border-[var(--border)] bg-gradient-to-r from-[var(--accent-soft)] via-[var(--card)] to-[var(--card)] p-5 text-left shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--primary)] text-white shadow-[var(--shadow-glow)]">
            <Eye className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[var(--text-body)] font-semibold tracking-tight text-[var(--foreground)]">
              {reviewCount} call{reviewCount === 1 ? '' : 's'} ready for your eyes
            </p>
            <p className="text-[var(--text-small)] text-[var(--ink-secondary)]">Summaries, MEDDIC, and drafted follow-ups are waiting — open the review queue</p>
          </div>
          <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-[var(--primary)] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </button>
      )}

      <section className="grid grid-cols-2 gap-4 min-w-0 lg:grid-cols-4" aria-label="Key numbers">
        <StatCard
          label="Calls in library"
          value={calls.data?.total ?? 0}
          sub="excluding archived"
          icon={<PhoneCall className="h-4 w-4" aria-hidden />}
          animate
          onClick={() => navigate('/inbox')}
        />
        <StatCard
          label="Open deals"
          value={activeDeals}
          sub={`pipeline value ${pipelineValue}`}
          icon={<Handshake className="h-4 w-4" aria-hidden />}
          animate
          onClick={() => navigate('/board')}
        />
        <StatCard
          label="Review queue"
          value={reviewCount}
          sub="ready calls to confirm"
          icon={<Eye className="h-4 w-4" aria-hidden />}
          animate
          onClick={() => navigate('/inbox?status=READY')}
        />
        <StatCard
          label="Monthly AI spend"
          value={budget.data ? `€${budget.data.spentUsd.toFixed(2)}` : '—'}
          sub={budget.data ? `${budget.data.percent}% of €${budget.data.capUsd} cap` : 'loading…'}
          icon={<CloudSun className="h-4 w-4" aria-hidden />}
          onClick={() => navigate('/settings?tab=budget')}
        />
      </section>

      <div className="grid gap-6 min-w-0 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent calls</CardTitle>
            <Button variant="ghost" size="sm" className="text-[var(--muted-foreground)]" onClick={() => navigate('/inbox')}>
              View all →
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <SkeletonList rows={5} />
            ) : (calls.data?.items.length ?? 0) > 0 ? (
              <ul className="space-y-2">
                {calls.data!.items.map((c) => (
                  <li
                    key={c.id}
                    onClick={() => navigate(`/calls/${c.id}`)}
                    className="card-lift flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left transition-colors hover:border-[var(--primary)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[var(--text-small)] font-medium text-[var(--foreground)]">{c.title}</p>
                      <p className="truncate text-[var(--text-micro)] text-[var(--muted-foreground)]">
                        {new Date(c.occurredAt).toLocaleDateString()} · {c.deal?.title ?? 'No deal'}
                        {c.durationSec ? ` · ${Math.round(c.durationSec / 60)} min` : ''}
                      </p>
                    </div>
                    <StatusChip status={c.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No calls yet"
                hint="Drop a recording and AMBER transcribes, analyzes, and drafts the follow-up for you."
                icon={<PhoneIncoming className="h-5 w-5" aria-hidden />}
                action={<Button onClick={() => navigate('/upload')}>Upload your first call</Button>}
              />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Pipeline snapshot</CardTitle>
            <Button variant="ghost" size="sm" className="text-[var(--muted-foreground)]" onClick={() => navigate('/board')}>
              Board →
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <SkeletonList rows={4} />
            ) : openCount > 0 ? (
              openStages.map(([stage, rows]) => (
                <div key={stage} className="rounded-xl bg-[var(--raised)] px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="label-caps">{stage}</span>
                    <span className="text-[var(--text-micro)] font-medium tabular-nums text-[var(--ink-secondary)]">{rows.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rows.slice(0, 5).map((d) => (
                      <button
                        key={d.id}
                        onClick={() => navigate(`/deals/${d.id}`)}
                        className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-0.5 text-[var(--text-micro)] transition-colors hover:border-[var(--primary)] hover:text-[var(--accent-ink)]"
                        title={`health ${d.healthScore ?? '—'} · ${d.riskFlags.join(', ') || 'no flags'}`}
                      >
                        {d.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="Pipeline is empty"
                hint="Create your first deal to unlock the board, MEDDIC tracking, and health scores."
                icon={<Handshake className="h-5 w-5" aria-hidden />}
                action={<Button onClick={() => navigate('/deals')}>Create a deal</Button>}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
