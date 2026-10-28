import { NextRequest } from 'next/server'
import { handler } from '@/lib/http'
import { requireSession } from '@/lib/http'
import { subscribe, heartbeatMs, AmberEvent } from '@/lib/events'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      const write = (event: AmberEvent, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
      }
      unsubscribe = subscribe(write)
      write('heartbeat', {})
      heartbeat = setInterval(() => {
        try {
          write('heartbeat', {})
        } catch {
          /* closed */
        }
      }, heartbeatMs())
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
