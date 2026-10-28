import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({
  datasources: { db: { url: `file:${process.cwd().replace(/\\/g, '/')}/db/custom.db` } },
})

async function main() {
  const res = await db.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);')
  console.log('WAL Checkpoint complete:', res)
  await db.$disconnect()
}

main()
