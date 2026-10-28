// VALENCE Agent API v1 — Call Details
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = getDb()
  const { id } = await params

  const call = await db.call.findUnique({
    where: { id },
    include: {
      deal: true,
      contact: true,
      transcript: {
        include: {
          segments: { orderBy: { idx: 'asc' } },
        },
      },
      summary: true,
      scorecard: true,
      insights: { where: { status: 'ACTIVE' } },
      followUpDraft: true,
      notes: true,
    },
  })

  if (!call) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Call not found' } }, { status: 404 })
  }

  return NextResponse.json({ call })
}
