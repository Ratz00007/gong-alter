// VALENCE Agent API v1 — Grounded Copilot / Oracle Advice
import { NextRequest, NextResponse } from 'next/server'
import { processCopilotQuery } from '@/lib/copilot/query-engine'
import { z } from 'zod'

const copilotSchema = z.object({
  query: z.string().min(1),
  dealId: z.string().optional(),
  callId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = copilotSchema.parse(body)

    const result = await processCopilotQuery({
      q: parsed.query,
      activeDealId: parsed.dealId ?? null,
      activeCallId: parsed.callId ?? null,
    })

    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'COPILOT_ERROR', message: e instanceof Error ? e.message : 'Copilot query failed' } },
      { status: 400 },
    )
  }
}
