// AMBER — logger with key-shape scrubbing (T3: keys never appear in any log line).
const KEY_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /[A-Za-z0-9]{32,}/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
]

function scrub(s: string): string {
  let out = s
  for (const p of KEY_PATTERNS) out = out.replace(p, (m) => (m.startsWith('Bearer') ? 'Bearer [REDACTED]' : '[REDACTED]'))
  return out
}

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const min = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20

function emit(level: 'debug' | 'info' | 'warn' | 'error', msg: string, extra?: unknown) {
  if ((LEVELS[level] ?? 20) < min) return
  const line = `[amber ${level}] ${scrub(msg)}${extra !== undefined ? ' ' + scrub(JSON.stringify(extra, safeReplacer)) : ''}`
  if (level === 'error') console.error(line)
  else console.log(line)
}

function safeReplacer(_k: string, v: unknown) {
  if (typeof v === 'bigint') return v.toString()
  return v
}

export const logger = {
  debug: (m: string, x?: unknown) => emit('debug', m, x),
  info: (m: string, x?: unknown) => emit('info', m, x),
  warn: (m: string, x?: unknown) => emit('warn', m, x),
  error: (m: string, x?: unknown) => emit('error', m, x),
}
