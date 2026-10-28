'use client'
// VALENCE — Shared UI Primitives
// Consumes the Anthropic Terracotta + Apple Frosted Glass design system.
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, Clock, Loader2, Sun, Moon } from 'lucide-react'
import type { CallStatus } from '@prisma/client'

/** Page header: display title + muted sub + right-aligned actions. */
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="min-w-0">
        <h1 className="font-editorial text-[length:var(--text-display)] font-semibold tracking-tight text-[var(--foreground)]">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[var(--text-small)] text-[var(--muted-foreground)]">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  )
}

/** Theme Toggle: switches between Claude Biscuit Light and Obsidian Espresso Dark */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className={cn('h-8 w-8 rounded-xl bg-[var(--raised)] opacity-50', className)} />
  }

  const isDark = resolvedTheme === 'dark' || theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'group flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition-all duration-200 hover:border-[var(--primary)] hover:text-[var(--primary)] hover:shadow-[var(--shadow-sm)]',
        className,
      )}
      title={isDark ? 'Switch to Biscuit Light' : 'Switch to Obsidian Dark'}
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun className="h-4 w-4 transition-transform duration-300 group-hover:rotate-45 text-[var(--primary)]" />
      ) : (
        <Moon className="h-4 w-4 transition-transform duration-300 group-hover:-rotate-12 text-[var(--primary)]" />
      )}
    </button>
  )
}

/** Micro-caps section label */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('label-caps', className)}>{children}</div>
}

/** Count-up number for KPI cards */
export function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return
    const startedAt = performance.now()
    const dur = 550
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - startedAt) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (to - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className="tnum tabular-nums">{format ? format(display) : Math.round(display).toLocaleString()}</span>
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="glass-panel flex flex-col items-center justify-center gap-3.5 rounded-2xl border border-dashed border-[var(--border-strong)] p-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--primary)] shadow-[var(--shadow-sm)]" aria-hidden>
        {icon ?? <AlertTriangle className="h-6 w-6" />}
      </div>
      <div className="font-editorial text-[length:var(--text-title)] font-semibold text-[var(--foreground)]">{title}</div>
      {hint && <div className="max-w-md text-[var(--text-small)] leading-relaxed text-[var(--muted-foreground)]">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Skeleton block for loading states */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass-panel flex items-center justify-between gap-4 rounded-xl p-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

const STATUS_META: Record<CallStatus, { label: string; tone: string; dot: string }> = {
  UPLOADED: { label: 'Uploaded', tone: 'bg-[var(--raised)] text-[var(--ink-secondary)]', dot: 'bg-[var(--muted-foreground)]' },
  NORMALIZING: { label: 'Normalizing', tone: 'bg-[var(--accent-soft)] text-[var(--accent-ink)]', dot: 'bg-[var(--primary)]' },
  TRANSCRIBING: { label: 'Transcribing', tone: 'bg-[var(--accent-soft)] text-[var(--accent-ink)]', dot: 'bg-[var(--primary)]' },
  ANALYZING: { label: 'Analyzing', tone: 'bg-[var(--accent-soft)] text-[var(--accent-ink)]', dot: 'bg-[var(--primary)]' },
  INDEXING: { label: 'Indexing', tone: 'bg-[var(--accent-soft)] text-[var(--accent-ink)]', dot: 'bg-[var(--primary)]' },
  READY: { label: 'Ready', tone: 'bg-[color:var(--positive)]/15 text-[var(--positive)]', dot: 'bg-[var(--positive)]' },
  REVIEWED: { label: 'Reviewed', tone: 'bg-[color:var(--positive)]/15 text-[var(--positive)]', dot: 'bg-[var(--positive)]' },
  ARCHIVED: { label: 'Archived', tone: 'bg-[var(--raised)] text-[var(--muted-foreground)]', dot: 'bg-[var(--muted-foreground)]' },
  FAILED: { label: 'Failed', tone: 'bg-[color:var(--danger)]/15 text-[var(--danger)]', dot: 'bg-[var(--danger)]' },
  CANCELED: { label: 'Canceled', tone: 'bg-[var(--raised)] text-[var(--muted-foreground)]', dot: 'bg-[var(--muted-foreground)]' },
}

export function StatusChip({ status, compact }: { status: CallStatus; compact?: boolean }) {
  const m = STATUS_META[status] ?? { label: status, tone: 'bg-[var(--raised)]', dot: 'bg-[var(--muted-foreground)]' }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[var(--text-micro)] font-medium tracking-tight', m.tone)}>
      {compact ? <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} aria-hidden /> : <StageIcon status={status} />}
      {m.label}
    </span>
  )
}

