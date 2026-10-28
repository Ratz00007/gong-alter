import { NextRequest, NextResponse } from 'next/server'
import { handler, ok, requireSession } from '@/lib/http'
import { SESSION_COOKIE } from '@/lib/auth'

export const POST = handler(async (req: NextRequest) => {
  requireSession(req)
  const res = ok({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  return res
})
