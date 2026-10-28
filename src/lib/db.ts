import { PrismaClient } from '@prisma/client'

// Lazy singleton. Tests call useTestDatabase() before first access to point at a temp file.
type Global = { prisma?: PrismaClient; testDb?: string }

const g = globalThis as unknown as Global

async function configureSqlitePragmas(client: PrismaClient): Promise<void> {
  try {
    await client.$queryRawUnsafe('PRAGMA journal_mode = WAL;')
    await client.$queryRawUnsafe('PRAGMA synchronous = NORMAL;')
    await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000;')
    await client.$queryRawUnsafe('PRAGMA foreign_keys = ON;')
  } catch {
    // Guarded so uninitialized or disconnecting test clients never reject unhandled
  }
}

export function useTestDatabase(url: string) {
  if (g.prisma) {
    void g.prisma.$disconnect()
    g.prisma = undefined
  }
  g.testDb = url
}

export function getDb(): PrismaClient {
  if (!g.prisma) {
    const client = new PrismaClient({
      datasources: { db: { url: g.testDb ?? process.env.DATABASE_URL } },
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['error'],
    })
    g.prisma = client
    void configureSqlitePragmas(client)
  }
  return g.prisma
}

// Convenience alias used across the codebase.
export const db = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const client = getDb()
    const v = Reflect.get(client as object, prop)
    return typeof v === 'function' ? (v as (...args: never[]) => unknown).bind(client) : v
  },
})
