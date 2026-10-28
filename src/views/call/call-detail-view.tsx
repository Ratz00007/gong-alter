'use client'
// AMBER — screens 4/5/6/11/14 + provenance (Table 5.4). The call detail is the
// app's center of gravity: fixed 56px header (title, deal chip, stage rail,
// actions), synchronized audio player bar with dual-speaker waveform scrubber, then tabs.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { navigate, useNavigate } from '@/lib/router'
import { EmptyState, StageRail, StatusChip, ConfidenceDots } from '@/components/amber/primitives'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Play, Pause, SkipBack, SkipForward, Copy, Check, CloudUpload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/format'
import type { CallStatus, InsightType, InsightStatus, SpeakerLabel } from '@prisma/client'

type Tab = 'overview' | 'transcript' | 'insights' | 'scorecard' | 'notes' | 'follow-up' | 'provenance'

interface CallDetail {
  id: string
  title: string
  status: CallStatus
  occurredAt: string
  durationSec?: number | null
  language?: string | null
  errorMessage?: string | null
  failedStage?: string | null
  retryCount: number
  deal?: { id: string; title: string; stage: string; account: string } | null
  contact?: { id: string; name: string; title?: string | null } | null
  summary?: { summary: string; topics: { name: string; segmentIdx: number[] }[]; nextStepSuggested?: string | null } | null
  scorecard?: { overall: number; talkRatioRep: number; questionCount: number; longestMonologueSec: number; rubricVersion: string } | null
  followUpDraft?: { id: string; status: string; subject: string } | null
  transcript?: { id: string; language: string; wordCount: number } | null
  _count?: { insights: number; notes: number; runs: number }
}

interface SegmentRow { id: string; idx: number; speaker: SpeakerLabel; startMs: number; endMs: number; text: string }
interface InsightRow {
  id: string
  type: InsightType
  title: string
  content: string
  confidence: number
  evidenceSegmentIds: string[]
  status: InsightStatus
}
interface RunRow {
  id: string
  taskId: string
  provider: string
  model: string
  status: string
  attempt: number
  costUsd: number
  latencyMs?: number | null
  errorCode?: string | null
  error?: string | null
  fallbackFrom?: { provider: string; model: string; errorCode?: string | null } | null
  budgetEntry?: { amountUsd: number } | null
}
interface NoteRow { id: string; body: string; pinned: boolean; origin: string; updatedAt: string }
interface DraftRow {
  id: string
  subject: string
  body: string
  tone: string
  channel: 'EMAIL' | 'LINKEDIN' | 'OTHER'
  status: 'DRAFT' | 'EDITED' | 'COPIED' | 'SENT' | 'DISCARDED'
  sentAt?: string | null
}

interface ScorecardResponse {
  scorecard: {
    overall: number
    rubricVersion: string
    dimensions: { dims?: { key: string; score: number; comment: string; evidenceSegmentIds: string[] }[] }
  }
  topQuartileMeans: Record<string, number>
  topQuartileSize: number
}

interface TranscriptResponse {
  transcript: { fullText: string; wordCount: number; language: string; segments: SegmentRow[] }
}

const INSIGHT_TABS: Record<InsightType, string> = {
  MEDDIC_M: 'Metrics', MEDDIC_E: 'Economic buyer', MEDDIC_D_CRITERIA: 'Decision criteria', MEDDIC_D_PROCESS: 'Decision process',
  MEDDIC_I: 'Identify pain', MEDDIC_C: 'Champion', RISK_FLAG: 'Risk flag', OBJECTION: 'Objection', BUYING_SIGNAL: 'Buying signal',
  COMPETITOR: 'Competitor', PRICING_SIGNAL: 'Pricing', TIMELINE_SIGNAL: 'Timeline', NEXT_STEP: 'Next step', TOPIC: 'Topic',
}

