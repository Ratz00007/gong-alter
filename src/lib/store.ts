'use client'
// AMBER — client state: auth + SSE revision counters (refetch on event).
import { create } from 'zustand'
import { useEffect } from 'react'

type RevKey = 'calls' | 'deals' | 'jobs' | 'budget' | 'provider' | 'insights' | 'live'

interface AmberState {
  authed: boolean | null // null = bootstrapping
  sessionChecked: boolean
  setAuthed: (v: boolean) => void
  sseConnected: boolean
  setSseConnected: (v: boolean) => void
  /** Incremented per SSE event; views include it in query keys to refetch. */
  callsRev: number
  dealsRev: number
  jobsRev: number
  budgetRev: number
  providerRev: number
  insightsRev: number
  liveRev: number
  bump: (k: RevKey) => void
}

export const useAmber = create<AmberState>((set) => ({
  authed: null,
  sessionChecked: false,
  setAuthed: (v) => set({ authed: v, sessionChecked: true }),
  sseConnected: false,
  setSseConnected: (v) => set({ sseConnected: v }),
  callsRev: 0,
  dealsRev: 0,
  jobsRev: 0,
  budgetRev: 0,
  providerRev: 0,
  insightsRev: 0,
  liveRev: 0,
  bump: (k) => set((s) => ({ [`${k}Rev`]: s[`${k}Rev` as const] + 1 }) as Partial<AmberState>),
}))

export const useValence = useAmber
export const useAppStore = useAmber
export type ValenceState = AmberState

/** SSE subscription hook — one stream, typed reactions (Table 5.8). */
export function useSse() {
  useEffect(() => {
    const es = new EventSource('/api/events')
    const on = (name: string, fn: (data: unknown) => void) => {
      es.addEventListener(name, (e) => {
        try {
          fn(JSON.parse((e as MessageEvent).data))
        } catch {
          fn({})
        }
      })
    }
    on('call.stage', () => useAmber.getState().bump('calls'))
    on('call.failed', () => useAmber.getState().bump('calls'))
    on('call.ready', () => useAmber.getState().bump('calls'))
    on('insight.created', () => useAmber.getState().bump('insights'))
    on('job.updated', () => useAmber.getState().bump('jobs'))
    on('provider.health', () => useAmber.getState().bump('provider'))
    on('budget.warning', () => useAmber.getState().bump('budget'))
    on('live.started', () => useAmber.getState().bump('live'))
    on('live.delta', () => useAmber.getState().bump('live'))
    on('live.cue', () => useAmber.getState().bump('live'))
    on('live.ended', () => {
      useAmber.getState().bump('live')
      useAmber.getState().bump('calls')
    })
    // Missed events are recovered by refetch-on-reconnect (events are hints, not truth).
    es.onopen = () => {
      useAmber.setState({ sseConnected: true })
      useAmber.getState().bump('calls')
      useAmber.getState().bump('jobs')
    }
    es.onerror = () => {
      useAmber.setState({ sseConnected: false })
    }
    return () => {
      es.close()
      useAmber.setState({ sseConnected: false })
    }
  }, [])
}
