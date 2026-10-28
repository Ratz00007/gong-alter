// VALENCE — Formatting & Localization Utilities
// Provides consistent currency, duration, and metric formatting with tabular numeral alignment.

export type CurrencyCode = 'EUR' | 'USD' | 'GBP'

/**
 * Format currency with locale-aware symbols and grouping.
 * Defaults to EUR (€) to match Irish enterprise deals (CGI).
 */
export function formatCurrency(
  cents: number | null | undefined,
  currency: CurrencyCode = 'EUR',
): string {
  if (cents == null || isNaN(cents)) return '—'
  const locale = currency === 'EUR' ? 'en-IE' : currency === 'GBP' ? 'en-GB' : 'en-US'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

/**
 * Format seconds into mm:ss or hh:mm:ss with zero-padding.
 */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || isNaN(sec) || sec < 0) return '00:00'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Format milliseconds into mm:ss.
 */
export function formatClockMs(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms) || ms < 0) return '00:00'
  return formatDuration(Math.floor(ms / 1000))
}

/**
 * Format talk-ratio percentages with strict tabular width.
 */
export function formatRatio(percent: number): string {
  return `${Math.round(percent)}%`
}