function fmtDur(sec: number): string {
  if (!sec || isNaN(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${String(rem).padStart(2, '0')}`
}

export function CallDetailView({ id, tab, onTab }: { id: string; tab: Tab; onTab: (t: Tab) => void }) {
  const qc = useQueryClient()
  const callsRev = useAmber((s) => s.callsRev)
  const bump = useAmber((s) => s.bump)

  const [focusSegment, setFocusSegment] = useState<number | null>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const call = useQuery({
    queryKey: ['call', id, callsRev],
    queryFn: () => api.get<{ call: CallDetail }>(`/api/calls/${id}`),
    refetchInterval: (query) => {
      const s = query.state.data?.call.status
      return s && ['UPLOADED', 'NORMALIZING', 'TRANSCRIBING', 'ANALYZING', 'INDEXING'].includes(s) ? 3000 : false
    },
  })

  const transcriptQuery = useQuery({
    queryKey: ['call-transcript', id],
    queryFn: () => api.get<TranscriptResponse>(`/api/calls/${id}/transcript`),
  })

  const segments = transcriptQuery.data?.transcript.segments ?? []

  const retry = useMutation({
    mutationFn: () => api.post<{ call: CallDetail }>(`/api/calls/${id}/retry`),
    onSuccess: () => { toast.success('Retrying from the failed stage'); bump('calls'); qc.invalidateQueries({ queryKey: ['call', id] }) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Retry failed'),
  })
  const reanalyze = useMutation({
    mutationFn: () => api.post<{ call: CallDetail }>(`/api/calls/${id}/reanalyze`),
    onSuccess: () => { toast.success('Re-analyzing — prior insights superseded, not deleted'); bump('calls') },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Reanalyze rejected'),
  })
  const cancel = useMutation({
    mutationFn: () => api.post(`/api/calls/${id}/cancel`),
    onSuccess: () => { toast.info('Call canceled — artifacts kept'); bump('calls') },
  })
  const crmPush = useMutation({
    mutationFn: (crm: 'HUBSPOT' | 'SALESFORCE' | 'PIPEDRIVE') =>
      api.post<{ ok: boolean; externalNoteId: string; message: string }>(`/api/calls/${id}/crm-push`, { crm }),
    onSuccess: (res, crm) => {
      toast.success(`Pushed to ${crm}`, { description: res.message })
      bump('deals')
      if (call.data?.call.deal?.id) {
        qc.invalidateQueries({ queryKey: ['deal', call.data.call.deal.id] })
        qc.invalidateQueries({ queryKey: ['deal-timeline', call.data.call.deal.id] })
      }
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'CRM Push failed'),
  })

  if (call.isLoading) return <EmptyState title="Loading call…" />
  if (call.isError || !call.data) return <EmptyState title="Call not found" hint="It may have been deleted." action={<Button onClick={() => navigate('/inbox')}>Back to inbox</Button>} />

  const c = call.data.call
  const busy = ['UPLOADED', 'NORMALIZING', 'TRANSCRIBING', 'ANALYZING', 'INDEXING'].includes(c.status)

  // Determine total playback duration (prefer HTMLAudio metadata duration, fallback to call or segments)
  const maxSegSec = segments.length > 0 ? Math.max(...segments.map((s) => s.endMs)) / 1000 : 0
  const effectiveDuration = audioDuration > 0 ? audioDuration : (c.durationSec && c.durationSec > 0 ? c.durationSec : (maxSegSec > 0 ? maxSegSec : 30))

  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const isDraggingScrubberRef = useRef(false)

  const seekTo = (sec: number, autoPlay = true) => {
    const clamped = Math.max(0, Math.min(sec, effectiveDuration))
    if (audioRef.current) {
      audioRef.current.currentTime = clamped
      if (autoPlay) {
        audioRef.current.play().catch(() => {})
        setIsPlaying(true)
      }
    }
    setCurrentTime(clamped)
  }

  const jumpTurn = (dir: 1 | -1) => {
    if (segments.length === 0) return
    const curMs = currentTime * 1000
    const currentIdx = segments.findIndex((s) => curMs >= s.startMs && curMs <= s.endMs)
    if (currentIdx === -1) {
      if (dir === 1 && segments[0]) seekTo(segments[0].startMs / 1000)
      return
    }
    const currentSpeaker = segments[currentIdx]?.speaker
    let target = currentIdx + dir
    while (target >= 0 && target < segments.length) {
      if (segments[target]?.speaker !== currentSpeaker) {
        seekTo((segments[target]?.startMs ?? 0) / 1000)
        return
      }
      target += dir
    }
  }

  const scrollToIdx = (segIdx: number, andPlay = true) => {
    setFocusSegment(segIdx)
    onTab('transcript')
    const seg = segments.find((s) => s.idx === segIdx)
    if (seg) {
      seekTo(seg.startMs / 1000, andPlay)
    }
  }

  const [copiedCrm, setCopiedCrm] = useState(false)
  const copyCrmSummary = () => {
    const summaryText = [
      `# ${c.title} — VALENCE Revenue Intelligence Brief`,
      `- **Date**: ${new Date(c.occurredAt).toLocaleString()}`,
      `- **Account / Deal**: ${c.deal?.account ? `${c.deal.account} (${c.deal.title})` : (c.deal?.title ?? 'Unassigned')}`,
      `- **Duration**: ${c.durationSec ? `${Math.round(c.durationSec / 60)} min` : 'N/A'}`,
      `- **Scorecard**: ${c.scorecard?.overall ? `${c.scorecard.overall}/100` : 'Pending'}${c.scorecard?.talkRatioRep ? ` (Talk Ratio: ${Math.round(c.scorecard.talkRatioRep * 100)}% Rep)` : ''}`,
      '',
      '## Executive Summary',
      c.summary?.summary ?? 'No executive summary generated yet.',
      '',
      '## Next Steps & Commitments',
      c.summary?.nextStepSuggested ? `- ${c.summary.nextStepSuggested}` : '- None recorded.',
    ].join('\n')

    navigator.clipboard.writeText(summaryText).then(() => {
      setCopiedCrm(true)
      toast.success('Executive CRM brief copied to clipboard', {
        description: 'Formatted in Markdown ready for Salesforce, HubSpot, or Slack.',
      })
      setTimeout(() => setCopiedCrm(false), 2500)
    }).catch(() => {
      toast.error('Could not copy to clipboard')
    })
  }

  // 60fps playhead smoothing when playing
  useEffect(() => {
    if (!isPlaying) return
    let rafId: number
    const tick = () => {
      if (audioRef.current && !isDraggingScrubberRef.current) {
        setCurrentTime(audioRef.current.currentTime)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying])

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play().catch(() => {})
      setIsPlaying(true)
    }
  }

  // Keyboard navigation: [ (prev turn), ] (next turn), Space (play/pause), Left/Right (±5s)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === '[') {
        e.preventDefault()
        jumpTurn(-1)
      } else if (e.key === ']') {
        e.preventDefault()
        jumpTurn(1)
      } else if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekTo(currentTime - 5, isPlaying)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekTo(currentTime + 5, isPlaying)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentTime, effectiveDuration, segments, isPlaying])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingScrubberRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seekTo(pct * effectiveDuration, isPlaying)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverTime(pct * effectiveDuration)
    if (isDraggingScrubberRef.current) {
      seekTo(pct * effectiveDuration, false)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingScrubberRef.current) {
      isDraggingScrubberRef.current = false
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    }
  }

  return (
    <div className="space-y-4">
      {/* Hidden audio element streaming from /api/calls/[id]/media with Range support */}
      <audio
        ref={audioRef}
        src={`/api/calls/${c.id}/media`}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (d && !isNaN(d) && isFinite(d) && d > 0) {
            setAudioDuration(d)
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime
          setCurrentTime(t)
          const curMs = t * 1000
          const matched = segments.find((s) => curMs >= s.startMs && curMs <= s.endMs)
          setActiveIdx(matched ? matched.idx : null)
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false)
          setActiveIdx(null)
        }}
      />

      <header className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-3 shadow-[var(--shadow-sm)]">
        <div className="min-w-0">
          <h1 className="truncate text-[length:var(--text-title)] font-semibold leading-tight tracking-tight">{c.title}</h1>
          <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
            {new Date(c.occurredAt).toLocaleString()}
            {c.durationSec ? ` · ${Math.round(c.durationSec / 60)} min` : ''}
            {c.language ? ` · ${c.language}` : ''} · {c.deal ? <button className="underline decoration-dotted" onClick={() => navigate(`/deals/${c.deal?.id ?? ''}`)}>{c.deal.title}</button> : 'No deal'}
            {c.contact ? ` · ${c.contact.name}` : ''}
          </p>
        </div>
        <StatusChip status={c.status} />
        <StageRail status={c.status} failedStage={c.failedStage} />
        <div className="ml-auto flex flex-wrap gap-2">
          {c.status === 'FAILED' && <Button size="sm" variant="outline" onClick={() => retry.mutate()}>Retry{c.retryCount ? ` (${c.retryCount}/3)` : ''}</Button>}
          {['READY', 'REVIEWED'].includes(c.status) && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={crmPush.isPending}
                onClick={() => crmPush.mutate('HUBSPOT')}
                className="gap-1.5 border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10"
                title="Direct 1-click push of MEDDIC scorecard, summary, and action items to CRM"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                <span>{crmPush.isPending ? 'Pushing…' : 'Push to CRM'}</span>
              </Button>
              <Button size="sm" variant="outline" onClick={copyCrmSummary} className="gap-1.5 border-[var(--border-strong)]">
                {copiedCrm ? <Check className="h-3.5 w-3.5 text-[var(--positive)]" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedCrm ? 'Copied' : 'Export CRM'}</span>
              </Button>
            </>
          )}
          {(c.status === 'READY' || c.status === 'REVIEWED') && (
            <Button size="sm" variant="outline" onClick={() => reanalyze.mutate()}>Re-analyze</Button>
          )}
          {busy && <Button size="sm" variant="outline" onClick={() => cancel.mutate()}>Cancel</Button>}
        </div>
      </header>

      {/* Synchronized Audio & Dual-Speaker Waveform Player Bar */}
      <section
        aria-label="Audio player and waveform scrubber"
        className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center sm:gap-5"
      >
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
            className="h-10 w-10 shrink-0 rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 shadow-[var(--shadow-sm)] flex items-center justify-center p-0"
          >
            {isPlaying ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 ml-0.5" fill="currentColor" />}
          </Button>

          <div className="flex flex-col">
            <span className="font-mono text-[var(--text-small)] font-semibold tabular-nums text-[var(--foreground)]">
              {fmtDur(currentTime)} <span className="text-[var(--muted-foreground)] font-normal text-[var(--text-micro)]">/ {fmtDur(effectiveDuration)}</span>
            </span>
            <div className="flex items-center gap-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#d76932' }} /> You
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#58463d' }} /> Prospect
              </span>
            </div>
          </div>
        </div>

        {/* Speaker Turn Skip Controls */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => jumpTurn(-1)}
            title="Previous speaker turn ([)"
            className="h-8 w-8 p-0 rounded-lg hover:text-[var(--primary)]"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => jumpTurn(1)}
            title="Next speaker turn (])"
            className="h-8 w-8 p-0 rounded-lg hover:text-[var(--primary)]"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* 72-bar Dual-Speaker Continuous Waveform Scrubber with Hover Time */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek waveform"
          aria-valuemin={0}
          aria-valuemax={Math.round(effectiveDuration)}
          aria-valuenow={Math.round(currentTime)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => setHoverTime(null)}
          className="group relative flex h-11 flex-1 cursor-pointer items-center justify-between gap-[2px] rounded-xl bg-[var(--raised)] px-2.5 transition-all hover:bg-[var(--accent-soft)]/25 select-none"
        >
          {hoverTime !== null && (
            <div
              className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md bg-[var(--card-solid)] border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-mono font-semibold shadow-[var(--shadow-sm)] text-[var(--primary)] z-10"
              style={{ left: `${Math.max(16, Math.min(100 * (hoverTime / effectiveDuration), 96))}%` }}
            >
              {formatDuration(hoverTime)}
            </div>
          )}

          {Array.from({ length: 72 }, (_, i) => {
            const barFraction = (i + 0.5) / 72
            const barMidMs = barFraction * effectiveDuration * 1000
            const activeSeg = segments.find((s) => barMidMs >= s.startMs && barMidMs <= s.endMs)

            // Claude terracotta (#d97757) for rep; warm umber (#6d4c3d) for prospect
            let barColor = 'var(--border-strong)'
            let isSpeech = false
            if (activeSeg) {
              isSpeech = true
              const isRep = activeSeg.speaker === 'SPEAKER_00' || activeSeg.speaker === 'REP'
              barColor = isRep ? '#d97757' : '#6d4c3d'
            }

            const waveAmp = 0.35 + 0.65 * Math.abs(Math.sin((i * 13 + 7) * 0.45) * Math.cos(i * 0.28))
            const barHeight = isSpeech ? Math.round(10 + waveAmp * 22) : 5

            const barStartSec = (i / 72) * effectiveDuration
            const isPlayed = barStartSec <= currentTime

            return (
              <span
                key={i}
                style={{
                  height: `${barHeight}px`,
                  backgroundColor: barColor,
                  opacity: isPlayed ? 1.0 : 0.32,
                }}
                className="w-full min-w-[2px] rounded-full transition-all duration-75 group-hover:brightness-110"
              />
            )
          })}
        </div>

        {/* 1-Click Playback Speed Pills */}
        <div className="flex items-center gap-0.5 rounded-xl bg-[var(--raised)] p-0.5 border border-[var(--border)] shrink-0">
          {[1, 1.25, 1.5, 2].map((s) => (
            <button
              key={s}
              onClick={() => {
                setPlaybackSpeed(s)
                if (audioRef.current) audioRef.current.playbackRate = s
              }}
              className={cn(
                'px-2 py-0.5 text-[11px] font-mono rounded-lg transition-colors',
                playbackSpeed === s
                  ? 'bg-[var(--card)] font-semibold text-[var(--primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      </section>

      {c.status === 'FAILED' && c.errorMessage && (
        <Card className="border-[color:var(--danger)]/40 bg-[color:var(--danger)]/5">
          <CardContent className="py-4 text-[var(--text-small)] text-[var(--danger)]">
            {c.errorMessage}
            <span className="ml-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
              failed stage: {c.failedStage ?? 'unknown'} · audio retained · retry re-enters the failed stage
            </span>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="insights">Insights{c._count?.insights ? ` · ${c._count.insights}` : ''}</TabsTrigger>
          <TabsTrigger value="scorecard" disabled={!c.scorecard}>Scorecard</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="follow-up" disabled={!c.followUpDraft}>Follow-up</TabsTrigger>
          <TabsTrigger value="provenance">Provenance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab call={c} segments={segments} onEvidence={scrollToIdx} />
        </TabsContent>
        <TabsContent value="transcript">
          <TranscriptTab
            callId={id}
            focusSegment={focusSegment}
            activeIdx={activeIdx}
            onFocused={() => setFocusSegment(null)}
            onSeek={(sec) => seekTo(sec, true)}
          />
        </TabsContent>
        <TabsContent value="insights"><InsightsTab callId={id} onEvidence={scrollToIdx} /></TabsContent>
        <TabsContent value="scorecard"><ScorecardTab callId={id} onEvidence={scrollToIdx} /></TabsContent>
        <TabsContent value="notes"><NotesTab callId={id} /></TabsContent>
        <TabsContent value="follow-up">{c.followUpDraft ? <FollowUpTab callId={id} /> : null}</TabsContent>
        <TabsContent value="provenance"><ProvenanceTab callId={id} /></TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------- Overview ----------------

function OverviewTab({
  call,
  segments,
  onEvidence,
}: {
  call: CallDetail
  segments: SegmentRow[]
  onEvidence: (idx: number) => void
}) {
  const nav = useNavigate()
  return (
    <div className="grid gap-4">
      {call.summary ? (
        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent className="reader text-[var(--text-body)] leading-relaxed">{call.summary.summary}</CardContent>
        </Card>
      ) : (
        <EmptyState title="No summary yet" hint="The summary is written by the analysis stage once the call is transcribed." />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="md:col-span-2 xl:col-span-3">
          <CardHeader><CardTitle>MEDDIC</CardTitle></CardHeader>
          <CardContent><MeddicPanel callId={call.id} segments={segments} onEvidence={onEvidence} /></CardContent>
        </Card>
      </div>

      {call.scorecard && (
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Metrics (arithmetic, never model-estimated)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Talk ratio (rep)" value={`${call.scorecard.talkRatioRep.toFixed(1)}%`} target="40-60%" ok={call.scorecard.talkRatioRep >= 40 && call.scorecard.talkRatioRep <= 60} />
            <Metric label="Questions" value={String(call.scorecard.questionCount)} target="4+ in discovery" ok={call.scorecard.questionCount >= 4} />
            <Metric label="Longest monologue" value={`${call.scorecard.longestMonologueSec}s`} target="under 120s" ok={call.scorecard.longestMonologueSec <= 120} />
            <Metric label="Scorecard" value={`${call.scorecard.overall}/100`} target="rubric v1" ok={call.scorecard.overall >= 70} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Notes</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => nav(`/calls/${call.id}?tab=notes`)}>Open →</Button>
          </CardHeader>
          <CardContent className="text-[var(--text-small)] text-[var(--ink-secondary)]">
            Drafted decisions, open questions, and action items live here; editing makes them yours.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Follow-up draft</CardTitle>
            {call.followUpDraft && <Button variant="ghost" size="sm" onClick={() => nav(`/calls/${call.id}?tab=follow-up`)}>Open →</Button>}
          </CardHeader>
          <CardContent className="text-[var(--text-small)] text-[var(--ink-secondary)]">
            {call.followUpDraft ? `Subject: “${call.followUpDraft.subject}” · status ${call.followUpDraft.status}` : 'Drafted with the call; edit, copy, mark SENT.'}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value, target, ok }: { label: string; value: string; target: string; ok: boolean }) {
  return (
    <div className="rounded-xl bg-[var(--raised)] px-4 py-3">
      <div className="text-[var(--text-micro)] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${ok ? 'text-[var(--positive)]' : 'text-[var(--warning)]'}`}>{value}</div>
      <div className="text-[var(--text-micro)] text-[var(--muted-foreground)]">target {target}</div>
    </div>
  )
}

function MeddicPanel({
  callId,
  segments,
  onEvidence,
}: {
  callId: string
  segments: SegmentRow[]
  onEvidence: (idx: number) => void
}) {
  const insights = useQuery({
    queryKey: ['call-insights-meddic', callId],
    queryFn: () => api.get<{ items: InsightRow[] }>(`/api/calls/${callId}/insights?type=MEDDIC_M,MEDDIC_E,MEDDIC_D_CRITERIA,MEDDIC_D_PROCESS,MEDDIC_I,MEDDIC_C`),
  })
  const rows = insights.data?.items ?? []
  const byKey = new Map(rows.map((r) => [r.type, r]))
  const cards: { key: InsightType; letter: string }[] = [
    { key: 'MEDDIC_M', letter: 'M' }, { key: 'MEDDIC_E', letter: 'E' }, { key: 'MEDDIC_D_CRITERIA', letter: 'D' },
    { key: 'MEDDIC_D_PROCESS', letter: 'D' }, { key: 'MEDDIC_I', letter: 'I' }, { key: 'MEDDIC_C', letter: 'C' },
  ]

  // Resolve segment index by matching evidence IDs, snippet text, or fallback
  const matchSegmentIdx = (evidenceIds: string[], content: string): number => {
    if (segments.length === 0) return 0
    // 1. Try matching by segment id or index string
    for (const evId of evidenceIds) {
      const hit = segments.find((s) => s.id === evId || String(s.idx) === String(evId))
      if (hit) return hit.idx
    }
    // 2. Fallback: match by segment text containing words from the insight content
    const snippet = content.replace(/^weak signal\s*—\s*/i, '').trim().toLowerCase()
    if (snippet.length > 3) {
      const words = snippet.split(/\s+/).filter((w) => w.length > 3)
      if (words.length > 0) {
        const textMatch = segments.find((s) => {
          const segText = s.text.toLowerCase()
          return words.some((w) => segText.includes(w))
        })
        if (textMatch) return textMatch.idx
      }
    }
    return segments[0]?.idx ?? 0
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ key, letter }) => {
        const r = byKey.get(key)
        const weak = r ? r.confidence < 0.5 : false
        return (
          <div key={key} className={`rounded-xl border bg-[var(--card)] p-4 ${weak ? 'weak-signal border-[var(--border-strong)]' : 'border-[var(--border)]'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-small)] font-semibold">{letter} · {INSIGHT_TABS[key]}</span>
              {r && <ConfidenceDots confidence={r.confidence} />}
            </div>
            <p className="mt-2 text-[var(--text-small)] leading-relaxed text-[var(--ink-secondary)]">
              {r ? (r.confidence < 0.5 ? 'weak signal — ' : '') + (r.content || '—') : 'waiting for analysis'}
            </p>
            {r && Array.isArray(r.evidenceSegmentIds) && r.evidenceSegmentIds.length > 0 && (
              <button
                className="mt-2 text-[var(--text-micro)] text-[var(--accent-ink)] underline decoration-dotted hover:text-[var(--primary)]"
                onClick={() => {
                  const targetIdx = matchSegmentIdx(r.evidenceSegmentIds, r.content)
                  onEvidence(targetIdx)
                }}
              >
                evidence: {r.evidenceSegmentIds.length} segment(s) →
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------- Transcript reader ----------------

function TranscriptTab({
  callId,
  focusSegment,
  activeIdx,
  onFocused,
  onSeek,
}: {
  callId: string
  focusSegment: number | null
  activeIdx: number | null
  onFocused: () => void
  onSeek: (sec: number) => void
}) {
  const [find, setFind] = useState('')
  const [readerFont, setReaderFont] = useState(true)
  const [autoFollow, setAutoFollow] = useState(true)
  const segRefs = useRef<Map<number, HTMLLIElement>>(new Map())

  const transcript = useQuery({
    queryKey: ['call-transcript', callId],
    queryFn: () => api.get<TranscriptResponse>(`/api/calls/${callId}/transcript`),
  })

  useEffect(() => {
    if (focusSegment === null) return
    const el = segRefs.current.get(focusSegment)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('evidence-flash')
      setTimeout(() => el.classList.remove('evidence-flash'), 1700)
    }
    onFocused()
  }, [focusSegment, onFocused])

  // Auto-follow active playback segment
  useEffect(() => {
    if (!autoFollow || activeIdx === null) return
    const el = segRefs.current.get(activeIdx)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeIdx, autoFollow])

  if (transcript.isLoading) return <EmptyState title="Loading transcript…" />
  if (transcript.isError || !transcript.data) {
    return <EmptyState title="No transcript yet" hint="The reader appears once transcription completes. Mostly-silent audio fails honestly as TRANSCRIBE_EMPTY." />
  }

  const segs = transcript.data.transcript.segments
  const needle = find.trim().toLowerCase()
  const matches = needle ? segs.filter((s) => s.text.toLowerCase().includes(needle)) : []

  return (
    <Card className="glass-panel">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle className="font-editorial text-[length:var(--text-title)]">Transcript reader</CardTitle>
        <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
          {transcript.data.transcript.wordCount} words · {transcript.data.transcript.language} · {segs.length} segments
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={autoFollow ? 'secondary' : 'ghost'}
            onClick={() => setAutoFollow(!autoFollow)}
            className="h-8 text-[11px] rounded-lg"
            title="Auto-scroll with playback"
          >
            Auto-follow: {autoFollow ? 'On' : 'Off'}
          </Button>
          <Input aria-label="Find in call" className="w-44 h-8 text-[12px] rounded-lg" placeholder="Find in call (/)" value={find} onChange={(e) => setFind(e.target.value)} />
          <Button size="sm" variant="ghost" onClick={() => setReaderFont(!readerFont)} className="h-8 text-[11px] rounded-lg" title="Font toggle">
            {readerFont ? 'Serif' : 'Sans'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {needle && (
          <p className="mb-3 text-[var(--text-micro)] text-[var(--muted-foreground)]" role="status">
            {matches.length} match(es) for “{find}”
          </p>
        )}
        <ol className={`space-y-2 ${readerFont ? 'reader' : 'reader-dyslexia'} max-h-[65vh] overflow-y-auto scroll-warm pr-2`}>
          {segs.map((s) => {
            const hit = needle && s.text.toLowerCase().includes(needle)
            const isActive = activeIdx === s.idx
            return (
              <li
                key={s.id}
                ref={(el) => { if (el) segRefs.current.set(s.idx, el) }}
                className={`flex gap-3 rounded-xl px-3 py-2 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] font-medium shadow-sm'
                    : hit
                      ? 'bg-[var(--accent-soft)]/60'
                      : 'hover:bg-[var(--raised)]'
                }`}
                onClick={() => onSeek(s.startMs / 1000)}
              >
                <span
                  className={`mt-0.5 w-20 shrink-0 text-[var(--text-micro)] font-semibold ${
                    s.speaker === 'REP' ? 'text-[var(--accent-ink)]' : s.speaker === 'PROSPECT' ? 'text-[var(--ink-secondary)]' : 'text-[var(--muted-foreground)]'
                  }`}
                >
                  {s.speaker === 'REP' ? 'You' : s.speaker === 'PROSPECT' ? 'Prospect' : s.speaker}
                </span>
                <span
                  className="w-14 shrink-0 tabular-nums text-[var(--text-micro)] text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline"
                  title="Click to play from here"
                >
                  {Math.floor(s.startMs / 60000)}:{String(Math.floor((s.startMs % 60000) / 1000)).padStart(2, '0')}
                </span>
                <span className="text-[var(--text-body)] leading-relaxed">{s.text}</span>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

// ---------------- Insights (review queue) ----------------

function InsightsTab({ callId, onEvidence }: { callId: string; onEvidence: (idx: number) => void }) {
  const qc = useQueryClient()
  const insights = useQuery({
    queryKey: ['call-insights', callId],
    queryFn: () => api.get<{ items: InsightRow[] }>(`/api/calls/${callId}/insights`),
  })
  const [cursor, setCursor] = useState(0)

  const review = useMutation({
    mutationFn: async (payload: { id: string; status: 'CONFIRMED' | 'DISMISSED' }) => api.patch(`/api/insights/${payload.id}`, { status: payload.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['call-insights', callId] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Review failed'),
  })

  const rows = insights.data?.items ?? []
  const active = rows.filter((r) => r.status === 'ACTIVE')
  const current = active[Math.min(cursor, Math.max(0, active.length - 1))]

  const chipClass = (s: InsightStatus): string =>
    s === 'CONFIRMED'
      ? 'bg-[color:var(--positive)]/12 text-[var(--positive)]'
      : s === 'DISMISSED' || s === 'SUPERSEDED'
        ? 'bg-[var(--raised)] text-[var(--muted-foreground)]'
        : 'bg-[var(--accent-soft)] text-[var(--accent-ink)]'

  return (
    <div className="grid gap-4">
      {active.length === 0 ? (
        <EmptyState title="Review queue is clear" hint="Insights are confirmed or dismissed here; confirmed MEDDIC writes through to the deal and contacts." />
      ) : current ? (
        <Card data-call-id={callId}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>{INSIGHT_TABS[current.type] ?? current.type} · {current.title}</CardTitle>
            <span className="flex items-center gap-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
              confidence <ConfidenceDots confidence={current.confidence} /> {current.confidence.toFixed(2)}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className={`text-[var(--text-body)] leading-relaxed ${current.confidence < 0.5 ? 'italic text-[var(--ink-secondary)]' : ''}`}>
              {current.content}
            </p>
            {Array.isArray(current.evidenceSegmentIds) && current.evidenceSegmentIds.length > 0 && (
              <div className="text-[var(--text-small)]">
                Evidence: {current.evidenceSegmentIds.length} segment(s).
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => review.mutate({ id: current.id, status: 'CONFIRMED' })}>Confirm (v)</Button>
              <Button size="sm" variant="outline" onClick={() => review.mutate({ id: current.id, status: 'DISMISSED' })}>Dismiss (x)</Button>
              <Button size="sm" variant="ghost" onClick={() => setCursor((c) => (c + 1) % active.length)}>Next (j)</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>All insights on this call</CardTitle>
          {insights.data && <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">{rows.length} total · {active.length} to review</span>}
        </CardHeader>
        <CardContent className="max-h-96 overflow-y-auto scroll-warm">
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--raised)] px-3 py-2">
                <div className="min-w-0">
                  <span className="text-[var(--text-small)] font-medium">{INSIGHT_TABS[r.type] ?? r.type}: {r.title}</span>
                  <p className="truncate text-[var(--text-micro)] text-[var(--muted-foreground)]">{r.content}</p>
                </div>
                <span className={'shrink-0 rounded-full px-2 py-0.5 text-[var(--text-micro)] ' + chipClass(r.status)}>{r.status}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------- Scorecard ----------------

function ScorecardTab({ callId, onEvidence }: { callId: string; onEvidence: (idx: number) => void }) {
  const sc = useQuery({
    queryKey: ['call-scorecard', callId],
    queryFn: () => api.get<ScorecardResponse>(`/api/calls/${callId}/scorecard`),
  })
  if (sc.isLoading) return <EmptyState title="Loading scorecard…" />
  if (sc.isError || !sc.data) return <EmptyState title="No scorecard yet" hint="Scorecards are written by the analysis stage (rubric v1)." />

  const dims = sc.data.scorecard.dimensions?.dims ?? []
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-baseline gap-4 py-6">
          <span className="text-4xl font-semibold tabular-nums text-[var(--primary)]">{sc.data.scorecard.overall}</span>
          <span className="text-[var(--text-small)] text-[var(--muted-foreground)]">
            / 100 · rubric {sc.data.scorecard.rubricVersion} · weights applied in code, never in the model
          </span>
          <span className="ml-auto text-[var(--text-micro)] text-[var(--muted-foreground)]">
            compare: your top quartile (n={sc.data.topQuartileSize})
          </span>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {dims.map((d) => {
          const quartile = sc.data!.topQuartileMeans[d.key] ?? 0
          const delta = Math.round((d.score - quartile) * 10) / 10
          return (
            <Card key={d.key}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-[var(--text-small)] capitalize">{d.key.replace('_', ' ')}</CardTitle>
                <span className="text-lg font-semibold tabular-nums">{d.score}<span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">/10</span></span>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative h-2 rounded-full bg-[var(--raised)]">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--primary)]" style={{ width: `${d.score * 10}%` }} />
                  <div
                    className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded-full bg-[var(--ink-secondary)]"
                    style={{ left: `calc(${quartile * 10}% - 2px)` }}
                    title={`your top-quartile mean: ${(quartile / 10).toFixed(1)}`}
                  />
                </div>
                <p className="text-[var(--text-small)] text-[var(--ink-secondary)]">{d.comment}</p>
                <p className={`text-[var(--text-micro)] ${delta >= 0 ? 'text-[var(--positive)]' : 'text-[var(--warning)]'}`}>
                  {delta >= 0 ? '+' : ''}{Math.round(delta * 10) / 10} vs your top quartile
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ---------------- Notes ----------------

function NotesTab({ callId }: { callId: string }) {
  const qc = useQueryClient()
  const notes = useQuery({ queryKey: ['call-notes', callId], queryFn: () => api.get<{ items: NoteRow[] }>(`/api/calls/${callId}/notes`) })
  const [draft, setDraft] = useState('')

  const add = useMutation({
    mutationFn: (body: string) => api.post(`/api/calls/${callId}/notes`, { body }),
    onSuccess: () => { setDraft(''); qc.invalidateQueries({ queryKey: ['call-notes', callId] }) },
    onError: () => toast.error('Could not add note'),
  })
  const update = useMutation({
    mutationFn: (payload: { id: string; body?: string; pinned?: boolean }) => api.patch(`/api/notes/${payload.id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['call-notes', callId] }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['call-notes', callId] }),
  })

  const rows = [...(notes.data?.items ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        {rows.length === 0 ? <EmptyState title="No notes yet" hint="The analysis stage drafts notes (decisions, open questions, action items); editing makes them yours." /> : null}
        {rows.map((n) => (
          <Card key={n.id} className={n.pinned ? 'border-[var(--primary)]/40' : undefined}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-center gap-2">
                {n.origin === 'ai' && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--text-micro)] text-[var(--accent-ink)]">AI draft</span>}
                {n.pinned && <span className="rounded-full bg-[var(--raised)] px-2 py-0.5 text-[var(--text-micro)] text-[var(--ink-secondary)]">pinned</span>}
                <span className="ml-auto text-[var(--text-micro)] text-[var(--muted-foreground)]">{new Date(n.updatedAt).toLocaleString()}</span>
              </div>
              <Textarea
                defaultValue={n.body}
                onBlur={(e) => {
                  if (e.target.value !== n.body) update.mutate({ id: n.id, body: e.target.value })
                }}
                className="min-h-28 bg-transparent"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: n.id, pinned: !n.pinned })}>{n.pinned ? 'Unpin' : 'Pin'}</Button>
                <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => remove.mutate(n.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="h-fit">
        <CardHeader><CardTitle>Add a note</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Anything worth remembering that the models can't know." className="min-h-32" />
          <Button disabled={!draft.trim()} onClick={() => add.mutate(draft.trim())}>Add note</Button>
          <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">Markdown-lite: bold, lists, links.</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------- Follow-up editor ----------------

function FollowUpTab({ callId }: { callId: string }) {
  const qc = useQueryClient()
  const draft = useQuery({ queryKey: ['call-followup', callId], queryFn: () => api.get<{ draft: DraftRow }>(`/api/calls/${callId}/follow-up`) })
  const patch = useMutation({
    mutationFn: (payload: Partial<DraftRow>) => api.patch(`/api/follow-ups/${draft.data?.draft.id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['call-followup', callId] }),
  })
  const copy = useMutation({
    mutationFn: async () => {
      const d = draft.data!.draft
      await navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.body}`)
      return api.patch(`/api/follow-ups/${d.id}`, { status: 'COPIED' })
    },
    onSuccess: () => toast.success('Copied to clipboard'),
  })
  if (draft.isLoading) return <EmptyState title="Loading draft…" />
  if (!draft.data) return <EmptyState title="No follow-up draft" hint="The draft is written by the analysis stage." />
  const d = draft.data.draft
  const done = d.status === 'SENT' || d.status === 'DISCARDED'

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Follow-up · status {d.status}</CardTitle>
          <span className="text-[var(--text-micro)] text-[var(--muted-foreground)]">sending happens in your mail client by design</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="fu-subject">Subject</Label>
            <Input id="fu-subject" defaultValue={d.subject} disabled={done} onBlur={(e) => e.target.value !== d.subject && patch.mutate({ subject: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fu-body">Body</Label>
            <Textarea id="fu-body" className="reader min-h-64" defaultValue={d.body} disabled={done} onBlur={(e) => e.target.value !== d.body && patch.mutate({ body: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={d.channel} onValueChange={(v) => patch.mutate({ channel: v as DraftRow['channel'] })} disabled={done}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={d.tone} onValueChange={(v) => patch.mutate({ tone: v })} disabled={done}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warm-professional">warm-professional</SelectItem>
                <SelectItem value="direct">direct</SelectItem>
                <SelectItem value="brief">brief</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={done} onClick={() => copy.mutate()}>Copy</Button>
              <Button disabled={done || d.status === 'EDITED' ? false : done} onClick={() => patch.mutate({ status: 'SENT' })} title="marks sentAt; no mail sender in v1">Mark sent</Button>
              <Button variant="ghost" disabled={done} className="text-[var(--danger)]" onClick={() => patch.mutate({ status: 'DISCARDED' })}>Discard</Button>
            </div>
          </div>
          {d.sentAt && <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">sent {new Date(d.sentAt).toLocaleString()}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------- Provenance ----------------

function ProvenanceTab({ callId }: { callId: string }) {
  const runs = useQuery({ queryKey: ['call-runs', callId], queryFn: () => api.get<{ items: RunRow[] }>(`/api/calls/${callId}/runs`) })
  const rows = runs.data?.items ?? []
  const totalCost = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>AI provenance (FR-023)</CardTitle>
        <span className="text-[var(--text-small)] tabular-nums text-[var(--ink-secondary)]">total ${totalCost.toFixed(4)}</span>
      </CardHeader>
      <CardContent className="max-h-[65vh] overflow-y-auto scroll-warm">
        {rows.length === 0 ? (
          <EmptyState title="No runs yet" hint="Every AI attempt is logged here with model, cost, latency, and fallback chain." />
        ) : (
          <table className="w-full text-[var(--text-small)]">
            <thead className="text-[var(--text-micro)] uppercase text-[var(--muted-foreground)]">
              <tr className="text-left">
                <th className="pb-2">Task</th><th className="pb-2">Provider · model</th><th className="pb-2">Status</th>
                <th className="pb-2">Try</th><th className="pb-2">Cost</th><th className="pb-2">Latency</th><th className="pb-2">Fallback from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border)]">
                  <td className="py-2 font-medium">{r.taskId}</td>
                  <td className="py-2">{r.provider} · {r.model}</td>
                  <td className={`py-2 ${r.status === 'FAILED' ? 'text-[var(--danger)]' : r.status === 'OK' ? 'text-[var(--positive)]' : 'text-[var(--ink-secondary)]'}`}>
                    {r.status}{r.errorCode ? ` (${r.errorCode})` : ''}
                  </td>
                  <td className="py-2 tabular-nums">{r.attempt}</td>
                  <td className="py-2 tabular-nums">${(r.costUsd ?? 0).toFixed(4)}</td>
                  <td className="py-2 tabular-nums">{r.latencyMs ? `${r.latencyMs}ms` : '—'}</td>
                  <td className="py-2 text-[var(--text-micro)] text-[var(--muted-foreground)]">
                    {r.fallbackFrom ? `${r.fallbackFrom.provider}:${r.fallbackFrom.model} (${r.fallbackFrom.errorCode ?? 'failed'})` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
