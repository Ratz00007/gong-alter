// AMBER — eval CLI (Ch. 6: "npm run eval" in the v1 Must tier).
// Runs the golden set through the real engine path and prints the per-task
// comparison against thresholds (Table 6.5).
//
// Default run: deterministic — the bundled ZAI provider is gated OFF so the
// golden set (calibrated against fixtures) passes reproducibly.
// `bun run eval --live`: ungated; measures the real provider chain (ZAI/cloud
// when reachable). Informational exit code — live models drift, that is the
// point of measuring them.
//
// The eval suite runs on its OWN database (db/eval.db, reset each run) so it
// never mutates live-app settings or data.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const defaultEvalDbFile = join(process.cwd(), 'db', 'eval.db')
process.env.DATABASE_URL = process.env.EVAL_DATABASE_URL ?? 'file:../db/eval.db'

async function main() {
  const live = process.argv.includes('--live')
  const { rmSync } = await import('node:fs')
  const { spawnSync } = await import('node:child_process')
  mkdirSync(join(process.cwd(), 'db'), { recursive: true })
  const url = process.env.DATABASE_URL!
  try { rmSync(defaultEvalDbFile, { force: true }) } catch { /* first run */ }
  const prismaCli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
  const pushRes = spawnSync('node', [prismaCli, 'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  if (pushRes.status !== 0) {
    throw new Error(`prisma db push failed: ${pushRes.stderr?.toString() || pushRes.stdout?.toString()}`)
  }

  const { runEvalSuite, ensureEvalCases } = await import('../src/lib/eval/harness')
  const { runSeed } = await import('../src/lib/seed')
  // Local alias: the linter would otherwise treat `useTestDatabase` as a React hook.
  const { useTestDatabase: pointAtEvalDb, getDb } = await import('../src/lib/db')
  const { resetZaiGateCache } = await import('../src/lib/providers/zai')
  pointAtEvalDb(url)

  await runSeed()
  if (!live) {
    await getDb().setting.update({ where: { key: 'providers.zaiEnabled' }, data: { value: false } })
    resetZaiGateCache()
  }
  await ensureEvalCases()
  const summary = await runEvalSuite()
  console.log(`\nAMBER eval — golden set G1-G10 ${live ? '(LIVE providers, informational)' : '(deterministic: ZAI gated off)'}`)
  console.log(`total ${summary.total} | passed ${summary.passed} | failed ${summary.total - summary.passed}`)
  for (const [task, s] of Object.entries(summary.byTask)) {
    const bar = '█'.repeat(Math.round((s.passed / s.total) * 20)).padEnd(20, '·')
    console.log(`  ${task}  ${bar} ${s.passed}/${s.total}`)
  }
  const failed = summary.rows.filter((r) => !r.passed)
  for (const f of failed) {
    console.log(`  FAIL ${f.case}/${f.task} via ${f.provider}:${f.model}`, f.scores)
  }
  process.exit(live ? 0 : failed.length === 0 ? 0 : 1)
}

void main()
