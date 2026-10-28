'use client'
// VALENCE — Interactive Voice Copilot HUD ("Oracle")
// Voice-in (Web Speech / Push-to-talk) + Grounded Querying + Voice-out (SpeechSynthesis / Barge-in)
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api-client'
import { navigate } from '@/lib/router'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  Send,
  Sparkles,
  ArrowRight,
  Handshake,
  Quote,
  StopCircle,
  Activity,
  RotateCcw,
} from 'lucide-react'
import type { CopilotQueryResult } from '@/lib/copilot/query-engine'

interface VoiceCopilotHudProps {
  open: boolean
  onClose: () => void
  activeDealId?: string | null
  activeCallId?: string | null
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export function VoiceCopilotHud({ open, onClose, activeDealId, activeCallId }: VoiceCopilotHudProps) {
  const [transcript, setTranscript] = useState('')
  const [interimText, setInterimText] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [speechRate, setSpeechRate] = useState<number>(1.0)
  const [result, setResult] = useState<CopilotQueryResult | null>(null)
  const [history, setHistory] = useState<Array<{ q: string; res: CopilotQueryResult }>>([])

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stopListeningAndSubmitRef = useRef<() => void>(() => {})

  // Browser speech recognition may send audio off-device. It remains disabled
  // until a verified offline recognizer is available. Typed Copilot stays usable.

  // 2. Voice Output (TTS) with Barge-in
  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setIsSpeaking(false)
  }, [])

  const speak = useCallback(
    (text: string) => {
      if (!voiceEnabled || !text || typeof window === 'undefined' || !window.speechSynthesis) return
      stopSpeaking()

      const utter = new SpeechSynthesisUtterance(text)
      utter.rate = speechRate
      utter.pitch = 1.0

      // Prefer natural sounding English voices
      const voices = window.speechSynthesis.getVoices()
      const naturalVoice =
        voices.find((v) => v.localService && v.lang === 'en-US') ||
        voices.find((v) => v.localService)

      if (!naturalVoice) return
      utter.voice = naturalVoice

      utter.onstart = () => setIsSpeaking(true)
      utter.onend = () => setIsSpeaking(false)
      utter.onerror = () => setIsSpeaking(false)

      window.speechSynthesis.speak(utter)
    },
    [voiceEnabled, speechRate, stopSpeaking],
  )

  // 3. Submit Query to Backend
  const submitQuery = useCallback(
    async (queryText: string) => {
      const q = queryText.trim()
      if (!q) return

      stopSpeaking()
      setIsListening(false)
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {}
      }

      setIsThinking(true)
      try {
        const res = await api.post<CopilotQueryResult>('/api/copilot/query', {
          q,
          activeDealId,
          activeCallId,
        })
        setResult(res)
        setHistory((prev) => [...prev, { q, res }])
        setTranscript('')
        setInterimText('')
        // Speak out answer
        if (res.spokenText) {
          speak(res.spokenText)
        }
      } catch (err) {
        toast.error('Oracle was unable to process your query', {
          description: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setIsThinking(false)
      }
    },
    [activeDealId, activeCallId, speak, stopSpeaking],
  )

  const stopListeningAndSubmit = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
    }
    setIsListening(false)
    setTranscript((cur) => {
      if (cur.trim()) {
        void submitQuery(cur.trim())
      }
      return ''
    })
  }, [submitQuery])

  useEffect(() => {
    stopListeningAndSubmitRef.current = stopListeningAndSubmit
  }, [stopListeningAndSubmit])

  const toggleListening = useCallback(() => {
    stopSpeaking()
    if (isListening) {
      stopListeningAndSubmit()
      return
    }

    if (!recognitionRef.current) {
      toast.info('Voice recognition not supported in this browser', {
        description: 'Voice recognition is disabled in local-only mode. Type a question below.',
      })
      inputRef.current?.focus()
      return
    }

    setTranscript('')
    setInterimText('')
    setIsListening(true)
    try {
      recognitionRef.current.start()
    } catch {
      setIsListening(false)
    }
  }, [isListening, stopListeningAndSubmit, stopSpeaking])

  // Hotkey Esc to close or barge-in
  useEffect(() => {
    if (!open) {
      stopSpeaking()
      if (isListening && recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {}
        setIsListening(false)
      }
      return
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSpeaking) {
          stopSpeaking()
          return
        }
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, isSpeaking, isListening, stopSpeaking, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="glass-panel relative flex h-[85vh] max-h-[760px] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)]/95 shadow-2xl">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="brand-gradient grid h-8 w-8 place-items-center rounded-xl text-white shadow-[var(--shadow-glow)]">
              <Sparkles className="h-4 w-4 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-editorial text-base font-semibold text-[var(--foreground)]">Oracle Voice Copilot</span>
                <span className="rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                  Live Sovereign Intel
                </span>
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)]">Ask any deal status, transcript quotes, or action items</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Voice Output Controls */}
            <button
              onClick={() => {
                if (isSpeaking) stopSpeaking()
                setVoiceEnabled((v) => !v)
              }}
              title={voiceEnabled ? 'Mute voice responses' : 'Unmute voice responses'}
              className={`rounded-lg p-1.5 transition-colors ${
                voiceEnabled ? 'bg-[var(--raised)] text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--raised)]'
              }`}
            >
              {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>

            {voiceEnabled && (
              <select
                value={speechRate}
                onChange={(e) => setSpeechRate(Number(e.target.value))}
                className="rounded-lg border border-[var(--border)] bg-[var(--raised)] px-2 py-1 text-[10px] font-medium text-[var(--foreground)]"
                title="Voice speed"
              >
                <option value={1.0}>1.0x</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
              </select>
            )}

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--raised)] hover:text-[var(--foreground)] transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Conversation Stream & Card Area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 scroll-warm">
          {history.length === 0 && !result && !isThinking && (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <div
                onClick={toggleListening}
                className="group relative cursor-pointer flex h-24 w-24 items-center justify-center rounded-full bg-[var(--raised)] border border-[var(--border)] hover:border-[var(--primary)] hover:scale-105 transition-all shadow-[var(--shadow-md)]"
              >
                <Mic className="h-10 w-10 text-[var(--primary)] group-hover:scale-110 transition-transform" />
                <span className="absolute -bottom-2 rounded-full bg-[var(--primary)] px-2.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                  Tap to Speak
                </span>
              </div>
              <h3 className="mt-6 font-editorial text-lg font-semibold text-[var(--foreground)]">Speak with VALENCE Oracle</h3>
              <p className="mt-1 max-w-sm text-[12px] text-[var(--muted-foreground)]">
                Ask about any deal champion, MEDDIC qualification gaps, budget constraints, or competitor quotes.
              </p>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                {[
                  'What is the status of the Acme deal?',
                  'Who is our champion at CloudScale?',
                  'Did any prospect mention pricing this week?',
                  'What are my high priority deals closing soon?',
                ].map((sample) => (
                  <button
                    key={sample}
                    onClick={() => void submitQuery(sample)}
                    className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-2.5 text-left text-[11px] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition-all shadow-[var(--shadow-xs)]"
                  >
                    <span className="truncate">{sample}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 ml-1 opacity-50" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Result View */}
          {result && (
            <div className="space-y-4 animate-in fade-in duration-300">
              {/* Spoken Audio Banner (Active when AI speaks) */}
              {isSpeaking && (
                <div className="flex items-center justify-between rounded-2xl border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-4 py-2.5 text-[12px] text-[var(--foreground)] shadow-sm animate-pulse">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-[var(--primary)] animate-bounce" />
                    <span className="font-medium">Oracle is speaking…</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={stopSpeaking}
                    className="h-7 gap-1 text-[11px] font-semibold text-[var(--primary)] hover:bg-[var(--primary)]/20"
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                    Barge-in / Stop
                  </Button>
                </div>
              )}

              {/* Deal Cards (if resolved) */}
              {result.dealCards.length > 0 && (
                <div className="grid grid-cols-1 gap-2.5">
                  {result.dealCards.map((deal) => (
                    <div
                      key={deal.id}
                      onClick={() => {
                        onClose()
                        navigate(`/deals/${deal.id}`)
                      }}
                      className="group cursor-pointer rounded-2xl border border-[var(--border)] bg-[var(--raised)] p-4 transition-all hover:border-[var(--primary)] hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Handshake className="h-4 w-4 text-[var(--primary)]" />
                            <h4 className="font-editorial text-sm font-semibold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors truncate">
                              {deal.title}
                            </h4>
                            <span className="text-[11px] text-[var(--muted-foreground)]">({deal.account})</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                            <span className="rounded-md bg-[var(--card)] px-2 py-0.5 font-medium text-[var(--foreground)] border border-[var(--border)]">
                              {deal.stage}
                            </span>
                            <span>·</span>
                            <span className="font-mono text-[var(--foreground)]">{deal.valueFormatted}</span>
                            {deal.champion && (
                              <>
                                <span>·</span>
                                <span>
                                  Champion: <strong className="text-[var(--foreground)]">{deal.champion}</strong>
                                </span>
                              </>
                            )}
                          </div>
                          {deal.nextStep && (
                            <p className="mt-2 text-[11px] text-[var(--muted-foreground)] line-clamp-1">
                              Next: <span className="text-[var(--foreground)] font-medium">{deal.nextStep}</span>
                            </p>
                          )}
                        </div>

                        {deal.healthScore !== null && (
                          <div className="flex flex-col items-end shrink-0">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                deal.healthScore >= 70
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : deal.healthScore >= 40
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {deal.healthScore}%
                            </span>
                            <span className="text-[9px] text-[var(--muted-foreground)] mt-0.5">Health</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Synthesized Response Body */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-[13px] leading-relaxed text-[var(--foreground)] space-y-3">
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-line">
                  {result.displayText}
                </div>
              </div>

              {/* Citations & Evidence Jump */}
              {result.citations.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Evidence & Transcript Citations
                  </span>
                  <div className="grid grid-cols-1 gap-2">
                    {result.citations.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => {
                          onClose()
                          navigate(c.url.replace(/^#/, ''))
                        }}
                        className="cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--raised)]/60 p-2.5 text-[11px] hover:border-[var(--primary)] transition-all"
                      >
                        <div className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)] mb-1">
                          <span className="flex items-center gap-1 font-semibold text-[var(--foreground)]">
                            <Quote className="h-3 w-3 text-[var(--primary)]" />
                            {c.title}
                          </span>
                          {c.score && <span>Relevance: {Math.round(c.score * 100)}%</span>}
                        </div>
                        <p className="text-[var(--ink-secondary)] italic line-clamp-2">"{c.snippet}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested Follow-up Chips */}
              {result.suggestedFollowUps.length > 0 && (
                <div className="pt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] block mb-1.5">
                    Suggested Next Questions
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {result.suggestedFollowUps.map((chip) => (
                      <button
                        key={chip}
                        onClick={() => void submitQuery(chip)}
                        className="rounded-full border border-[var(--border)] bg-[var(--raised)] px-3 py-1 text-[11px] text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isThinking && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="relative flex h-12 w-12 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-30" />
                <div className="brand-gradient grid h-10 w-10 place-items-center rounded-full text-white shadow-lg">
                  <Sparkles className="h-5 w-5 animate-spin" />
                </div>
              </div>
              <span className="text-[12px] font-medium text-[var(--muted-foreground)] animate-pulse">
                Oracle is reasoning across deals & call audio…
              </span>
            </div>
          )}
        </div>

        {/* Bottom Voice / Text Input Dock */}
        <div className="border-t border-[var(--border)] bg-[var(--raised)]/50 p-4">
          {/* Live Waveform / Interim Speech Bar */}
          {isListening && (
            <div className="mb-3 flex items-center justify-between rounded-xl bg-[var(--primary)]/15 border border-[var(--primary)]/30 px-3.5 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full bg-[var(--primary)] animate-ping shrink-0" />
                <span className="text-[12px] font-medium text-[var(--foreground)] truncate">
                  {interimText || transcript || 'Listening… speak your question'}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="h-3 w-1 bg-[var(--primary)] animate-pulse rounded-full" />
                <span className="h-5 w-1 bg-[var(--primary)] animate-pulse rounded-full" />
                <span className="h-2 w-1 bg-[var(--primary)] animate-pulse rounded-full" />
                <span className="h-4 w-1 bg-[var(--primary)] animate-pulse rounded-full" />
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (transcript.trim()) void submitQuery(transcript.trim())
            }}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={toggleListening}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all shadow-sm ${
                isListening
                  ? 'bg-rose-500 text-white animate-pulse'
                  : 'brand-gradient text-white hover:opacity-90'
              }`}
              title={isListening ? 'Stop listening' : 'Start voice input'}
            >
              {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            <input
              ref={inputRef}
              type="text"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={isListening ? 'Listening…' : 'Ask anything about a deal, meeting, or competitor…'}
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-[13px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none transition-colors"
            />

            <Button
              type="submit"
              size="sm"
              disabled={!transcript.trim() || isThinking}
              className="h-10 rounded-xl px-4 gap-1.5 brand-gradient text-white border-0"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Ask</span>
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
