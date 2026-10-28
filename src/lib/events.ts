// AMBER — in-process event bus feeding the SSE stream (Table 5.8).
// Events are hints, not sources of truth; clients refetch on receipt.
import { config } from './config'

export type AmberEvent =
  | 'call.stage' | 'call.failed' | 'call.ready'
  | 'insight.created' | 'job.updated' | 'provider.health' | 'budget.warning' | 'heartbeat'
  | 'live.started' | 'live.delta' | 'live.cue' | 'live.ended'

type Client = { id: number; send: (event: AmberEvent, payload: unknown) => void }

type Bus = { clients: Map<number, Client>; nextId: number; seq: number }

const g = globalThis as unknown as { __amberBus?: Bus }
const bus: Bus = (g.__amberBus ??= { clients: new Map(), nextId: 1, seq: 0 })

export function publish(event: AmberEvent, payload: Record<string, unknown> = {}) {
  bus.seq++
  for (const c of bus.clients.values()) {
    try {
      c.send(event, payload)
    } catch {
      bus.clients.delete(c.id)
    }
  }
}

export function subscribe(send: Client['send']): () => void {
  const id = bus.nextId++
  const client: Client = { id, send }
  bus.clients.set(id, client)
  return () => bus.clients.delete(id)
}

export function heartbeatMs(): number {
  return Math.max(5, config.sseHeartbeatSec) * 1000
}

export function subscriberCount(): number {
  return bus.clients.size
}
