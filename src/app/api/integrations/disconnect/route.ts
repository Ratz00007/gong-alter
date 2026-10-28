// VALENCE API — Disconnect Integration
import { NextRequest, NextResponse } from 'next/server'
import { sessionFrom } from '@/lib/auth'
import { disconnectIntegration } from '@/lib/integrations/manager'

export async function POST(req: NextRequest) {
  if (!sessionFrom(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })
  }

  try {
    const { type } = await req.json()
    if (!type) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Missing integration type' } }, { status: 400 })
    }

    const ok = await disconnectIntegration(type)
    return NextResponse.json({ ok })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: { code: 'DISCONNECT_FAILED', message: e instanceof Error ? e.message : 'Disconnect failed' } },
      { status: 500 },
    )
  }
}
