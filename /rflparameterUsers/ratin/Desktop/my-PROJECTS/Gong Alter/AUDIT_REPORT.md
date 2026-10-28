# AI/ML Pipeline & Provider Integration — Brutal Audit

## Critical gaps vs production
- **Mock provider honesty**: `mockChat` serializes `mockAnswer(...)` directly; no redaction, no network. Fine for CI, but `configured: true` always and `mockEnabled()` defaults true in prod DB-less contexts → silent mock substitution can masquerade as real AI. Gate must default false in production.
- **Redaction T09**: sync shim (`redact/sync.ts`) duplicates regex logic and can drift from async engine; NER is a naive heuristic (capitalized pairs), no real NER model. Over-redaction bounded but not zero; leak risk for person names not capitalized pairs, orgs without suffix, amounts without currency. No tests for Unicode/PII edge cases.
- **Provider adapters**: OpenAI `configured` logic broken (`!!apiKey || (id === 'COMPATIBLE' && !!baseUrl && !!apiKey)` redundant; COMPATIBLE with no key still reports configured if baseUrl set? Actually requires apiKey). No streaming, no retry/backoff except ZAI; no 429 handling for OpenAI/Anthropic/Gemini/Ollama. Timeouts hardcoded. No idempotency.
- **Routing**: budget projection uses `contextTokens` (max context) not actual input+output estimate → wildly over-conservative; cloud refused prematurely. `refusedByBudget` variable shadowed (inner vs outer) but final recomputed from notes. No concurrency/queue. Health cache is process-global (not per-instance) → stale across workers.
- **Repair-retry-escalate**: repair note appended to `system` only; only 2 attempts; escalation works. But JSON extraction uses first `{`...`}`; nested braces in strings can break. No validation of cost authorization before adapter call (cost computed after response) → budget can be exceeded then recorded; `authorize` called after priceFor, but record() hard-stops; still a run may complete unrecorded if record throws after adapter success (status FAILED but output lost).
- **Budget ledger**: `spentThisMonth` relies on last row's running total (append-only; deletions corrupt). No reconciliation/audit. Cap from Setting; default 5 USD. No per-provider caps.
- **Embedding/search**: brute-force cosine over all rows; model filter means if embed model changes, old vectors ignored until reindex; `chunks.indexOf(c)` O(n²) and breaks if duplicate chunk objects. Lexical pass scans all embeddings every query. No pagination/ANN. `runEmbeds` has no redaction (embeddings of raw text) — privacy gap: PII in transcripts embedded.
- **Eval harness**: only 10 fixtures (not 24). T09 scores redaction on fixture text directly, not through engine. Eval gate returns true when no cases (neutral) — can pass empty suite. No LLM-as-judge; metrics are shallow. Mock provider path means eval never measures real providers in CI.
- **Diarization**: pause clustering assumes 2 speakers; relabel only if SPEAKER_00/01 present; no real diarization model. `clusters.size <= 1` maps only rep.
- **Observability**: ProviderRun logs attempts; no distributed tracing. Errors truncated 500 chars.

## Recommendations (priority)
1. Default mockEnabled=false in production; require explicit opt-in.
2. Replace heuristic NER with a real local model or tighten regex; add PII test suite.
3. Add retry/backoff + 429 handling to all adapters; centralize HTTP client.
4. Fix budget projection to use estimated input+output tokens; authorize before call; make ledger robust to concurrent writes (already transactional but authorize races).
5. Redact before embedding; add ANN index or at least cache.
6. Expand eval fixtures to 24 and add real-provider runs; make gate fail on empty.
7. Add streaming + cancellation; idempotency keys.
8. Per-tenant isolation of health cache.
" > AUDIT_REPORT.md && echo done