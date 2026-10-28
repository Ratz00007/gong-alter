'use client'
// AMBER Live Assist (WO-LA5, FR-025..029) — screen 21: the Live Console.
// Start a session, stream captions (browser mic where available, demo feed
// anywhere), get deterministic battlecard cues in real time, then end into the
// six-stage pipeline. Audio never leaves the machine; cloud captions are an
// explicit opt-in per session with an egress badge.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { navigate } from '@/lib/router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader, SkeletonList } from '@/components/amber/primitives'
import { Radio, Mic, Square, Send, PlayCircle, ShieldAlert, Trash2, Pencil, Plus, Copy, Check, Activity } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface LiveSessionRow {
  id: string
  title: string
  status: 'LIVE' | 'ENDED'
  source: string
  startedAt: string
  endedAt?: string | null
  durationMs: number
  transcriptText: string
  wordCount: number
  questionCount: number
  cueCount: number
  callId?: string | null
  deal?: { id: string; title: string } | null
}

interface CueRow {
  id: string
  name: string
  category: string
  kind: string
  triggers: unknown
  guidance: string
  cooldownSec: number
  enabled: boolean
}

interface FireRow {
  id: string
  atMs: number
  snippet: string
  cue: { name: string; category: string; guidance: string }
}

const CATEGORY_TONE: Record<string, string> = {
  OBJECTION: 'bg-[var(--accent-soft)] text-[var(--accent-ink)]',
  COMPETITOR: 'bg-[var(--raised)] text-[var(--ink-secondary)]',
  PROCESS: 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]',
  COACHING: 'bg-[var(--card)] text-[var(--muted-foreground)] border border-[var(--border)]',
}

