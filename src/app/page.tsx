'use client'
// AMBER — the single page. All 20 screens are hash-routed views (Ch. 7).
// Keyboard layer per Table 7.3 + ⌘K command palette. Live updates via SSE only
// (no polling loops for state; the inbox uses a short refetchInterval only
// while a call is busy).
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { parseHash, useHashRoute, navigate } from '@/lib/router'
import { useAmber, useSse } from '@/lib/store'
import { LoginView } from '@/views/auth/login-view'
import { DashboardView } from '@/views/dashboard/dashboard-view'
import { InboxView, UploadView } from '@/views/inbox/inbox-view'
import { CallDetailView } from '@/views/call/call-detail-view'
import { BoardView } from '@/views/board/board-view'
import { DealsView, DealFormView, DealDetailView } from '@/views/deals/deals-view'
import { CoachingView, PracticesView, LibraryView, JobsView } from '@/views/coaching/coaching-views'
import { SettingsView } from '@/views/settings/settings-view'
import { LiveView } from '@/views/live/live-view'
import { IntegrationsView } from '@/views/integrations/integrations-view'
import { VoiceCopilotHud } from '@/components/copilot/voice-copilot-hud'
import { EmptyState, SpendMeter, ThemeToggle } from '@/components/amber/primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { toast } from 'sonner'
import { LayoutDashboard, Inbox, KanbanSquare, Handshake, GraduationCap, Search, BookMarked, Server, Settings, Lock, Radio, Upload, Command as CommandIcon, PhoneCall, Mic, Cable } from 'lucide-react'

export default function Home() {
  const authed = useAmber((s) => s.authed)
  const setAuthed = useAmber((s) => s.setAuthed)
  useSse()

  useEffect(() => {
    api
      .get<{ authed: boolean }>('/api/system/health')
      .then((h) => setAuthed(h.authed))
      .catch(() => setAuthed(false))
  }, [setAuthed])

  if (authed === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="glass-panel flex flex-col items-center gap-4 rounded-3xl p-8 shadow-[var(--shadow-lg)]">
          <div className="brand-gradient grid h-12 w-12 place-items-center rounded-2xl text-base font-bold text-white shadow-[var(--shadow-glow)]">V</div>
          <div className="text-center">
            <h2 className="font-editorial text-lg font-semibold text-[var(--foreground)]">VALENCE</h2>
            <p className="mt-1 text-[var(--text-micro)] text-[var(--muted-foreground)] tracking-wide">sovereign revenue intelligence is waking up…</p>
          </div>
        </div>
      </main>
    )
  }
  if (!authed) return <LoginView />
  return <Shell />
}

const NAV = [
  { hash: '/', label: 'Dashboard', icon: LayoutDashboard, key: 'd0' },
  { hash: '/live', label: 'Live', icon: Radio, key: 'v' },
  { hash: '/inbox', label: 'Calls', icon: Inbox, key: 'c' },
  { hash: '/board', label: 'Board', icon: KanbanSquare, key: 'd' },
  { hash: '/deals', label: 'Deals', icon: Handshake, key: null },
  { hash: '/coaching', label: 'Coaching', icon: GraduationCap, key: 'k' },
  { hash: '/library', label: 'Library', icon: Search, key: 'l' },
  { hash: '/practices', label: 'Practices', icon: BookMarked, key: null },
  { hash: '/integrations', label: 'Integrations', icon: Cable, key: 'i' },
  { hash: '/jobs', label: 'Jobs', icon: Server, key: null },
  { hash: '/settings', label: 'Settings', icon: Settings, key: 's' },
] as const

interface SystemHealth {
  db: string
  ollama: boolean
  queueDepth: number
  routingMode: string
  stt: string
  authed: boolean
}

