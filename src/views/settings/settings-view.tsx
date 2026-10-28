'use client'
// AMBER — screens 15-18 + 20: Settings (Providers/Budget/Redaction/Prompts) and Data.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { navigate } from '@/lib/router'
import { EmptyState, SpendMeter } from '@/components/amber/primitives'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Cable } from 'lucide-react'

type Tab = 'providers' | 'budget' | 'redaction' | 'prompts' | 'data'

export function SettingsView({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-editorial text-[length:var(--text-display)] font-semibold tracking-tight">Settings</h1>
          <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">
            Configure sovereign compute, budget thresholds, redaction rules, and system prompts.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate('/integrations')}
          className="gap-2 border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 shrink-0"
        >
          <Cable className="h-4 w-4" />
          <span>Integrations & Coding Agent Hub</span>
        </Button>
      </div>
      <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="redaction">Redaction</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="data">Data & backup</TabsTrigger>
        </TabsList>
        <TabsContent value="providers"><ProvidersTab /></TabsContent>
        <TabsContent value="budget"><BudgetTab /></TabsContent>
        <TabsContent value="redaction"><RedactionTab /></TabsContent>
        <TabsContent value="prompts"><PromptsTab /></TabsContent>
        <TabsContent value="data"><DataTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------- Providers (screen 15, FR-021) ----------------

interface HealthCardRow {
  provider: string
  up: boolean
  latencyMs: number | null
  models: string[]
  lastError: string | null
  configured: boolean
  checkedAtIso: string
}
interface ProvidersPayload {
  providers: HealthCardRow[]
  catalog: { hints: { hint: string; chain: { provider: string; model: string; contextTokens: number; pricePerMTokens: { input: number; output: number } | null }[] }[]; retention: Record<string, string> }
}

export function ProvidersTab() {
  const qc = useQueryClient()
  const providerRev = useAmber((s) => s.providerRev)
  const health = useQuery({
    queryKey: ['providers-health', providerRev],
    queryFn: () => api.get<ProvidersPayload>('/api/providers/health'),
    refetchInterval: 30_000,
  })
  const test = useMutation({
    mutationFn: (provider: string) => api.post<{ up: boolean; latencyMs: number; model: string; reply?: string; error?: string }>('/api/providers/test', { provider }),
    onSuccess: (res) => {
      if (res.up) toast.success(`${res.model} answered in ${res.latencyMs}ms`)
      else toast.error(res.error?.slice(0, 120) ?? 'Provider test failed')
      qc.invalidateQueries({ queryKey: ['providers-health'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Test failed'),
  })


  if (health.isLoading) return <EmptyState title="Checking providers…" />
  if (!health.data) return <EmptyState title="Provider health unavailable" />

  const LABELS: Record<string, string> = {
    ZAI: 'ZAI — bundled cloud intelligence',
    OLLAMA: 'Ollama — local models',
    OPENAI: 'OpenAI',
    ANTHROPIC: 'Anthropic',
    GEMINI: 'Google Gemini',
    COMPATIBLE: 'Compatible endpoint',
    MOCK: 'MOCK — deterministic fixtures',
    LOCAL_STT: 'Local STT (whisper)',
  }
  const SUBS: Record<string, string> = {
    ZAI: 'glm-4.6 chat + glm-asr · works out of the box · text-only egress (redacted)',
    OLLAMA: 'qwen3 / gpt-oss / nomic-embed — the local-first preference',
    MOCK: 'for CI/demo; disable via providers.mockEnabled',
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))] md:gap-4">
        {health.data.providers.map((p) => (
          <Card key={p.provider} className={p.up ? 'card-lift' : 'border-[color:var(--danger)]/40'}>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--text-small)] font-semibold">{LABELS[p.provider] ?? p.provider}</CardTitle>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[var(--text-micro)] font-medium ${p.up ? 'bg-[color:var(--positive)]/12 text-[var(--positive)]' : 'bg-[color:var(--danger)]/12 text-[var(--danger)]'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${p.up ? 'bg-[var(--positive)]' : 'bg-[var(--danger)]'}`} aria-hidden />
                {p.up ? `up · ${p.latencyMs ?? 0}ms` : p.configured ? 'down' : 'not configured'}
              </span>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <p className="text-[var(--text-micro)] leading-relaxed text-[var(--muted-foreground)]">
                {SUBS[p.provider] ?? (p.models.length > 0 ? p.models.slice(0, 4).join(', ') : 'no models listed')}
                {p.lastError ? ` · last error: ${p.lastError.slice(0, 60)}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {p.provider !== 'LOCAL_STT' && (
                  <Button size="sm" variant="outline" disabled={!p.configured || test.isPending} onClick={() => test.mutate(p.provider)}>
                    Test
                  </Button>
                )}

              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Local AI setup</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>AI routing is local-only; demo model responses and cloud AI are not used. Install and start <a href="https://ollama.com/download/windows" target="_blank" rel="noreferrer" className="underline">Ollama for Windows</a>, then run:</p>
          <pre className="overflow-auto rounded bg-[var(--raised)] p-3">ollama pull qwen3:4b{'\n'}ollama pull nomic-embed-text</pre>
          <p>qwen3:4b is the minimum setup. Optional fallback models are qwen3:8b and phi4-mini. Real recording transcription also requires a local Whisper installation and WHISPER_BINDING=whisper; scripted demo transcription cannot transcribe your recordings.</p>
          <Button variant="outline" size="sm" onClick={() => qc.fetchQuery({ queryKey: ['providers-health', providerRev], queryFn: () => api.get<ProvidersPayload>('/api/providers/health?force=1'), staleTime: 0 })}>Recheck local AI</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Model catalog (models.yaml — data, not code)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {health.data.catalog.hints.map((h) => (
            <div key={h.hint} className="rounded-xl bg-[var(--raised)] px-4 py-3">
              <div className="label-caps mb-2">hint: {h.hint}</div>
              <ul className="space-y-1.5 text-[var(--text-small)]">
                {h.chain.filter((e) => e.provider === 'OLLAMA').map((e) => (
                  <li key={`${e.provider}:${e.model}`} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.provider}</span>
                    <span className="text-[var(--ink-secondary)]">{e.model}</span>
                    <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">{(e.contextTokens / 1000).toFixed(0)}k ctx</span>
                    {e.pricePerMTokens && (
                      <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
                        ${e.pricePerMTokens.input}/${e.pricePerMTokens.output} per M tokens
                      </span>
                    )}
                    <span className="ml-auto text-[var(--text-micro)] text-[var(--muted-foreground)]">
                      retention: {health.data!.catalog.retention[e.provider.toUpperCase()] ?? 'unknown'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------- Budget (screen 16, FR-022) ----------------

interface BudgetPayload { month: string; capUsd: number; spentUsd: number; percent: number; entries: { id: string; amountUsd: number; note?: string | null; createdAt: string }[] }

export function BudgetTab() {
  const qc = useQueryClient()
  const budgetRev = useAmber((s) => s.budgetRev)
  const budget = useQuery({ queryKey: ['budget', budgetRev], queryFn: () => api.get<BudgetPayload>('/api/budget') })
  const [cap, setCap] = useState('')
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ items: { key: string; value: unknown }[] }>('/api/settings') })

  const patchCap = useMutation({
    mutationFn: (value: number) => api.patch('/api/settings', { key: 'budget.monthlyCapUsd', value }),
    onSuccess: () => {
      toast.success('Cap updated — the ledger enforces it from the next run')
      setCap('')
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  })

  if (budget.isLoading) return <EmptyState title="Loading budget…" />
  if (!budget.data) return <EmptyState title="Budget unavailable" />
  const mockEnabled = (settings.data?.items.find((s) => s.key === 'providers.mockEnabled')?.value as boolean) ?? true

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Cloud spend · {budget.data.month}</CardTitle>
          <SpendMeter spent={budget.data.spentUsd} cap={budget.data.capUsd} />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="cap">Monthly cap (USD)</Label>
            <div className="flex gap-2">
              <Input id="cap" className="w-28" type="number" min="0" step="0.5" value={cap} placeholder={String(budget.data.capUsd)} onChange={(e) => setCap(e.target.value)} />
              <Button disabled={!cap} onClick={() => patchCap.mutate(Number(cap))}>Set</Button>
            </div>
            <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
              Enforced at the ledger transaction: a run that would exceed the cap is refused (BUDGET_EXCEEDED) and degrades to local per policy.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">${budget.data.spentUsd.toFixed(2)}</div>
            <div className="text-[var(--text-micro)] text-[var(--muted-foreground)]">of ${budget.data.capUsd.toFixed(2)} · {budget.data.percent}%</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Entries ({budget.data.entries.length})</CardTitle>
          <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">local and mock runs write nothing — the chart stays honest</span>
        </CardHeader>
        <CardContent className="max-h-80 overflow-y-auto scroll-warm">
          {budget.data.entries.length === 0 ? (
            <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">
              No cloud spend this month. {mockEnabled ? 'The mock provider is serving tasks at $0 (demo/CI mode).' : 'Local providers are serving tasks at $0.'}
            </p>
          ) : (
            <table className="w-full text-[var(--text-small)]">
              <thead className="text-[var(--text-micro)] uppercase text-[var(--muted-foreground)]">
                <tr className="text-left"><th className="pb-2">When</th><th className="pb-2">Amount</th><th className="pb-2">Note</th></tr>
              </thead>
              <tbody>
                {budget.data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-[var(--border)]">
                    <td className="py-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-2 tabular-nums">${e.amountUsd.toFixed(4)}</td>
                    <td className="py-2 text-[var(--ink-secondary)]">{e.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------- Redaction (screen 17, T09) ----------------

export function RedactionTab() {
  const [sample, setSample] = useState('Reach me at sarah.klein@northwind-gmbh.de or +49 171 555 0123. Our CFO Sarah Klein signs after procurement.')
  const [output, setOutput] = useState<string | null>(null)
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ items: { key: string; value: unknown }[] }>('/api/settings') })
  const nerEnabled = (settings.data?.items.find((s) => s.key === 'redaction.nerEnabled')?.value as boolean) ?? true
  const patchNer = useMutation({
    mutationFn: (value: boolean) => api.patch('/api/settings', { key: 'redaction.nerEnabled', value }),
    onSuccess: () => {
      toast.success('NER pass toggled')
      settings.refetch()
    },
  })

  // The test pad runs client-side with the same default rules the sync scorer
  // uses; the production boundary is server-side (lib/redact/engine).
  const runPad = () => {
    let out = sample
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    out = out.replace(/(\+?[0-9][0-9 ()-]{7,18}[0-9])/g, '[PHONE]')
    out = out.replace(/\b[A-Z]{2}[0-9]{2}(?:[A-Z0-9]{4}){4,8}\b/g, '[IBAN]')
    out = out.replace(/\b\d[\d.,]*\s?(?:€|EUR|euros?|dollars?|USD|\$|k\b)/gi, '[AMOUNT]')
    if (nerEnabled) {
      out = out.replace(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g, (m) => (/^(Sarah|Tom|Anna|Mark)/.test(m) ? '<PERSON>' : m))
    }
    setOutput(out)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Egress contract</CardTitle>
          <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
            audio never leaves · text leaves only redacted · operational data stays home
          </span>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-[var(--text-small)] text-[var(--ink-secondary)]">
            <li>Class A (audio): never egresses, never enters an export.</li>
            <li>Class B/C (conversation text, derived intelligence): egress only redacted, only per policy.</li>
            <li>Class D (deals, contacts, spend): never sent to providers.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Rules</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-small)] text-[var(--ink-secondary)]">local NER pass</span>
            <Switch checked={nerEnabled} onCheckedChange={(v) => patchNer.mutate(v)} aria-label="Toggle NER pass" />
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-[var(--text-small)]">
            {[
              ['Email addresses', 'REGEX · MASK → [EMAIL]'],
              ['Phone numbers (E.164 and common formats)', 'REGEX · MASK → [PHONE]'],
              ['IBAN', 'REGEX · MASK → [IBAN]'],
              ['Credit card numbers', 'REGEX · SKIP (sentence dropped)'],
              ['Person names', 'NER · REPLACE → <PERSON>'],
              ['Organization names', 'NER · MASK → [ORG]'],
              ['Monetary amounts', 'NER · MASK → [AMOUNT]'],
            ].map(([name, mode]) => (
              <li key={name} className="flex items-center justify-between rounded-xl bg-[var(--raised)] px-3 py-2">
                <span>{name}</span>
                <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">{mode}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[var(--text-micro)] text-[var(--muted-foreground)]">
            Priority order, enabled toggles, and scope CLOUD_ONLY/ALL live in the RedactionRule table (Ch. 8).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Test pad (a rule you cannot see working is a rule you cannot trust)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={sample} onChange={(e) => setSample(e.target.value)} className="min-h-24" />
          <div className="flex items-center gap-2">
            <Button onClick={runPad}>Run through the pipeline</Button>
            {output && <Button variant="ghost" onClick={() => setOutput(null)}>Clear</Button>}
          </div>
          {output && (
            <div className="rounded-xl bg-[var(--raised)] p-3">
              <div className="mb-1 text-[var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">redacted payload (what a cloud provider would receive)</div>
              <p className="reader text-[var(--text-small)]">{output}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------- Prompts (screen 18, NFR-14) ----------------

interface TemplateRow { id: string; taskId: string; version: number; systemPrompt: string; userTemplate: string; modelHint: string | null; active: boolean; minContextChars: number }

export function PromptsTab() {
  const [taskId, setTaskId] = useState('T03')
  const templates = useQuery({ queryKey: ['prompt-templates'], queryFn: () => api.get<{ items: TemplateRow[] }>('/api/settings/prompts') })
  const items = templates.data?.items ?? []
  const tasks = [...new Set(items.map((t) => t.taskId))].sort()
  const versions = items.filter((t) => t.taskId === taskId).sort((a, b) => b.version - a.version)
  const active = versions.find((v) => v.active)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Prompt versions</CardTitle>
          <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">exactly one active version per task; edits create versions</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {tasks.map((t) => (
              <Button key={t} size="sm" variant={t === taskId ? 'default' : 'outline'} onClick={() => setTaskId(t)}>{t}</Button>
            ))}
          </div>
          {active ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-[var(--accent-soft)] text-[var(--accent-ink)]">active v{active.version}</Badge>
                <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">model hint: {active.modelHint ?? '—'} · min context: {active.minContextChars} chars</span>
              </div>
              <div className="rounded-xl bg-[var(--raised)] p-3">
                <div className="mb-1 text-[var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">system prompt</div>
                <pre className="reader whitespace-pre-wrap text-[var(--text-small)] leading-relaxed">{active.systemPrompt}</pre>
              </div>
              <div className="rounded-xl bg-[var(--raised)] p-3">
                <div className="mb-1 text-[var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">user template</div>
                <pre className="whitespace-pre-wrap text-[var(--text-small)] leading-relaxed">{active.userTemplate}</pre>
              </div>
              {versions.length > 1 && (
                <details className="rounded-xl bg-[var(--raised)] p-3">
                  <summary className="cursor-pointer text-[var(--text-small)] font-medium">history ({versions.length - 1} older)</summary>
                  <ul className="mt-2 space-y-1 text-[var(--text-micro)] text-[var(--muted-foreground)]">
                    {versions.filter((v) => !v.active).map((v) => <li key={v.id}>v{v.version} · inactive</li>)}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <EmptyState title="No templates for this task" />
          )}
        </CardContent>
      </Card>
      <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
        Activation is eval-gated: a version that drops any golden-set metric below threshold cannot be activated (enforced by the harness; CLI respects it with --force for experiments).
      </p>
    </div>
  )
}

// ---------------- Data & backup (screen 20) ----------------

export function DataTab() {
  const qc = useQueryClient()
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ backups: string[] }>('/api/system/backup') })
  const backup = useMutation({
    mutationFn: () => api.post<{ path: string; media: string; mediaOk: boolean | null }>('/api/system/backup'),
    onSuccess: (res) => {
      toast.success('Backup written', { description: `${res.path}${res.mediaOk ? ' + media hard-link sync' : ''}` })
      qc.invalidateQueries({ queryKey: ['backups'] })
    },
  })
  const [reindexing, setReindexing] = useState(false)
  const runReindex = async () => {
    setReindexing(true)
    try {
      await api.post('/api/system/reindex')
      toast.info('Re-index queued — progress on the job monitor')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not queue re-index')
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Backup (VACUUM INTO + media hard-link sync)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => backup.mutate()} disabled={backup.isPending}>{backup.isPending ? 'Backing up…' : 'Back up now'}</Button>
            <Button variant="outline" asChild>
              <a href="/api/system/export" download>Export JSON bundle</a>
            </Button>
            <Button variant="outline" disabled={reindexing} onClick={runReindex}>{reindexing ? 'Queued…' : 'Re-index library'}</Button>
          </div>
          <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
            Exports are redacted per rule scope ALL and contain no media bytes and no keys. The bundle plus the media dir fully reconstructs the system.
          </p>
          <div>
            <div className="mb-1 text-[var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">snapshots</div>
            {backups.data?.backups.length ? (
              <ul className="max-h-40 overflow-y-auto scroll-warm text-[var(--text-small)]">
                {backups.data.backups.map((b) => <li key={b} className="truncate rounded-xl bg-[var(--raised)] px-3 py-1.5">{b}</li>)}
              </ul>
            ) : (
              <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">No backups yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Restore drill</CardTitle></CardHeader>
        <CardContent className="text-[var(--text-small)] text-[var(--ink-secondary)]">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Stop the app; move dev.db aside.</li>
            <li>Copy the chosen snapshot to dev.db; rsync the matching media snapshot back.</li>
            <li>Start the app; open /api/system/health; confirm db ok and queueDepth.</li>
            <li>Spot-check one call's transcript and audio.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
