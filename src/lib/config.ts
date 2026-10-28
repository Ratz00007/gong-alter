// AMBER — frozen environment config (Ch. 11). Read once; nothing downstream re-reads env.
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

function env(key: string, fallback = ''): string {
  const v = process.env[key]
  return v === undefined || v === '' ? fallback : v
}

// Local-only AI is enforced for this installation, regardless of legacy environment settings.
const routingMode = 'LOCAL_ONLY' as const

const mediaDir = env('MEDIA_DIR', './data/media')
const dataDir = env('DATA_DIR', dirname(mediaDir))

export const config = Object.freeze({
  env: env('NODE_ENV', 'development'),
  databaseUrl: env('DATABASE_URL', 'file:./db/amber.db'),
  dataDir,
  mediaDir,
  backupDir: env('BACKUP_DIR', './data/backups'),
  routingMode,
  logLevel: env('LOG_LEVEL', 'info'),
  ollama: {
    baseUrl: env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    timeoutMs: Number(env('OLLAMA_TIMEOUT_MS', '120000')),
  },
  providers: {
    openai: { baseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1'), apiKey: env('OPENAI_API_KEY') },
    anthropic: { baseUrl: env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'), apiKey: env('ANTHROPIC_API_KEY') },
    gemini: { baseUrl: env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'), apiKey: env('GEMINI_API_KEY') },
    compatible: { baseUrl: env('COMPATIBLE_BASE_URL'), apiKey: env('COMPATIBLE_API_KEY') },
  },
  stt: {
    binding: env('WHISPER_BINDING', 'scripted') as 'whisper' | 'scripted',
    model: env('WHISPER_MODEL', 'small'),
    device: env('WHISPER_DEVICE', 'cpu'),
    compute: env('WHISPER_COMPUTE', 'int8'),
  },
  audio: {
    maxMb: Number(env('AUDIO_MAX_MB', '500')),
    maxHours: Number(env('AUDIO_MAX_HOURS', '3')),
  },
  budgetSeedUsd: Number(env('MONTHLY_BUDGET_USD', '5')),
  embedModel: env('EMBED_MODEL', 'nomic-embed-text'),
  jobMaxAttempts: Number(env('JOB_MAX_ATTEMPTS', '3')),
  workerEnabled: env('WORKER_ENABLED', 'true') === 'true',
  sseHeartbeatSec: Number(env('SSE_HEARTBEAT_SEC', '15')),
  session: {
    passphrase: env('SESSION_PASSPHRASE'),
    passphraseHash: env('SESSION_PASSPHRASE_HASH'),
    ttlHours: 12,
  },
})

export type AppConfig = typeof config

let cachedFallbackSecret: string | null = null

function getOrCreateFallbackSecret(dir: string): string {
  if (cachedFallbackSecret) return cachedFallbackSecret
  const secretPath = join(dir, '.session-secret')
  try {
    if (existsSync(secretPath)) {
      const existing = readFileSync(secretPath, 'utf8').trim()
      if (existing.length >= 64) {
        cachedFallbackSecret = existing
        return existing
      }
    }
    mkdirSync(dirname(secretPath), { recursive: true })
    const generated = randomBytes(32).toString('hex')
    writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 })
    cachedFallbackSecret = generated
    return generated
  } catch {
    cachedFallbackSecret = randomBytes(32).toString('hex')
    return cachedFallbackSecret
  }
}

// Signing secret derived deterministically from the passphrase source or persisted .session-secret.
export function sessionSecret(): Buffer {
  const source =
    process.env.SESSION_PASSPHRASE_HASH ||
    process.env.SESSION_PASSPHRASE ||
    config.session.passphraseHash ||
    config.session.passphrase ||
    getOrCreateFallbackSecret(config.dataDir)
  return createHmac('sha256', 'amber-session-v1').update(source).digest()
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}
