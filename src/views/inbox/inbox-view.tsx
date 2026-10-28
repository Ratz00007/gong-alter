'use client'
// AMBER — screens 2+3: Inbox (calls list with filters) and Upload (dropzone + metadata).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { navigate, useHashRoute } from '@/lib/router'
import { EmptyState, StatusChip, StageRail, PageHeader, SkeletonList } from '@/components/amber/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { UploadCloud } from 'lucide-react'
import type { CallStatus } from '@prisma/client'

interface CallRow {
  id: string
  title: string
  status: CallStatus
  occurredAt: string
  durationSec?: number | null
  errorMessage?: string | null
  deal?: { id: string; title: string; stage: string } | null
  contact?: { id: string; name: string } | null
}

export function InboxView() {
  const qc = useQueryClient()
  const callsRev = useAmber((s) => s.callsRev)
  const bump = useAmber((s) => s.bump)
  const { query } = useHashRoute()

  const [status, setStatus] = useState<string>('active')
  const [q, setQ] = useState('')
  const [dealFilter, setDealFilter] = useState<string>('all')
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)

  // Sync state from query parameters on route/hash change (e.g. #/inbox?status=READY)
  useEffect(() => {
    const qStatus = query.get('status')
    if (qStatus) setStatus(qStatus)
    const qSearch = query.get('q')
    if (qSearch !== null) setQ(qSearch)
  }, [query])

  const deals = useQuery({ queryKey: ['deals-lite'], queryFn: () => api.get<{ items: { id: string; title: string }[] }>('/api/deals?limit=200') })

  const params = new URLSearchParams({ limit: '100' })
  if (status === 'active') params.set('status', 'UPLOADED,NORMALIZING,TRANSCRIBING,ANALYZING,INDEXING,READY,REVIEWED,FAILED')
  else if (status === 'archived') { params.delete('status'); params.set('archived', '1') }
  else if (status) params.set('status', status)
  if (q.trim()) params.set('q', q.trim())
  if (dealFilter !== 'all') params.set('dealId', dealFilter)

  const calls = useQuery({
    queryKey: ['inbox', status, q, dealFilter, callsRev],
    queryFn: () => api.get<{ items: CallRow[]; total: number }>(`/api/calls?${params.toString()}`),
    refetchInterval: (query) => {
      const anyBusy = query.state.data?.items.some((c) => ['UPLOADED', 'NORMALIZING', 'TRANSCRIBING', 'ANALYZING', 'INDEXING'].includes(c.status))
      return anyBusy ? 4000 : false
    },
  })

  const deleteCall = useMutation({
    mutationFn: (id: string) => api.del(`/api/calls/${id}`),
    onSuccess: () => {
      toast.success('Call deleted')
      bump('calls')
      qc.invalidateQueries({ queryKey: ['inbox'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Delete failed'),
  })

  const retryCall = useMutation({
    mutationFn: (id: string) => api.post(`/api/calls/${id}/retry`),
    onSuccess: () => {
      toast.success('Retrying call from failed stage')
      bump('calls')
      qc.invalidateQueries({ queryKey: ['inbox'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Retry failed'),
  })

  const items = calls.data?.items ?? []

  // Keyboard navigation: j/k moves focus, Enter navigates, e deletes/archives, r retries failed calls
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (items.length === 0) return

      if (e.key === 'j') {
        e.preventDefault()
        setFocusedIdx((prev) => (prev === null ? 0 : Math.min(items.length - 1, prev + 1)))
      } else if (e.key === 'k') {
        e.preventDefault()
        setFocusedIdx((prev) => (prev === null ? 0 : Math.max(0, prev - 1)))
      } else if (e.key === 'Enter') {
        if (focusedIdx !== null && items[focusedIdx]) {
          e.preventDefault()
          navigate(`/calls/${items[focusedIdx].id}`)
        }
      } else if (e.key === 'e') {
        if (focusedIdx !== null && items[focusedIdx]) {
          e.preventDefault()
          deleteCall.mutate(items[focusedIdx].id)
        }
      } else if (e.key === 'r') {
        if (focusedIdx !== null && items[focusedIdx]) {
          const target = items[focusedIdx]
          if (target.status === 'FAILED') {
            e.preventDefault()
            retryCall.mutate(target.id)
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [items, focusedIdx, deleteCall, retryCall])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calls"
        sub="Every recording, its pipeline state, and one-click access to the analysis."
        actions={<Button onClick={() => navigate('/upload')}>Upload</Button>}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="inbox-q">Search titles</Label>
          <Input id="inbox-q" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} placeholder="contains…" />
        </div>
        <div className="grid gap-1.5">
          <Label>Deal</Label>
          <Select value={dealFilter} onValueChange={setDealFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All deals</SelectItem>
              {(deals.data?.items ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              {status !== 'active' && status !== 'archived' && (
                <SelectItem value={status}>{status}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {calls.isLoading ? (
        <Card><CardContent className="py-6"><SkeletonList rows={6} /></CardContent></Card>
      ) : items.length === 0 ? (
        <EmptyState
          title="No calls match"
          hint="Adjust the filters, or upload a recording — duplicates are detected by content hash."
          action={<Button onClick={() => navigate('/upload')}>Upload a call</Button>}
        />
      ) : (
        <ul className="space-y-2" aria-label="Calls">
          {items.map((c, idx) => {
            const isFocused = idx === focusedIdx
            return (
              <li key={c.id}>
                <Card
                  role="button"
                  tabIndex={0}
                  className={`card-lift min-w-0 cursor-pointer transition-all duration-150 ${
                    isFocused
                      ? 'border-l-4 border-l-[var(--accent)] ring-1 ring-[var(--accent)]/50 shadow-[var(--shadow-md)] bg-[var(--accent-soft)]/20'
                      : 'focus-visible:shadow-[var(--shadow-md)]'
                  }`}
                  onClick={() => {
                    setFocusedIdx(idx)
                    navigate(`/calls/${c.id}`)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/calls/${c.id}`)}
                >
                  <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[var(--text-body)] font-semibold tracking-tight text-[var(--foreground)]">{c.title}</div>
                      <div className="mt-0.5 truncate text-[var(--text-micro)] text-[var(--muted-foreground)]">
                        {new Date(c.occurredAt).toLocaleString()} · {c.deal?.title ?? 'No deal'} · {c.contact?.name ?? '—'}
                        {c.durationSec ? ` · ${Math.round(c.durationSec / 60)} min` : ''}
                      </div>
                      {c.status === 'FAILED' && c.errorMessage && (
                        <div className="mt-1.5 inline-block max-w-full truncate rounded-lg bg-[color:var(--danger)]/10 px-2 py-0.5 text-[var(--text-micro)] text-[var(--danger)]" title={c.errorMessage}>
                          {c.errorMessage.slice(0, 140)}
                        </div>
                      )}
                    </div>
                    <StatusChip status={c.status} />
                    <StageRail status={c.status} />
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

interface DealRow { id: string; title: string; contacts?: { id: string; name: string }[] }

export function UploadView() {
  const qc = useQueryClient()
  const callsRev = useAmber((s) => s.callsRev)
  const bump = useAmber((s) => s.bump)
  const deals = useQuery({ queryKey: ['deals-lite'], queryFn: () => api.get<{ items: DealRow[] }>('/api/deals?limit=200') })
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [dealId, setDealId] = useState('')
  const [contactId, setContactId] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const contactsForDeal = useMemo(() => deals.data?.items.find((d) => d.id === dealId)?.contacts ?? [], [deals.data, dealId])

  const upload = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData()
      form.set('file', f)
      if (title.trim()) form.set('title', title.trim())
      if (dealId) form.set('dealId', dealId)
      if (contactId) form.set('contactId', contactId)
      if (occurredAt) form.set('occurredAt', new Date(occurredAt).toISOString())
      return api.upload<{ call: { id: string }; duplicate: boolean; message?: string }>('/api/calls', form)
    },
    onSuccess: (res) => {
      toast.success(res.duplicate ? 'Already in your library' : 'Uploaded — pipeline starting', {
        description: res.duplicate ? 'Linked to the existing call (content hash matched).' : 'Normalizing → transcribing → analyzing.',
      })
      setFile(null)
      setTitle('')
      bump('calls')
      navigate(`/calls/${res.call.id}`)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.message, { description: err.code === 'UNSUPPORTED_MEDIA' ? 'Check format, size, and duration limits.' : undefined })
      } else {
        toast.error('Upload failed')
      }
    },
  })

  const pick = (f: File | null) => {
    if (!f) return
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Upload a call"
        sub="Drop a recording — VALENCE normalizes, transcribes, analyzes, and drafts the follow-up."
      />
      <Card className="shadow-[var(--shadow-md)]">
        <CardContent className="space-y-5 p-6">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a recording"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0] ?? null) }}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            className={`group flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-all duration-200 ${
              dragOver ? 'border-[var(--primary)] bg-[var(--accent-soft)] scale-[1.01]' : 'border-[var(--border-strong)] bg-[var(--card)] hover:border-[var(--primary)] hover:bg-[color:var(--accent-soft)]/40'
            }`}
          >
            <UploadCloud className={`h-8 w-8 transition-colors ${dragOver ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)] group-hover:text-[var(--primary)]'}`} aria-hidden />
            <p className="text-[var(--text-body)] font-semibold">{file ? file.name : 'Drop a recording, or click to pick'}</p>
            <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
              mp3, m4a, mp4, wav, webm · up to 500 MB · up to 3 hours · duplicates detected by hash
            </p>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept=".mp3,.m4a,.mp4,.wav,.webm,audio/*"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="up-title">Title</Label>
              <Input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="defaults to file name" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="up-date">Occurred at</Label>
              <Input id="up-date" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Deal (optional)</Label>
              <Select value={dealId || 'none'} onValueChange={(v) => { setDealId(v === 'none' ? '' : v); setContactId('') }}>
                <SelectTrigger><SelectValue placeholder="No deal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No deal</SelectItem>
                  {(deals.data?.items ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Contact (optional)</Label>
              <Select value={contactId || 'none'} onValueChange={(v) => setContactId(v === 'none' ? '' : v)} disabled={!dealId}>
                <SelectTrigger><SelectValue placeholder={dealId ? 'No contact' : 'Pick a deal first'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No contact</SelectItem>
                  {contactsForDeal.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
              Audio stays on this machine. Only redacted text can ever reach a cloud provider.
            </p>
            <Button disabled={!file || upload.isPending} onClick={() => file && upload.mutate(file)}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </CardContent>
      </Card>
      <p className="text-center text-[var(--text-micro)] text-[var(--muted-foreground)]">
        Pipeline: normalize (ffmpeg 16 kHz mono) → transcribe → diarize → analyze → index → ready.
      </p>
    </div>
  )
}
