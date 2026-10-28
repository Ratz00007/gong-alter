'use client'
// AMBER — screen 7: Pipeline board (FR-011). dnd-kit drag-to-stage with a warm
// ghost, optimistic update, rollback on error (Table 7.3 interaction rules).
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { navigate } from '@/lib/router'
import { EmptyState } from '@/components/amber/primitives'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/format'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { DealStage } from '@prisma/client'

interface BoardRow {
  id: string
  title: string
  account: string
  valueCents: number | null
  healthScore: number | null
  riskFlags: string[]
  nextStep: string | null
  calls: number
}
interface BoardPayload {
  stages: DealStage[]
  byStage: Record<string, BoardRow[]>
  parked: BoardRow[]
  total: { deals: number; valueCents: number }
}

const STAGE_COLUMNS: DealStage[] = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']

function healthTone(score: number | null): string {
  if (score === null) return 'bg-[var(--border-strong)]'
  if (score >= 66) return 'bg-[var(--positive)]'
  if (score >= 33) return 'bg-[var(--warning)]'
  return 'bg-[var(--danger)]'
}

export function BoardView() {
  const qc = useQueryClient()
  const dealsRev = useAmber((s) => s.dealsRev)
  const [dragging, setDragging] = useState<BoardRow | null>(null)
  const isDraggingRef = useRef(false)

  const board = useQuery({
    queryKey: ['board', dealsRev],
    queryFn: () => api.get<BoardPayload>('/api/pipeline'),
  })

  const move = useMutation({
    mutationFn: (payload: { id: string; stage: DealStage }) => api.patch(`/api/deals/${payload.id}`, { stage: payload.stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ['board'] })
      const prev = qc.getQueryData<BoardPayload>(['board', dealsRev])
      if (prev) {
        const next: BoardPayload = { ...prev, byStage: {} }
        for (const [k, rows] of Object.entries(prev.byStage)) {
          next.byStage[k] = rows.filter((r) => r.id !== id)
        }
        const moved = [
          ...(prev.byStage.LEAD ?? []),
          ...(prev.byStage.QUALIFIED ?? []),
          ...(prev.byStage.PROPOSAL ?? []),
          ...(prev.byStage.NEGOTIATION ?? []),
          ...(prev.byStage.WON ?? []),
          ...(prev.byStage.LOST ?? []),
          ...prev.parked,
        ].find((r) => r.id === id)
        if (moved) next.byStage[stage] = [moved, ...(next.byStage[stage] ?? [])]
        qc.setQueryData(['board', dealsRev], next)
        qc.setQueriesData({ queryKey: ['board'] }, next)
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(['board', dealsRev], ctx.prev)
        qc.setQueriesData({ queryKey: ['board'] }, ctx.prev)
      }
      toast.error('Could not move deal — rolled back')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['board'] }),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  )

  if (board.isLoading) return <EmptyState title="Loading board…" />
  if (board.isError || !board.data) return <EmptyState title="Board failed to load" />

  const data = board.data
  const findRow = (id: string): BoardRow | null => {
    for (const rows of [...Object.values(data.byStage), data.parked]) {
      const hit = rows.find((r) => r.id === id)
      if (hit) return hit
    }
    return null
  }

  const onDragStart = (e: DragStartEvent) => {
    isDraggingRef.current = true
    setDragging(findRow(String(e.active.id)))
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    setTimeout(() => {
      isDraggingRef.current = false
    }, 50)
    const overId = String(e.over?.id ?? '')
    if (!overId.startsWith('col:') || !dragging) return
    const stage = overId.slice(4) as DealStage
    if (!STAGE_COLUMNS.includes(stage)) return
    if ((data.byStage[stage] ?? []).some((r) => r.id === dragging.id)) return
    move.mutate({ id: dragging.id, stage })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline gap-4 pb-1">
        <h1 className="text-[length:var(--text-display)] font-semibold tracking-tight">Pipeline board</h1>
        <span className="text-[var(--text-small)] text-[var(--muted-foreground)]">
          {data.total.deals} active · {((data.total.valueCents ?? 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} total value
        </span>
        <span className="ml-auto text-[var(--text-micro)] text-[var(--muted-foreground)]">drag a card to change stage · health dot: green ≥66, amber ≥33</span>
      </header>

      {data.total.deals === 0 ? (
        <EmptyState title="No active deals" hint="Create deals to see them grouped by stage with risk badges and health." />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {STAGE_COLUMNS.map((stage) => (
              <BoardColumn key={stage} stage={stage} rows={data.byStage[stage] ?? []} />
            ))}
          </div>
          {data.parked.length > 0 && (
            <div className="mt-4 rounded-2xl bg-[var(--raised)] p-3">
              <div className="mb-2 text-[var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Parked ({data.parked.length})</div>
              <div className="flex flex-wrap gap-2">
                {data.parked.map((d) => (
                  <BoardCard key={d.id} row={d} flat />
                ))}
              </div>
            </div>
          )}
          <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
            {dragging ? (
              <div className="rotate-2 scale-105 shadow-[var(--shadow-lift)] rounded-2xl glass-panel">
                <BoardCard row={dragging} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}

function BoardColumn({ stage, rows }: { stage: DealStage; rows: BoardRow[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${stage}` })
  const stageTotalCents = rows.reduce((acc, r) => acc + (r.valueCents ?? 0), 0)

  return (
    <div
      ref={setNodeRef}
      data-stage={stage}
      data-droppable={`col:${stage}`}
      className={`min-h-72 rounded-2xl p-3.5 transition-all duration-200 ${
        isOver
          ? 'bg-[var(--accent-soft)]/60 ring-2 ring-[var(--primary)] shadow-[var(--shadow-md)]'
          : 'bg-[var(--raised)]/70 border border-[var(--border)]'
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-micro)] font-semibold uppercase tracking-wider text-[var(--foreground)]">{stage}</span>
          <span className="text-[10px] font-mono text-[var(--muted-foreground)]">({rows.length})</span>
        </div>
        <span className="tnum text-[11px] font-mono font-medium text-[var(--primary)]">
          {formatCurrency(stageTotalCents, 'EUR')}
        </span>
      </div>
      <div className="space-y-2.5">
        {rows.map((d) => (
          <BoardCard key={d.id} row={d} />
        ))}
      </div>
    </div>
  )
}

function BoardCard({ row, flat }: { row: BoardRow; flat?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (isDragging) return
        navigate(`/deals/${row.id}`)
      }}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/deals/${row.id}`)}
      className={`glass-panel card-lift cursor-grab touch-none rounded-2xl p-3.5 shadow-[var(--shadow-sm)] transition-all hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] active:cursor-grabbing ${flat ? 'w-64' : ''} ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthTone(row.healthScore)}`} title={`Health Score: ${row.healthScore ?? '—'}`} />
        <span className="font-editorial truncate text-[var(--text-small)] font-semibold text-[var(--foreground)]">{row.title}</span>
      </div>
      <div className="tnum mt-1.5 text-[var(--text-micro)] text-[var(--muted-foreground)] font-mono">
        {row.account} · <span className="font-semibold text-[var(--foreground)]">{row.valueCents !== null ? formatCurrency(row.valueCents, 'EUR') : '—'}</span> · {row.calls} call(s)
      </div>
      {row.riskFlags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {row.riskFlags.slice(0, 2).map((f) => (
            <Badge key={f} variant="outline" className="border-[color:var(--warning)]/40 text-[10px] text-[var(--warning)] bg-[color:var(--warning)]/10 font-medium">
              {f.replace(/_/g, ' ').toLowerCase()}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
