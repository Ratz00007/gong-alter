// AMBER — HTTP conventions (Ch. 5): error envelope (Table 5.2), collections, auth guard.
import { NextRequest, NextResponse } from 'next/server'
import { ZodType } from 'zod'
import { sessionFrom } from './auth'
import { logger } from './logger'

export const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  PIPELINE_CONFLICT: 409,
  PROVIDER_UNAVAILABLE: 503,
  BUDGET_EXCEEDED: 402,
  UNSUPPORTED_MEDIA: 415,
  RATE_LIMITED_LOCAL: 429,
  INTERNAL: 500,
}

// BigInt (Prisma bytes) is not JSON-serializable natively; convert at the envelope.
const jsonInit: ResponseInit = {}
function stringifySafe(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))
}

export function fail(code: keyof typeof ERROR_STATUS | string, message: string, details?: unknown, statusOverride?: number) {
  const status = statusOverride ?? ERROR_STATUS[code] ?? 500
  return new NextResponse(stringifySafe({ error: { code, message, details } }), { status, headers: { 'content-type': 'application/json' } })
}

export function ok<T>(data: T, init?: ResponseInit) {
  return new NextResponse(stringifySafe(data), { ...(init ?? jsonInit), headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
}

export function collection<T>(items: T[], total = items.length) {
  return new NextResponse(stringifySafe({ items, total }), { headers: { 'content-type': 'application/json' } })
}

export class HttpError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

/** Throws UNAUTHORIZED when no valid session; call at the top of every protected handler. */
export function requireSession(req: NextRequest) {
  const s = sessionFrom(req)
  if (!s) throw new HttpError('UNAUTHORIZED', 'No or expired session')
  return s
}

export async function parseJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new HttpError('VALIDATION_ERROR', 'Body is not valid JSON')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError('VALIDATION_ERROR', 'Request failed schema validation', parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })))
  }
  return parsed.data
}

/** Wraps a handler with the error envelope so no route ever improvises an error shape. */
export function handler<A extends unknown[]>(fn: (req: NextRequest, ...args: A) => Promise<Response>) {
  return async (req: NextRequest, ...args: A): Promise<NextResponse | Response> => {
    try {
      return await fn(req, ...args)
    } catch (e) {
      if (e instanceof HttpError) return fail(e.code, e.message, e.details)
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('api handler error', { message: msg })
      return fail('INTERNAL', msg)
    }
  }
}

export function notFound(what = 'Resource') {
  return fail('NOT_FOUND', `${what} does not exist`)
}

export function parseIntParam(v: string | null, fallback = 50, max = 200): number {
  const n = Number(v ?? fallback) || fallback
  return Math.min(Math.max(1, n), max)
}
