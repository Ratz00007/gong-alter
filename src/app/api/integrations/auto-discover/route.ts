// VALENCE API — Email Auto-Discovery (Non-technical IMAP/SMTP setup)
import { NextRequest, NextResponse } from 'next/server'
import { sessionFrom } from '@/lib/auth'
import { autoDiscoverEmailSettings } from '@/lib/integrations/email/auto-discover'

export async function POST(req: NextRequest) {
  if (!sessionFrom(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })
  }

  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Please provide an email address' } }, { status: 400 })
    }

    const discovered = autoDiscoverEmailSettings(email)
    return NextResponse.json({ ok: true, settings: discovered })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: { code: 'DISCOVERY_FAILED', message: e instanceof Error ? e.message : 'Discovery failed' } },
      { status: 500 },
    )
  }
}