function Shell() {
  const route = useHashRoute()
  const setAuthed = useAmber((s) => s.setAuthed)
  const [helpOpen, setHelpOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [voiceCopilotOpen, setVoiceCopilotOpen] = useState(false)
  const [goBuffer, setGoBuffer] = useState<string | null>(null)

  const health = useQuery({
    queryKey: ['shell-health'],
    queryFn: () => api.get<SystemHealth>('/api/system/health'),
    refetchInterval: 30_000,
  })
  const providers = useQuery({
    queryKey: ['shell-providers'],
    queryFn: () => api.get<{ providers: { provider: string; up: boolean }[] }>('/api/providers/health'),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })
  const budget = useAmber((s) => s.budgetRev)
  const spend = useQuery({
    queryKey: ['budget', budget],
    queryFn: () => api.get<{ capUsd: number; spentUsd: number }>('/api/budget'),
  })

  // Dynamic entities for omni-search
  const paletteCalls = useQuery({
    queryKey: ['palette-calls'],
    queryFn: () => api.get<{ items: { id: string; title: string; deal?: { title: string } | null }[] }>('/api/calls?limit=8'),
  })
  const paletteDeals = useQuery({
    queryKey: ['palette-deals'],
    queryFn: () => api.get<{ items: { id: string; title: string; account: string }[] }>('/api/deals?limit=8'),
  })

  // ---- keyboard layer (Table 7.3) + ⌘K palette ----
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        setVoiceCopilotOpen((v) => !v)
        return
      }
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (goBuffer) {
        const map: Record<string, string> = { c: '/inbox', d: '/deals', i: '/integrations', k: '/coaching', l: '/library', s: '/settings', v: '/live' }
        const dest = map[e.key]
        setGoBuffer(null)
        if (dest) {
          e.preventDefault()
          navigate(dest)
          return
        }
      }
      if (e.key === 'g') {
        setGoBuffer('g')
        setTimeout(() => setGoBuffer(null), 1200)
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        navigate('/library')
        setTimeout(() => (document.getElementById('lib-q') as HTMLInputElement | null)?.focus(), 60)
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen((v) => !v)
      }
    },
    [goBuffer],
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const active = (hash: string) => {
    const current = `/${route.segs[0] ?? ''}`
    return hash === '/' ? current === '/' : current === hash
  }

  const aiUp = providers.data?.providers?.find((p) => p.provider === 'ZAI')?.up ?? false

  const paletteItems = [
    { label: 'Oracle Voice Copilot', icon: Mic, action: () => setVoiceCopilotOpen(true) },
    { label: 'Go live — real-time console', icon: Radio, action: () => navigate('/live') },
    { label: 'Upload a recording', icon: Upload, action: () => navigate('/upload') },
    { label: 'Dashboard', icon: LayoutDashboard, action: () => navigate('/') },
    { label: 'Calls library', icon: Inbox, action: () => navigate('/inbox') },
    { label: 'Pipeline Board', icon: KanbanSquare, action: () => navigate('/board') },
    { label: 'Deals room', icon: Handshake, action: () => navigate('/deals') },
    { label: 'Coaching insights', icon: GraduationCap, action: () => navigate('/coaching') },
    { label: 'Semantic Library search', icon: Search, action: () => navigate('/library') },
    { label: 'Integrations & Agent Plugin', icon: Cable, action: () => navigate('/integrations') },
    { label: 'Best Practices', icon: BookMarked, action: () => navigate('/practices') },
    { label: 'Background Jobs', icon: Server, action: () => navigate('/jobs') },
    { label: 'System Settings', icon: Settings, action: () => navigate('/settings') },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top Frameless Titlebar with Window Drag Region */}
      <div className="glass-header app-drag-region sticky top-0 z-40 flex h-10 w-full items-center justify-between px-4 text-[12px] font-medium text-[var(--muted-foreground)] select-none">
        <div className="flex items-center gap-2.5">
          <span className="brand-gradient grid h-5 w-5 place-items-center rounded-md text-[10px] font-bold text-white shadow-[var(--shadow-glow)]">V</span>
          <span className="font-editorial text-[13px] font-semibold tracking-tight text-[var(--foreground)]">VALENCE</span>
          <span className="hidden sm:inline text-[10px] text-[var(--muted-foreground)]/70">· sovereign revenue intelligence</span>
        </div>
        <div className="app-no-drag flex items-center gap-2.5">
          <button
            onClick={() => setVoiceCopilotOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/20 transition-all shadow-[var(--shadow-xs)]"
            title="Ask Oracle Voice Copilot (Alt+V)"
          >
            <Mic className="h-3.5 w-3.5 text-[var(--primary)]" />
            <span>Voice Copilot</span>
            <kbd className="rounded border border-[var(--primary)]/30 bg-[var(--raised)] px-1 py-0.2 text-[9px] font-mono">Alt+V</kbd>
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-colors shadow-[var(--shadow-sm)]"
          >
            <span>Jump to anything…</span>
            <kbd className="rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-0.2 text-[9px] font-mono">⌘K</kbd>
          </button>
          <ThemeToggle className="h-7 w-7 rounded-lg" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Primary"
          className="sticky top-10 z-30 flex h-[calc(100vh-2.5rem)] w-14 shrink-0 flex-col gap-1 overflow-y-auto scroll-warm border-r border-[var(--border)] bg-[var(--sidebar)] px-2 py-4 md:w-60 md:px-3"
        >
          <a href="#/" className="mb-4 px-1 md:px-2" aria-label="VALENCE home">
            <div className="flex items-center gap-2.5">
              <div className="brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white shadow-[var(--shadow-glow)]">V</div>
              <div className="hidden min-w-0 md:block">
                <div className="font-editorial text-[length:var(--text-title)] font-semibold leading-tight tracking-tight text-[var(--foreground)]">VALENCE</div>
                <div className="truncate text-[var(--text-micro)] text-[var(--muted-foreground)]">sovereign revenue intelligence</div>
              </div>
            </div>
          </a>
          {NAV.map((item) => (
            <a
              key={item.hash}
              href={`#${item.hash}`}
              title={item.label}
              className={`group flex items-center justify-center rounded-xl px-2 py-2 transition-all duration-200 md:justify-start md:gap-2.5 md:px-3 ${
                active(item.hash)
                  ? 'bg-[var(--sidebar-accent)] font-medium text-[var(--sidebar-accent-foreground)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--ink-secondary)] hover:bg-[var(--raised)] hover:text-[var(--foreground)]'
              }`}
            >
              <item.icon className={`h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${active(item.hash) ? 'text-[var(--primary)]' : ''}`} aria-hidden />
              <span className="hidden md:inline">{item.label}</span>
            </a>
          ))}
          <div className="mt-auto space-y-3 px-1 pt-4">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left text-[var(--text-micro)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink-secondary)] md:flex"
              aria-label="Open command palette"
            >
              <CommandIcon className="h-3.5 w-3.5" aria-hidden />
              <span>Omni-actions</span>
              <kbd className="ml-auto rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-0.5 text-[10px] font-mono">⌘K</kbd>
            </button>
            <div className="hidden flex-wrap gap-1.5 md:flex" aria-label="System status">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${aiUp ? 'bg-[color:var(--positive)]/15 text-[var(--positive)]' : 'bg-[var(--raised)] text-[var(--muted-foreground)]'}`}
                title={aiUp ? 'Cloud AI reachable' : 'Cloud AI not reachable — local routing active'}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${aiUp ? 'bg-[var(--positive)]' : 'bg-[var(--muted-foreground)]'}`} aria-hidden />
                AI {aiUp ? 'live' : 'local'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--raised)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-secondary)]" title="Routing policy">
                {health.data?.routingMode ?? '…'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--raised)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-secondary)]" title="Job queue depth">
                queue {health.data?.queueDepth ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] md:justify-start"
                title="Lock"
                aria-label="Lock"
                onClick={async () => {
                  await api.post('/api/auth/logout').catch(() => null)
                  setAuthed(false)
                  toast.info('Locked — see you in 12 hours')
                }}
              >
                <Lock className="h-3.5 w-3.5" aria-hidden /> <span className="hidden md:inline">Lock</span>
              </Button>
              <ThemeToggle className="hidden md:flex" />
            </div>
          </div>
        </nav>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-1200">
            <div key={`${route.segs[0] ?? 'home'}-${route.segs[1] ?? ''}`} className="view-enter">
              <ViewSwitch route={route} />
            </div>
          </div>
        </main>
      </div>

      <footer className="mt-auto border-t border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-1200 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <SpendMeter spent={spend.data?.spentUsd ?? 0} cap={spend.data?.capUsd ?? 5} />
          <span className="hidden text-[var(--text-micro)] text-[var(--muted-foreground)] sm:inline font-editorial">
            sovereign local intelligence · audio never leaves this machine · all models cost-tracked
          </span>
          <span className="ml-auto flex items-center gap-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
            <kbd className="rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-0.5">⌘K</kbd> omni
            <kbd className="rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-0.5">?</kbd> shortcuts
          </span>
        </div>
      </footer>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <Command>
          <CommandInput placeholder="Search calls, deals, or jump to actions…" />
          <CommandList className="scroll-warm">
            <CommandEmpty>No results found.</CommandEmpty>

            {/* Quick Actions */}
            <CommandGroup heading="Actions">
              {paletteItems.slice(0, 2).map((item) => (
                <CommandItem
                  key={item.label}
                  onSelect={() => {
                    item.action()
                    setPaletteOpen(false)
                  }}
                >
                  <item.icon className="mr-2 h-4 w-4 text-[var(--primary)]" aria-hidden />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />

            {/* Recent Calls Omni-Search */}
            {(paletteCalls.data?.items?.length ?? 0) > 0 && (
              <>
                <CommandGroup heading="Recent Calls">
                  {paletteCalls.data?.items.map((c) => (
                    <CommandItem
                      key={c.id}
                      onSelect={() => {
                        navigate(`/calls/${c.id}`)
                        setPaletteOpen(false)
                      }}
                    >
                      <PhoneCall className="mr-2 h-4 w-4 text-[var(--primary)]" aria-hidden />
                      <span className="truncate">{c.title}</span>
                      {c.deal && <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{c.deal.title}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {/* Deals Omni-Search */}
            {(paletteDeals.data?.items?.length ?? 0) > 0 && (
              <>
                <CommandGroup heading="Active Deals">
                  {paletteDeals.data?.items.map((d) => (
                    <CommandItem
                      key={d.id}
                      onSelect={() => {
                        navigate(`/deals/${d.id}`)
                        setPaletteOpen(false)
                      }}
                    >
                      <Handshake className="mr-2 h-4 w-4 text-[var(--primary)]" aria-hidden />
                      <span className="truncate">{d.title}</span>
                      <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{d.account}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {/* Navigation Routes */}
            <CommandGroup heading="Navigation">
              {paletteItems.slice(2).map((item) => (
                <CommandItem
                  key={item.label}
                  onSelect={() => {
                    item.action()
                    setPaletteOpen(false)
                  }}
                >
                  <item.icon className="mr-2 h-4 w-4" aria-hidden />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="glass-panel">
          <DialogHeader>
            <DialogTitle className="font-editorial text-[length:var(--text-title)]">VALENCE Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-[var(--text-small)]">
            {[
              ['⌘K / Ctrl+K', 'Omni-Search — jump to calls, deals, or actions'],
              ['Alt+V', 'Voice Copilot — ask about deals and calls with voice'],
              ['Space', 'Play / pause audio in call reader'],
              ['[ / ]', 'Jump to previous / next speaker turn in call'],
              ['← / →', 'Scrub backward / forward 5 seconds'],
              ['g then c / d / k / l / s / v', 'Go to Calls / Deals / Coaching / Library / Settings / Live'],
              ['/', 'Focus search (Library or in-call transcript find)'],
              ['?', 'Keyboard shortcuts cheat sheet'],
            ].map(([keys, action]) => (
              <li key={keys} className="flex items-baseline justify-between gap-6">
                <kbd className="rounded border border-[var(--border)] bg-[var(--raised)] px-1.5 py-0.5 text-[var(--text-micro)] font-mono">{keys}</kbd>
                <span className="text-right text-[var(--ink-secondary)]">{action}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <VoiceCopilotHud
        open={voiceCopilotOpen}
        onClose={() => setVoiceCopilotOpen(false)}
        activeDealId={route.segs[0] === 'deals' ? route.segs[1] : null}
        activeCallId={route.segs[0] === 'calls' ? route.segs[1] : null}
      />
    </div>
  )
}

function ViewSwitch({ route }: { route: ReturnType<typeof parseHash> }) {
  const [root, second] = route.segs
  const tab = route.query.get('tab')
  switch (root) {
    case undefined:
    case '':
      return <DashboardView />
    case 'inbox':
      return <InboxView />
    case 'upload':
      return <UploadView />
    case 'live':
      return <LiveView />
    case 'calls':
      if (!second) return <EmptyState title="Call not found" action={<Button onClick={() => navigate('/inbox')}>Back to inbox</Button>} />
      return <CallDetailView id={second} tab={(tab as 'overview') ?? 'overview'} onTab={(t) => navigate(`/calls/${second}?tab=${t}`)} />
    case 'board':
      return <BoardView />
    case 'deals':
      if (second === 'new') return <DealFormView />
      if (second) return <DealDetailView id={second} />
      return <DealsView />
    case 'contacts':
      return <EmptyState title="Contacts live on each deal" hint="Contacts are deal-scoped by design; open a deal to manage them." action={<Button onClick={() => navigate('/deals')}>Open deals</Button>} />
    case 'coaching':
      return <CoachingView />
    case 'practices':
      return <PracticesView />
    case 'integrations':
      return <IntegrationsView />
    case 'library':
      return <LibraryView />
    case 'jobs':
      return <JobsView />
    case 'settings':
      return <SettingsView tab={(tab as 'providers') ?? 'providers'} onTab={(t) => navigate(`/settings?tab=${t}`)} />
    default:
      return <EmptyState title="Nothing here" hint={`No route for #${route.raw}`} action={<Button onClick={() => navigate('/')}>Home</Button>} />
  }
}
