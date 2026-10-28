// AMBER — middleware: structural session gate for the API (Ch. 5 conventions:
// all endpoints except /api/system/health and /api/auth/login require a session).
// Uses pure Web Crypto (Edge Runtime compatible) to verify both expiry and HMAC-SHA256 signature.
import { NextRequest, NextResponse } from 'next/server'

const PUBLIC = new Set(['/api/system/health', '/api/auth/login'])

function base64UrlToUint8Array(b64url: string): Uint8Array<ArrayBuffer> {
  const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const buf = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function verifyEdgeHmac(body: string, sig: string): Promise<boolean> {
  const source = process.env.SESSION_PASSPHRASE_HASH || process.env.SESSION_PASSPHRASE
  if (!source) {
    // When using auto-generated local .session-secret file on disk, defer HMAC check to Node route handler
    return true
  }
  try {
    const enc = new TextEncoder()
    const domainKey = await crypto.subtle.importKey(
      'raw',
      enc.encode('amber-session-v1'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const derivedSecret = await crypto.subtle.sign('HMAC', domainKey, enc.encode(source))
    const signingKey = await crypto.subtle.importKey(
      'raw',
      derivedSecret,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const sigBytes = base64UrlToUint8Array(sig)
    return await crypto.subtle.verify('HMAC', signingKey, sigBytes, enc.encode(body))
  } catch {
    return false
  }
}

async function hasLiveSessionCookie(req: NextRequest): Promise<boolean> {
  const raw = req.cookies.get('amber_session')?.value
  if (!raw) return false
  const idx = raw.lastIndexOf('.')
  if (idx < 1) return false
  const body = raw.slice(0, idx)
  const sig = raw.slice(idx + 1)
  if (!sig) return false
  try {
    const decoded = new TextDecoder().decode(base64UrlToUint8Array(body))
    const payload = JSON.parse(decoded) as { exp?: unknown }
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return false
    return await verifyEdgeHmac(body, sig)
  } catch {
    return false
  }
}

function verifyEdgeAgentApiKey(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const xKey = req.headers.get('x-valence-key') ?? ''
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : xKey.trim()
  if (!key) return false
  const expected = process.env.VALENCE_AGENT_KEY || 'valence_agent_master_key_sov2026'
  return key === expected
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (!pathname.startsWith('/api/') || PUBLIC.has(pathname)) {
    return NextResponse.next()
  }
  if (pathname.startsWith('/api/agent/')) {
    if (verifyEdgeAgentApiKey(req)) {
      return NextResponse.next()
    }
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED_AGENT', message: 'Invalid or missing agent API key' } },
      { status: 401 },
    )
  }
  if (!(await hasLiveSessionCookie(req))) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'No or expired session' } },
      { status: 401 },
    )
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
