'use client'
// AMBER — screen: login (T4). Passphrase from .env; 12h session cookie.
// The front door: warm radial wash, brand mark, one-line pitch, trust chips.
import { useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { useAmber } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShieldCheck, Cpu, FileLock2 } from 'lucide-react'

const TRUST = [
  { icon: ShieldCheck, label: 'Audio never leaves this machine' },
  { icon: Cpu, label: 'Local models first, cloud when it earns it' },
  { icon: FileLock2, label: 'Every AI run logged with cost' },
]

export function LoginView() {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setAuthed = useAmber((s) => s.setAuthed)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passphrase) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login', { passphrase })
      setAuthed(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="hero-wash flex min-h-screen items-center justify-center p-6 bg-[var(--background)]">
      <div className="w-full max-w-400">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="brand-gradient grid h-14 w-14 place-items-center rounded-3xl text-xl font-bold text-white shadow-[var(--shadow-glow)]">V</div>
          <h1 className="font-editorial text-[length:var(--text-display-lg)] font-semibold tracking-tight text-[var(--foreground)]">VALENCE</h1>
          <p className="max-w-sm text-[var(--text-body)] leading-relaxed text-[var(--ink-secondary)] font-editorial">
            Sovereign revenue intelligence — your calls, your models, your data.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="glass-panel rounded-3xl p-6 shadow-[var(--shadow-lg)] sm:p-8"
          aria-label="Sign in"
        >
          <div className="grid gap-2">
            <Label htmlFor="passphrase" className="text-[var(--text-small)] font-medium">Passphrase</Label>
            <Input
              id="passphrase"
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="set in .env (SESSION_PASSPHRASE)"
              className="h-11 rounded-xl text-[var(--text-body)]"
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-[color:var(--danger)]/10 px-3 py-2 text-[var(--text-small)] text-[var(--danger)]">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !passphrase} className="mt-5 h-11 w-full rounded-xl text-[var(--text-body)] font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90">
            {busy ? 'Checking…' : 'Unlock VALENCE'}
          </Button>
          <p className="mt-3 text-center text-[var(--text-micro)] text-[var(--muted-foreground)]">
            Session lasts 12 hours — then it locks itself.
          </p>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {TRUST.map((t) => (
            <span
              key={t.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)]/70 px-3 py-1.5 text-[var(--text-micro)] font-medium text-[var(--ink-secondary)] backdrop-blur"
            >
              <t.icon className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden />
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </main>
  )
}