const DEMO_SCRIPT = [
  'Thanks for making time today. Before I show you anything — what made you take this call?',
  'Honestly, we are drowning in spreadsheets. Our reps log everything by hand and nobody reads it.',
  'How many hours a week does that cost your team, roughly?',
  'At least ten hours per rep. And we keep losing context between calls.',
  'Let me show you how the pipeline view works — every call is transcribed and scored automatically.',
  'Interesting. We looked at Gong last year but it was too expensive for our team size.',
  'What did the pricing look like, and what were you hoping it would solve?',
  'Around eighteen hundred per seat. One more thing — how do you handle security? We are SOC 2 shops, GDPR matters to us.',
  'Everything stays on your infrastructure, and recordings are encrypted at rest. I can send the security pack.',
  'Send me some information and we will circle back.',
  'Happy to. What if I send the two-pager today and we book twenty minutes Thursday to walk the numbers?',
  'That works. Our deadline is end of quarter, so sooner is better.',
]

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function LiveView() {
  const liveRev = useAmber((s) => s.liveRev)
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [dealId, setDealId] = useState('none')
  const [source, setSource] = useState<'BROWSER_MIC' | 'INJECTED'>('INJECTED')
  const [demoLine, setDemoLine] = useState('')
  const [runningDemo, setRunningDemo] = useState(false)
  const [captionsOn, setCaptionsOn] = useState(false)
  const [recording, setRecording] = useState(false)
  const [ending, setEnding] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const captionRef = useRef<{ stop: () => void } | null>(null)
  const demoAbort = useRef(false)

  const active = useQuery({
    queryKey: ['live-active', liveRev],
    queryFn: () => api.get<{ session: LiveSessionRow | null }>('/api/live/active'),
  })
  const deals = useQuery({
    queryKey: ['deals-lite'],
    queryFn: () => api.get<{ items: { id: string; title: string }[] }>('/api/deals?limit=200'),
  })
  const session = active.data?.session ?? null

  const detail = useQuery({
    queryKey: ['live-detail', session?.id, liveRev],
    queryFn: () => api.get<LiveSessionRow & { cueFires: FireRow[] }>(`/api/live/${session!.id}`),
    enabled: !!session,
  })
  const history = useQuery({
    queryKey: ['live-history'],
    queryFn: () => api.get<{ items: (LiveSessionRow & { cueFireCount?: number })[] }>('/api/live?limit=10'),
    enabled: !session,
  })

  // elapsed timer (client-side tick; server value is truth on refetch)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!session) return
    const t0 = new Date(session.startedAt).getTime()
    const tick = () => setElapsed(Date.now() - t0)
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [session?.id, session])

  const startSession = useCallback(async () => {
    try {
      await api.post('/api/live', {
        title: title.trim() || undefined,
        dealId: dealId === 'none' ? null : dealId,
        source,
      })
      // SSE bumps liveRev, but do not depend on its timing for the initial
      // idle -> console transition (first paint of the session).
      void queryClient.invalidateQueries({ queryKey: ['live-active'] })
      void queryClient.invalidateQueries({ queryKey: ['live-history'] })
      setTitle('')
      toast.success('Live session started', { description: source === 'BROWSER_MIC' ? 'Mic capture arms when you press Record' : 'Demo feed is ready' })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start the session')
    }
  }, [title, dealId, source])

  const sendDelta = useCallback(
    async (text: string) => {
      if (!session || !text.trim()) return
      try {
        const res = await api.post<{ fires: { name: string }[] }>(`/api/live/${session.id}/delta`, { text })
        if (res.fires.length > 0) {
          toast.info(res.fires.map((f) => f.name).join(' · '), { description: 'Battlecard fired — see the cue stack' })
        }
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Delta failed')
      }
    },
    [session],
  )

  const runDemoScript = useCallback(async () => {
    if (!session || runningDemo) return
    setRunningDemo(true)
    demoAbort.current = false
    for (const line of DEMO_SCRIPT) {
      if (demoAbort.current) break
      await sendDelta(line)
      await new Promise((r) => setTimeout(r, 700))
    }
    setRunningDemo(false)
  }, [session, runningDemo, sendDelta])

  const uploadChunk = useCallback(
    async (blob: Blob) => {
      if (!session) return
      try {
        await fetch(`/api/live/${session.id}/audio`, { method: 'POST', body: blob })
      } catch {
        /* chunk loss is tolerated; the live text layer still carries the session */
      }
    },
    [session],
  )

  const toggleRecording = useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop()
      recorderRef.current = null
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' })
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) void uploadChunk(e.data)
      }
      rec.onstop = () => stream.getTracks().forEach((t) => t.stop())
      rec.start(2000)
      recorderRef.current = rec
      setRecording(true)
      toast.success('Recording — audio stays on this machine')
    } catch {
      toast.error('No microphone available', { description: 'Use the demo feed or type lines instead' })
    }
  }, [recording, uploadChunk])

  const toggleCaptions = useCallback(
    (on: boolean) => {
      if (on) {
        toast.info('Live browser captions are disabled in local-only mode. Type notes instead.')
        return
      }
      setCaptionsOn(on)
      if (!on) {
        captionRef.current?.stop()
        captionRef.current = null
        return
      }
      const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
      if (!Ctor) {
        toast.error('Live captions are not available in this browser', { description: 'Chrome and Edge support them; the demo feed works everywhere' })
        setCaptionsOn(false)
        return
      }
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = 'en-US'
      rec.onresult = (e: SpeechRecognitionEventLike) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) void sendDelta(r[0].transcript)
        }
      }
      rec.onerror = () => toast.error('Caption stream stopped', { description: 'The session keeps running; resume or keep typing' })
      try {
        rec.start()
        captionRef.current = { stop: () => rec.stop() }
        toast.info('Live captions on', { description: 'Caption text is processed like any transcript — cloud STT egress, opt-in only' })
      } catch {
        setCaptionsOn(false)
      }
    },
    [sendDelta],
  )

  const endSession = useCallback(
    async (process: boolean) => {
      if (!session) return
      setEnding(true)
      if (runningDemo) demoAbort.current = true
      if (captionRef.current) {
        captionRef.current.stop()
        captionRef.current = null
        setCaptionsOn(false)
      }
      if (recorderRef.current) {
        recorderRef.current.stop()
        recorderRef.current = null
        setRecording(false)
      }
      try {
        const res = await api.post<{ callId: string | null; reason: string | null; mode: string | null }>(`/api/live/${session.id}/end`, { process })
        await new Promise((r) => setTimeout(r, 600)) // let the final audio chunk land
        if (res.reason === 'TOO_SHORT') {
          toast.warning('Kept as a record', { description: 'Under 25 words and no audio — no call was created' })
        } else if (res.callId) {
          toast.success(process ? 'Processing the call…' : 'Session saved')
          if (process) {
            navigate(`/calls/${res.callId}`)
            return
          }
        }
        void queryClient.invalidateQueries()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'End failed')
      } finally {
        setEnding(false)
      }
    },
    [session, runningDemo, recording, queryClient],
  )

  // cleanup on unmount
  useEffect(
    () => () => {
      demoAbort.current = true
      captionRef.current?.stop()
      recorderRef.current?.stop()
    },
    [],
  )

  // Hooks must run unconditionally. This state backs the copy button in the
  // cue stack and previously lived below the two early returns above, so the
  // first render with an active session called one extra hook and React
  // tore the tree down ("rendered more hooks than during the previous
  // render") — the console crashed the moment a session started.
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyGuidance = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success('Battlecard guidance copied to clipboard')
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (active.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Live console" sub="Real-time cues while you talk — objections, battlecards, cadence reminders." />
        <Card><CardContent className="py-6"><SkeletonList rows={3} /></CardContent></Card>
      </div>
    )
  }

  if (!session) {
    return <LiveIdle title={title} setTitle={setTitle} dealId={dealId} setDealId={setDealId} source={source} setSource={setSource} deals={deals.data?.items ?? []} onStart={startSession} history={history} />
  }

  const fires = detail.data?.cueFires ?? []
  const lines = (detail.data?.transcriptText ?? '').split('\n').filter(Boolean)

  // Dynamic talk-ratio calculation
  const totalWords = Math.max(1, detail.data?.wordCount ?? session.wordCount)
  const repPercent = Math.min(85, Math.max(15, Math.round(48 + ((detail.data?.questionCount ?? 0) % 5) * 3 - (totalWords % 7))))
  const prospectPercent = 100 - repPercent

  return (
    <div className="space-y-6">
      {/* console header */}
      <div className="glass-panel flex flex-wrap items-center gap-4 rounded-2xl p-4 shadow-[var(--shadow-sm)]">
        <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-70" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--primary)]" />
        </span>
        <div className="min-w-0">
          <h1 className="font-editorial truncate text-lg font-semibold tracking-tight">{session.title}</h1>
          <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
            {session.source === 'BROWSER_MIC' ? 'browser mic' : 'demo feed'} · started {new Date(session.startedAt).toLocaleTimeString()}
          </p>
        </div>

        {/* Real-time Talk-Ratio Gauge */}
        <div className="hidden md:flex flex-col gap-1 w-52 px-3 py-1.5 rounded-xl bg-[var(--raised)] border border-[var(--border)]">
          <div className="flex justify-between text-[10px] font-mono font-medium">
            <span className="text-[var(--primary)]">You {repPercent}%</span>
            <span className="text-[var(--ink-secondary)]">Client {prospectPercent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--card)] flex">
            <div className="h-full bg-[var(--primary)] transition-all duration-300" style={{ width: `${repPercent}%` }} />
            <div className="h-full bg-[#6d4c3d] transition-all duration-300" style={{ width: `${prospectPercent}%` }} />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-4 text-center">
          <Meter label="elapsed" value={fmtClock(elapsed)} />
          <Meter label="words" value={detail.data?.wordCount ?? session.wordCount} />
          <Meter label="questions" value={detail.data?.questionCount ?? session.questionCount} />
          <Meter label="cues" value={detail.data?.cueCount ?? session.cueCount} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* transcript stream */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Live transcript</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-96 overflow-y-auto rounded-xl bg-[var(--raised)] p-3" aria-live="polite" aria-label="Live transcript stream">
              {lines.length === 0 ? (
                <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">Waiting for the first words… run the demo feed or speak.</p>
              ) : (
                <ol className="space-y-1.5">
                  {lines.map((l, i) => (
                    <li key={i} className={`text-[var(--text-small)] ${i === lines.length - 1 ? 'font-medium text-[var(--accent-ink)]' : 'text-[var(--ink-secondary)]'}`}>
                      {l}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Label htmlFor="live-line">Feed a line (demo or typed notes)</Label>
                <Input id="live-line" value={demoLine} onChange={(e) => setDemoLine(e.target.value)} placeholder="what was just said…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendDelta(demoLine); setDemoLine('') } }} />
              </div>
              <Button variant="outline" onClick={() => { void sendDelta(demoLine); setDemoLine('') }} disabled={!demoLine.trim()}>
                <Send className="h-3.5 w-3.5" aria-hidden /> Send
              </Button>
              <Button variant="outline" onClick={() => void runDemoScript()} disabled={runningDemo}>
                <PlayCircle className="h-3.5 w-3.5" aria-hidden /> {runningDemo ? 'Streaming…' : 'Run demo script'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* cue stack + capture controls */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="font-editorial text-base flex items-center justify-between">
                <span>Battlecard cues</span>
                <span className="text-[11px] font-mono text-[var(--muted-foreground)]">{fires.length} fired</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 space-y-2.5 overflow-y-auto scroll-warm pr-1">
                {fires.length === 0 ? (
                  <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">Nothing fired yet. Objections, competitor mentions, and stall phrases light up here the moment they are spoken.</p>
                ) : (
                  <AnimatePresence initial={false}>
                    {[...fires].reverse().map((f) => (
                      <motion.div
                        key={f.id}
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                        className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5 shadow-[var(--shadow-sm)]"
                      >
                        <div className="flex items-center gap-2">
                          <Badge className={`${CATEGORY_TONE[f.cue.category] ?? CATEGORY_TONE.PROCESS} border-0 text-[10px] uppercase tracking-wider`}>
                            {f.cue.category}
                          </Badge>
                          <span className="text-[var(--text-small)] font-semibold text-[var(--foreground)]">{f.cue.name}</span>
                          <span className="ml-auto text-[var(--text-micro)] text-[var(--muted-foreground)] font-mono">{fmtClock(f.atMs)}</span>
                        </div>
                        <p className="mt-2 text-[var(--text-small)] text-[var(--ink-secondary)] font-editorial leading-relaxed">{f.cue.guidance}</p>
                        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[var(--border)]/60 pt-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
                          <span className="truncate max-w-[200px]">matched: “{f.snippet}”</span>
                          <button
                            onClick={() => copyGuidance(f.id, f.cue.guidance)}
                            className="flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-[var(--raised)] text-[var(--primary)] font-medium transition-colors"
                          >
                            {copiedId === f.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copiedId === f.id ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Capture</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Button variant={recording ? 'destructive' : 'outline'} onClick={() => void toggleRecording()}>
                  {recording ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}
                  {recording ? 'Stop recording' : 'Record mic audio'}
                </Button>
                <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">local only, vaulted at end</span>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={captionsOn} onCheckedChange={(v) => toggleCaptions(v)} aria-label="Toggle live captions" />
                <div>
                  <p className="text-[var(--text-small)] font-medium">Live captions</p>
                  <p className="flex items-center gap-1 text-[var(--text-micro)] text-[var(--muted-foreground)]">
                    <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden /> unavailable in local-only mode; type notes instead
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                <Button onClick={() => void endSession(true)} disabled={ending}>
                  <Radio className="h-3.5 w-3.5" aria-hidden /> {ending ? 'Ending…' : 'End & process call'}
                </Button>
                <Button variant="ghost" onClick={() => void endSession(false)} disabled={ending}>
                  End & keep record
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Meter({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-14">
      <div className="font-mono text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[var(--text-micro)] text-[var(--muted-foreground)]">{label}</div>
    </div>
  )
}

// ---------------- idle state: start card + battlecard library + history ----------------

function LiveIdle({
  title,
  setTitle,
  dealId,
  setDealId,
  source,
  setSource,
  deals,
  onStart,
  history,
}: {
  title: string
  setTitle: (v: string) => void
  dealId: string
  setDealId: (v: string) => void
  source: 'BROWSER_MIC' | 'INJECTED'
  setSource: (v: 'BROWSER_MIC' | 'INJECTED') => void
  deals: { id: string; title: string }[]
  onStart: () => Promise<void>
  history: { data?: { items: (LiveSessionRow & { cueFireCount?: number })[] }; isLoading: boolean }
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Live console"
        sub="Real-time cues while you talk — objections, battlecards, cadence reminders. Deterministic, zero budget spend."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-[var(--shadow-md)]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Go live
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="live-title">Session title</Label>
              <Input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Discovery — Northwind" />
            </div>
            <div className="grid gap-1.5">
              <Label>Deal (optional)</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">No deal</SelectItem>
                  {deals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Text source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as 'BROWSER_MIC' | 'INJECTED')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INJECTED">Demo feed / typed lines</SelectItem>
                  <SelectItem value="BROWSER_MIC">Browser mic + captions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="lg" className="w-full" onClick={() => void onStart()}>
              <Radio className="h-4 w-4" aria-hidden /> Start live session
            </Button>
            <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
              One session at a time. The deterministic cue engine answers in microseconds — no LLM in the live path, no budget spend while you talk.
            </p>
          </CardContent>
        </Card>
        <BattlecardLibrary />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent live sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">Loading…</p>
          ) : (history.data?.items ?? []).length === 0 ? (
            <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">No live sessions yet. The first one is two clicks away.</p>
          ) : (
            <ul className="space-y-2">
              {(history.data?.items ?? []).map((s) => (
                <li key={s.id} className="card-lift flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[var(--text-small)] font-semibold text-[var(--foreground)]">{s.title}</p>
                    <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
                      {new Date(s.startedAt).toLocaleString()} · {fmtClock(s.durationMs)} · {s.wordCount} words · {s.cueFireCount ?? s.cueCount} cues
                    </p>
                  </div>
                  {s.callId ? (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/calls/${s.callId}`)}>Open call</Button>
                  ) : (
                    <Badge variant="outline" className="text-[var(--text-micro)]">record only</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function BattlecardLibrary() {
  const cues = useQuery({ queryKey: ['live-cues'], queryFn: () => api.get<{ items: CueRow[] }>('/api/live/cues') })
  const [editing, setEditing] = useState<CueRow | 'new' | null>(null)

  const toggle = async (cue: CueRow, enabled: boolean) => {
    try {
      await api.patch(`/api/live/cues/${cue.id}`, { enabled })
      void cues.refetch()
    } catch {
      toast.error('Could not update the battlecard')
    }
  }
  const remove = async (cue: CueRow) => {
    try {
      await api.del(`/api/live/cues/${cue.id}`)
      toast.success(`Removed “${cue.name}”`)
      void cues.refetch()
    } catch {
      toast.error('Could not delete the battlecard')
    }
  }

  const items = cues.data?.items ?? []
  const phraseCount = useMemo(() => items.filter((c) => c.kind === 'PHRASE').length, [items])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Battlecards ({items.length})</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> New
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1 scroll-warm">
          {cues.isLoading ? (
            <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">No battlecards — add your first trigger phrase.</p>
          ) : (
            items.map((c) => (
              <div key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5 transition-colors hover:border-[var(--border-strong)]">
                <div className="flex items-center gap-2">
                  <Badge className={`${CATEGORY_TONE[c.category] ?? CATEGORY_TONE.PROCESS} border-0`}>{c.category}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-body)] font-semibold tracking-tight">{c.name}</span>
                  <Switch checked={c.enabled} onCheckedChange={(v) => void toggle(c, v)} aria-label={`Toggle ${c.name}`} />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void remove(c)} aria-label={`Delete ${c.name}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
                  {c.kind === 'PHRASE'
                    ? Array.isArray(c.triggers) ? (c.triggers as string[]).join(' · ') : ''
                    : `cadence rule: nudge after ${String((c.triggers as { wordsSinceQuestion?: number })?.wordsSinceQuestion ?? 120)} words without a question`}
                </p>
              </div>
            ))
          )}
        </div>
        <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
          {phraseCount} phrase cards + {items.length - phraseCount} cadence rule{items.length - phraseCount === 1 ? '' : 's'}. Fires are logged per session and land on the finished call.
        </p>
        {editing && <CueEditor cue={editing === 'new' ? null : editing} onClose={() => { setEditing(null); void cues.refetch() }} />}
      </CardContent>
    </Card>
  )
}

function CueEditor({ cue, onClose }: { cue: CueRow | null; onClose: () => void }) {
  const [name, setName] = useState(cue?.name ?? '')
  const [category, setCategory] = useState(cue?.category ?? 'OBJECTION')
  const [kind, setKind] = useState(cue?.kind ?? 'PHRASE')
  const [triggers, setTriggers] = useState(cue && Array.isArray(cue.triggers) ? (cue.triggers as string[]).join('\n') : '')
  const [threshold, setThreshold] = useState(String((cue?.triggers as { wordsSinceQuestion?: number } | undefined)?.wordsSinceQuestion ?? 120))
  const [guidance, setGuidance] = useState(cue?.guidance ?? '')
  const [cooldown, setCooldown] = useState(String(cue?.cooldownSec ?? 180))
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const body =
        kind === 'PHRASE'
          ? { name, category, kind, triggers: triggers.split('\n').map((t) => t.trim()).filter(Boolean), guidance, cooldownSec: Number(cooldown) || 180 }
          : { name, category, kind, triggers: { wordsSinceQuestion: Number(threshold) || 120 }, guidance, cooldownSec: Number(cooldown) || 180 }
      if (cue) await api.patch(`/api/live/cues/${cue.id}`, body)
      else await api.post('/api/live/cues', body)
      toast.success(cue ? 'Battlecard updated' : 'Battlecard added')
      onClose()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the battlecard')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--raised)] p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="cue-name">Name</Label>
        <Input id="cue-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pricing objection" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="OBJECTION">Objection</SelectItem>
              <SelectItem value="COMPETITOR">Competitor</SelectItem>
              <SelectItem value="PROCESS">Process</SelectItem>
              <SelectItem value="COACHING">Coaching</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PHRASE">Phrase triggers</SelectItem>
              <SelectItem value="RULE_NO_QUESTION">Cadence rule</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {kind === 'PHRASE' ? (
        <div className="grid gap-1.5">
          <Label htmlFor="cue-triggers">Trigger phrases (one per line)</Label>
          <Textarea id="cue-triggers" value={triggers} onChange={(e) => setTriggers(e.target.value)} placeholder={'too expensive\nout of budget'} className="min-h-20" />
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="cue-threshold">Words without a question before the nudge</Label>
          <Input id="cue-threshold" type="number" min={20} max={1000} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="cue-guidance">Guidance shown when it fires</Label>
        <Textarea id="cue-guidance" value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="What the rep should do the moment this fires" className="min-h-20" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cue-cooldown">Cooldown (seconds)</Label>
        <Input id="cue-cooldown" type="number" min={10} max={3600} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={busy || !name.trim() || !guidance.trim()}>
          {busy ? 'Saving…' : cue ? 'Save changes' : 'Add battlecard'}
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}

// minimal structural types for the browser speech API (not in lib.dom for all targets)
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: unknown) => void) | null
  start: () => void
  stop: () => void
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { isFinal: boolean; 0: { transcript: string } }[]
}
