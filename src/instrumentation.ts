// AMBER — server instrumentation entry (runs once per server start).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { boot } = await import('./lib/boot')
  await boot()
}
