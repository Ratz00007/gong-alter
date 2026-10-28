// VALENCE API — Trigger Integration Sync
import { NextRequest, NextResponse } from 'next/server'
import { sessionFrom } from '@/lib/auth'
import { syncIntegration } from '@/lib/integrations/manager'

export async function POST(req: NextRequest) {
  if (!sessionFrom(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })
  }

  try {
    const { type } = await req.json()
    if (!type) {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Missing integration type' } }, { status: 400 })
    }

    const res = await syncIntegration(type)
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: { code: 'SYNC_FAILED', message: e instanceof Error ? e.message : 'Sync failed' } },
      { status: 500 },
    )
  }
}