function StageIcon({ status }: { status: CallStatus }) {
  if (status === 'FAILED') return <AlertTriangle className="h-3 w-3" aria-hidden />
  if (status === 'READY' || status === 'REVIEWED') return <CheckCircle2 className="h-3 w-3" aria-hidden />
  if (status === 'ARCHIVED' || status === 'CANCELED') return <Clock className="h-3 w-3" aria-hidden />
  return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
}

const STAGES: { key: CallStatus; label: string }[] = [
  { key: 'UPLOADED', label: 'In' },
  { key: 'NORMALIZING', label: 'Norm' },
  { key: 'TRANSCRIBING', label: 'STT' },
  { key: 'ANALYZING', label: 'Analyze' },
  { key: 'INDEXING', label: 'Index' },
  { key: 'READY', label: 'Ready' },
]

export function StageRail({ status, failedStage }: { status: CallStatus; failedStage?: string | null }) {
  const order = STAGES.map((s) => s.key)
  const failedAt = status === 'FAILED' ? Math.max(0, order.indexOf((failedStage ?? 'UPLOADED') as CallStatus)) : -1
  const activeIdx = order.indexOf(status)
  const doneAll = status === 'REVIEWED' || status === 'ARCHIVED'
  return (
    <div className="flex items-center gap-0" role="progressbar" aria-label={`Call stage: ${STAGES.find((s) => s.key === status)?.label ?? status}`}>
      {STAGES.map((s, i) => {
        const done = activeIdx > i || doneAll
        const active = activeIdx === i
        const failed = status === 'FAILED' && i === failedAt
        const last = i === STAGES.length - 1
        return (
          <span key={s.key} className="flex items-center">
            <span
              title={failed ? `${s.label} (failed here)` : s.label}
              className={cn(
                'h-2 w-2 rounded-full border-2 transition-colors duration-300',
                failed
                  ? 'border-[var(--danger)] bg-[var(--danger)]'
                  : done
                    ? 'border-[var(--primary)] bg-[var(--primary)]'
                    : active
                      ? 'stage-pip-active border-[var(--primary)] bg-[var(--primary)]'
                      : 'border-[var(--border-strong)] bg-transparent'
              )}
            />
            {!last && (
              <span
                className={cn('h-0.5 w-3.5 rounded-full transition-colors duration-300', done || active ? 'bg-[var(--primary)]/60' : 'bg-[var(--border)]')}
                aria-hidden
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

export function StatCard({
  label,
  value,
  sub,
  tone,
  icon,
  animate,
  onClick,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'positive' | 'warning' | 'danger'
  icon?: React.ReactNode
  animate?: boolean
  onClick?: () => void
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-[var(--positive)]'
      : tone === 'warning'
        ? 'text-[var(--warning)]'
        : tone === 'danger'
          ? 'text-[var(--danger)]'
          : 'text-[var(--foreground)]'
  const numeric = typeof value === 'number'
  return (
    <div
      onClick={onClick}
      className={cn(
        'glass-panel card-lift group rounded-2xl p-5',
        onClick && 'cursor-pointer',
      )}
    >
      <div className="flex h-8 items-center justify-between gap-2">
        <div className="text-[var(--text-micro)] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</div>
        {icon && (
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)] transition-transform duration-300 group-hover:scale-105" aria-hidden>
            {icon}
          </div>
        )}
      </div>
      <div className="tnum mt-2.5 text-[length:var(--text-display-lg)] font-bold leading-none tracking-tight">
        {numeric && animate ? (
          <span className={toneClass}>
            <AnimatedNumber value={value as number} />
          </span>
        ) : (
          <span className={toneClass}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
        )}
      </div>
      {sub && <div className="mt-2 text-[var(--text-micro)] text-[var(--muted-foreground)]/90">{sub}</div>}
    </div>
  )
}

/** Spend meter with tabular numerals and currency-neutral display */
export function SpendMeter({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0
  const tone = pct >= 90 ? 'bg-[var(--danger)]' : pct >= 70 ? 'bg-[var(--warning)]' : 'bg-[var(--primary)]'
  return (
    <div className="flex items-center gap-2.5" title={`Cloud budget: €${spent.toFixed(2)} of €${cap.toFixed(2)}`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--raised)] border border-[var(--border)]">
        <div className={cn('h-full rounded-full transition-all duration-300', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tnum text-[var(--text-micro)] tabular-nums text-[var(--ink-secondary)]">
        €{spent.toFixed(2)} / €{cap.toFixed(2)}
      </span>
    </div>
  )
}

/** Confidence indicator dots */
export function ConfidenceDots({ confidence }: { confidence: number }) {
  const level = confidence >= 0.75 ? 3 : confidence >= 0.5 ? 2 : 1
  return (
    <span className="inline-flex items-center gap-0.5" title={`confidence ${confidence.toFixed(2)}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i <= level ? 'bg-[var(--primary)]' : 'bg-[var(--border-strong)]')} />
      ))}
    </span>
  )
}
