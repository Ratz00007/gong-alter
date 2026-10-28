import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handler, ok, parseJson, requireSession } from '@/lib/http'
import { createSessionToken, sessionCookieOptions, verifyPassphrase, SESSION_COOKIE } from '@/lib/auth'

const Body = z.object({ passphrase: z.string().min(1) })

export const POST = handler(async (req: NextRequest) => {
  const { passphrase } = await parseJson(req, Body)
  if (!verifyPassphrase(passphrase)) {
    // Single-user app: uniform message; no account enumeration surface exists.
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Passphrase does not match' } }, { status: 401 })
  }
  const { token, maxAgeSec } = createSessionToken()
  const res = ok({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, { ...sessionCookieOptions(), maxAge: maxAgeSec })
  return res
})
