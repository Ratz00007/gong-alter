# -*- coding: utf-8 -*-
"""AMBER Complete Build Dossier — content module 6: Ch11 Config Reference, Ch12 Build Orders."""

D6 = [
    # ================================================================ CH 11
    ('h1', 'Configuration Reference'),
    ('p', 'Configuration lives in exactly two places, and the boundary between them is a rule, not a habit. The environment (.env) holds infrastructure and secrets: paths, keys, routing mode, thresholds that change the machine\'s behavior. The Setting table holds product data the UI can change at runtime: budget cap, rubric definitions, competitor list, price tables, prompt versions. If a change should require a restart, it is an env var; if it should be a click, it is a Setting. This chapter enumerates both, with defaults and purpose, so that no code session ever has to grep for a knob.'),
    ('h2', 'Environment variables'),
    ('table', {
        'caption': 'Table 11.1 - Every environment variable (defaults shown for a fresh install)',
        'headers': ['Variable', 'Default', 'Purpose'],
        'ratios': [0.30, 0.17, 0.53],
        'rows': [
            ['SESSION_PASSPHRASE_HASH', '(set at first run)', 'Argon2id hash of the local session passphrase (T4)'],
            ['DATABASE_URL', 'file:./dev.db', 'SQLite file location (Prisma)'],
            ['MEDIA_DIR', './data/media', 'Content-addressed audio vault'],
            ['BACKUP_DIR', './data/backups', 'Snapshot target for the nightly job'],
            ['PORT', '3000', 'App port'],
            ['LOG_LEVEL', 'info', 'debug, info, warn, error'],
            ['ROUTING_MODE', 'LOCAL_FIRST', 'LOCAL_FIRST, CLOUD_FIRST, LOCAL_ONLY, CLOUD_ONLY'],
            ['OLLAMA_BASE_URL', 'http://127.0.0.1:11434', 'Local runtime endpoint'],
            ['OLLAMA_TIMEOUT_MS', '120000', 'Per-call local timeout (large contexts are slow)'],
            ['OPENAI_API_KEY / OPENAI_BASE_URL', '(empty) / api.openai.com', 'OpenAI or any compatible relay'],
            ['ANTHROPIC_API_KEY', '(empty)', 'Claude fallback leg'],
            ['GEMINI_API_KEY', '(empty)', 'Gemini fallback leg'],
            ['COMPATIBLE_BASE_URL / COMPATIBLE_API_KEY', '(empty)', 'The any-provider escape hatch (Groq, DeepSeek, Together...)'],
            ['WHISPER_MODEL', 'small', 'small, medium, large-v3 - tier ladder per Ch. 10'],
            ['WHISPER_DEVICE', 'cpu', 'cpu or cuda; auto-detects and logs the choice'],
            ['WHISPER_COMPUTE', 'int8', 'Quantization for CPU comfort (R05)'],
            ['AUDIO_MAX_MB / AUDIO_MAX_HOURS', '500 / 3', 'Upload rules (FR-001)'],
            ['EMBED_MODEL', 'nomic-embed-text', 'Local embedding model tag'],
            ['MONTHLY_BUDGET_USD', '5.00', 'Cloud cap seed; runtime value lives in Setting budget.monthlyCapUsd'],
            ['EVAL_THRESHOLD_OVERRIDE', '(empty)', 'Per-task threshold overrides for experiments only'],
            ['JOB_MAX_ATTEMPTS', '3', 'Retry ceiling before parking (Table 3.2)'],
            ['WORKER_ENABLED', 'true', 'Set false on a UI-only machine (rare, but free)'],
            ['SSE_HEARTBEAT_SEC', '15', 'Keepalive cadence (Table 5.8)'],
        ],
    }),
    ('h2', 'models.yaml: the model catalog'),
    ('p', 'The catalog resolves the model hints from Chapter 6 into concrete, pullable model ids and defines the preference chain per hint. It is the single place a model swap happens (R08), and provider health plus the catalog are what the Settings screen renders. The seeded file below is the 2026-October baseline validated in v1; entries are self-describing, and unknown providers simply never become healthy.'),
    ('code', {
        'text': '# models.yaml (seeded; edit freely - this is data, not code)\n'
                'catalog:\n'
                '  small:            # hint -> concrete models, preference order\n'
                '    - provider: ollama\n'
                '      model: qwen3:8b\n'
                '      contextTokens: 32768\n'
                '  medium:\n'
                '    - provider: ollama\n'
                '      model: gpt-oss:20b\n'
                '      contextTokens: 32768\n'
                '    - provider: openai          # first cloud leg (needs key)\n'
                '      model: gpt-4o-mini\n'
                '      contextTokens: 128000\n'
                '      pricePerMTokens: { input: 0.15, output: 0.60 }   # USD, maintained in Setting\n'
                '    - provider: anthropic\n'
                '      model: claude-sonnet (current stable tag)\n'
                '      contextTokens: 200000\n'
                '    - provider: gemini\n'
                '      model: gemini-flash (current stable tag)\n'
                '      contextTokens: 1000000\n'
                '  large: []             # unused in v1; reserved for RAG-heavy future\n'
                '  embed:\n'
                '    - provider: ollama\n'
                '      model: nomic-embed-text\n'
                '      dim: 768\n'
                'overrides: {}            # per-task chains, e.g. { T04: { only: [ollama] } }\n'
                'retention:               # provider data-policy flags (T7)\n'
                '  openai: zero-retention-api\n'
                '  anthropic: zero-retention-api\n'
                '  gemini: free-tier-stores\n'
                '  compatible: unknown',
        'caption': 'models.yaml seeded baseline. Preference order within a hint is top-to-bottom; the router skips unhealthy or keyless entries.',
    }),
    ('h2', 'Setting keys and tuning knobs'),
    ('p', 'Setting keys are whitelisted by PATCH /api/settings - the whitelist itself is code, so a new key is a deliberate act with a schema. The defaults below are the seeded values; every one of them is chosen so that the app behaves correctly without ever opening Settings. Tuning guidance follows the table for the three knobs people actually adjust.'),
    ('table', {
        'caption': 'Table 11.2 - Setting keys (runtime, UI-editable)',
        'headers': ['Key', 'Seeded value', 'Purpose'],
        'ratios': [0.30, 0.24, 0.46],
        'rows': [
            ['budget.monthlyCapUsd', '5.00', 'The cap the ledger enforces (FR-022); changes are logged'],
            ['rubric.v1', 'Table 3.5 definition', 'Rubric data: dimensions, weights, full-marks text; versioned immutably'],
            ['competitors.list', '["Salesforce", "HubSpot", "Zoho", "Pipedrive"]', 'Seed list for COMPETITOR_MENTIONED; edit freely'],
            ['prices.openai / prices.anthropic / prices.gemini', '2026 mid-tier table', 'Per-model USD per million tokens; keeps ledger estimates honest'],
            ['ui.tone', 'warm-professional', 'Default tone for T07 drafts'],
            ['redaction.nerEnabled', 'true', 'Local NER pass on top of regex rules'],
            ['transcript.readerFont', 'serif', 'serif or dyslexia-friendly (Ch. 7)'],
            ['search.minScore', '0.24', 'Cosine floor below which hits are hidden (tuned on fixtures)'],
            ['pipeline.autoArchiveDays', '0', '0 = never auto-archive; else days after REVIEWED'],
        ],
    }),
    ('p', 'The three knobs worth tuning guidance: ROUTING_MODE is the privacy-cost dial - LOCAL_ONLY when a spike of paranoia or an offline week hits, LOCAL_FIRST as the designed default, CLOUD_FIRST only if local quality measurably disappoints on your golden set (check the eval console first, not vibes). MONTHLY_BUDGET_USD exists to make cloud anxiety numeric: at default caps a heavy month of escalated analysis costs about a coffee. WHISPER_MODEL is the patience dial: small is the default because its RTF holds on CPU; medium buys accuracy on accented audio (G5 is the fixture that decides) at roughly double the wait. Every other knob keeps its default until a measurement in the eval console or performance suite says otherwise - that is the standing rule of this dossier.'),

    # ================================================================ CH 12
    ('h1', 'Build Orders - The Execution Plan'),
    ('p', 'This chapter converts everything before it into forty work orders across six phases, P0 through P5. A work order is the unit of a working session: it names its scope, the key files it touches, its dependencies, its estimate in 90-minute focus blocks, and a definition of done that cites requirement IDs - the same FRs and NFRs from Chapter 2. The rules of engagement are three. Build in order within a phase (dependencies are listed, not implied). A work order is done when its DoD passes, not when the code exists. And when reality disagrees with this dossier mid-build, the disagreement is resolved by the change-control rules at the end of this chapter - never by quiet improvisation, which is how specifications rot.'),
    ('h2', 'Phase 0 - Foundation'),
    ('p', 'Phase 0 exists to make every later session friction-free: scaffold, schema, tokens, and the trust layer. It is deliberately infrastructure-light (no AI, no audio) and ends with an app you can sign into and look at. Six work orders, eleven blocks.'),
    ('table', {
        'caption': 'Table 12.1 - Phase 0 work orders',
        'headers': ['ID', 'Scope', 'Key files', 'Depends', 'Est.', 'Definition of done'],
        'ratios': [0.07, 0.24, 0.18, 0.08, 0.07, 0.36],
        'rows': [
            ['WO-001', 'Repo scaffold: Next.js 16 + TS strict, pnpm, lint/format, CI script, .env.example', 'root, package.json', '-', '1', 'pnpm dev serves an empty shell; lint + unit runner wired; commit hooks active'],
            ['WO-002', 'Prisma schema per Ch. 4 (all 19 tables + enums + indexes) and first migration', 'prisma/schema.prisma, migrations/', '001', '2', 'migrate deploy on clean clone creates dev.db; seed runs idempotently with default Settings and starter prompt templates'],
            ['WO-003', 'Warm Calm tokens + component kit + app shell (left rail, header, toast, drawer)', 'globals.css, components/ui/*', '001', '2', 'Tokens from Table 7.1 exist once; shell renders on /; storybook-style preview page shows every component in its four states'],
            ['WO-004', 'Auth: passphrase session cookie + middleware + login screen', 'middleware, /api/auth/*, app/login', '002, 003', '1', 'NFR: unauthenticated /api returns 401; cookie flags per T4; login flow E2E-green'],
            ['WO-005', 'Settings API + Settings screens skeleton (Providers/Budget/Redaction/Prompts tabs)', '/api/settings, app/settings/*', '002, 003', '2', 'Whitelisted keys PATCH round-trips; all four tabs render their empty states per Ch. 7'],
            ['WO-006', 'Job queue + worker loop with locks, backoff, and boot-time reclaim', 'lib/jobs/*', '002', '3', 'Unit tests: enqueue, lease, stale-lock reclaim, attempts ceiling; FR-008 stage-level assertions run against a fake job'],
        ],
    }),
    ('h2', 'Phase 1 - Ingestion and transcription'),
    ('p', 'Phase 1 builds the left half of the pipeline: from a dropped file to a speaker-attributed transcript you can read. It ends with the first genuinely magical moment of the project - your own recording, transcribed, on your own machine. Six work orders, fourteen blocks.'),
    ('table', {
        'caption': 'Table 12.2 - Phase 1 work orders',
        'headers': ['ID', 'Scope', 'Key files', 'Depends', 'Est.', 'Definition of done'],
        'ratios': [0.07, 0.24, 0.18, 0.08, 0.07, 0.36],
        'rows': [
            ['WO-007', 'Media vault: SHA-256 content addressing, two-level fan-out storage, dedup', 'lib/media/*', '002', '2', 'FR-002 integration-green (duplicate links, no re-job); corrupt-file case handled per Table 3.6'],
            ['WO-008', 'Upload API + Inbox screen + dropzone + upload rules', '/api/calls, app/inbox, app/upload', '007', '2', 'FR-001 table-driven tests pass; 415 envelope correct; inbox renders statuses with progress rail'],
            ['WO-009', 'Normalize stage: ffmpeg strip/resample/loudness + ffprobe facts', 'pipeline/normalize*', '006, 007', '1', 'WAV asset written; duration/sampleRate persisted; NORMALIZE_FAILED path tested'],
            ['WO-010', 'Transcribe stage: whisper bindings, model ladder, RTF logging', 'pipeline/transcribe*', '009', '3', 'FR-003 measured on reference machine (RTF logged per run); G1-G3 transcripts produced; TRANSCRIBE_EMPTY path tested'],
            ['WO-011', 'Diarization + speaker relabel (T02) with local LLM pass', 'pipeline/diarize*, prompts/T02', '010', '2', 'Labels REP/PROSPECT/UNKNOWN on G1-G4; relabel provenance row written; manual label fix on reader persists'],
            ['WO-012', 'Transcript reader screen + in-call find + selection popover', 'app/calls/[id]/transcript', '011', '4', 'Reader renders serif, speaker rail, ms-accurate seek; popover offers promote-to-note; keyboard layer for reader green'],
        ],
    }),
    ('h2', 'Phase 2 - Analysis engine'),
    ('p', 'Phase 2 is the heart transplant: the provider adapter family, the routing function, the prompt engine, and tasks T03-T08 turning transcripts into intelligence. It ends with a call detail page that explains itself. Nine work orders, twenty blocks - the longest phase, split by design so every order still fits a session.'),
    ('table', {
        'caption': 'Table 12.3 - Phase 2 work orders',
        'headers': ['ID', 'Scope', 'Key files', 'Depends', 'Est.', 'Definition of done'],
        'ratios': [0.07, 0.24, 0.18, 0.08, 0.07, 0.36],
        'rows': [
            ['WO-013', 'Adapter family: uniform interface, Ollama + OpenAI + Anthropic + Gemini + compatible, health caching', 'lib/providers/*', '002', '3', 'NFR-08: each at or under 150 LOC; mock-server integration tests; health card endpoint live'],
            ['WO-014', 'Routing function: policy tier, payload fit, budget check, health skip, preference order', 'lib/routing/*', '013', '2', 'Unit tests cover every row of Table 6.4; pure function, zero I/O; property tests for cap refusal'],
            ['WO-015', 'Budget ledger: transactional cap, entries, spend endpoints', 'lib/budget/*, /api/budget', '002, 013', '2', 'FR-022 integration-green with the 0.01-dollar cap trick; footer meter wired to SSE budget.warning'],
            ['WO-016', 'Prompt engine: template store, versioning, activation gate hook', 'lib/prompts/*, Settings-Prompts UI', '002, 013', '2', 'NFR-14: edit creates version; exactly one active; activation blocked when eval gate red'],
            ['WO-017', 'Quality gates + repair-retry ladder shared by all tasks', 'lib/tasks/gates*', '014, 016', '2', 'Schema-validators per task from Ch. 6; retry ladder per Table 6.4 unit-green on failure fixtures'],
            ['WO-018', 'Analysis stage: T03 summary, T05 signals, T08 notes with seeded prompts', 'pipeline/analyze*, prompts/T03,T05,T08', '017', '3', 'G1, G4, G7 outputs schema-valid with evidence ids; ProviderRun rows complete (FR-023)'],
            ['WO-019', 'T04 MEDDIC extraction + write-back to deals/contacts', 'prompts/T04, lib/meddic*', '018', '2', 'FR-009 eval F1 at or above 0.85 on golden set; NOT_FOUND honest on G4; champion/EB write-back green'],
            ['WO-020', 'T06 scorecard + S5 arithmetic metrics', 'prompts/T06, lib/score*', '018', '2', 'FR-014/005: weighted scoring unit-green; arithmetic fields never trusted from model (asserted); G2 scored with evidence'],
            ['WO-021', 'T07 follow-up draft + notes/review UI on call detail', 'prompts/T07, app/calls/[id]/*', '018', '3', 'FR-006/007: draft cites concrete detail on G1; edit + copy + SENT flow E2E-green'],
        ],
    }),
    ('h2', 'Phase 3 - Deal Intelligence'),
    ('p', 'Phase 3 gives the intelligence a home: deals, contacts, the board, the timeline, and health. Five work orders, twelve blocks, ending with the pipeline board reading like the truth.'),
    ('table', {
        'caption': 'Table 12.4 - Phase 3 work orders',
        'headers': ['ID', 'Scope', 'Key files', 'Depends', 'Est.', 'Definition of done'],
        'ratios': [0.07, 0.24, 0.18, 0.08, 0.07, 0.36],
        'rows': [
            ['WO-022', 'Deal + Contact CRUD APIs and screens', '/api/deals, /api/contacts, app/deals/*', '005, 008', '2', 'Soft-delete per Ch. 4; contacts deal-scoped; validation envelopes per Table 5.2'],
            ['WO-023', 'Pipeline board: columns, cards, badges, drag with optimistic update', 'app/board, /api/pipeline', '022', '3', 'FR-011 E2E-green incl. drag ghost and rollback on error; board under 1 s with 50 seeded deals'],
            ['WO-024', 'Deal timeline assembly + risk badge surfacing', 'lib/timeline/*, app/deals/[id]', '022, 018', '2', 'FR-012: mixed entries ordered correctly; every entry links to source; risk badges match flag rules'],
            ['WO-025', 'Health score service (v1 formula) + recomputation hooks', 'lib/health/*', '024', '1', 'Table 3 formula unit-pinned; recompute on analyze verified; historical scores explainable'],
            ['WO-026', 'Insight review queue + confirm/dismiss flows with write-back', 'app/review, /api/insights', '019', '4', 'FR review flow E2E; confirmed MEDDIC writes to deal/contact; queue keyboard layer green'],
        ],
    }),
    ('h2', 'Phase 4 - Coaching and Library'),
    ('p', 'Phase 4 closes the four pillars: trends, best practices, embeddings, semantic search, and the RAG answer surface. Six work orders, fourteen blocks.'),
    ('table', {
        'caption': 'Table 12.5 - Phase 4 work orders',
        'headers': ['ID', 'Scope', 'Key files', 'Depends', 'Est.', 'Definition of done'],
        'ratios': [0.07, 0.24, 0.18, 0.08, 0.07, 0.36],
        'rows': [
            ['WO-027', 'Coaching home: trend charts, dimension bars, calibration empty state', 'app/coaching, /api/coaching/*', '020', '2', 'FR-015: chart renders only past 3 calls; window filter; table view toggle'],
            ['WO-028', 'Scorecard detail + compare-to-top-quartile', 'app/calls/[id]/scorecard', '020, 027', '2', 'FR-017: ghost quartile markers; evidence links open reader at segment'],
            ['WO-029', 'Embedding pipeline + index stage (T10) + re-index job', 'pipeline/index*, lib/embed/*', '010, 013', '2', 'Chunking per Ch. 3; re-index on model switch green; vectors removed with sources'],
            ['WO-030', 'Library search API + results screen with snippets, filters, grouping', 'app/library, /api/library/*', '029', '3', 'FR-018/019: latency under 2 s at 1k synthetic calls; filters compose; highlight correct'],
            ['WO-031', 'Best practices: promotion flow, candidate suggestions (T12), library CRUD', 'app/practices, prompts/T12', '018, 030', '2', 'FR-016: promote from selection and accept suggestions both create searchable entries with evidence'],
            ['WO-032', 'Library answer surface (T11 RAG) with citations and refusal', 'app/library/answer, prompts/T11', '030', '3', 'Citation validity 1.00 on fixtures; refusal state on low-score; G9 adversarial case green'],
        ],
    }),
    ('h2', 'Phase 5 - Hardening and polish'),
    ('p', 'Phase 5 earns the right to be called done: privacy enforcement, the eval console, backup, export, performance, and the operational dry-run that proves the runbook. Eight work orders, sixteen blocks. The phase ends by running the project definition of done below, in order, on the reference machine.'),
    ('table', {
        'caption': 'Table 12.6 - Phase 5 work orders',
        'headers': ['ID', 'Scope', 'Key files', 'Depends', 'Est.', 'Definition of done'],
        'ratios': [0.07, 0.24, 0.18, 0.08, 0.07, 0.36],
        'rows': [
            ['WO-033', 'Redaction pipeline (T09) + Settings rules UI + test pad', 'lib/redact/*, app/settings/redaction', '013', '3', 'T9/T10 threat answers: G10 zero leaks; adapter-boundary spy test build-failing (NFR-05)'],
            ['WO-034', 'Eval harness CLI + golden set wiring + eval console screen (Should tier)', 'lib/eval/*, app/settings/eval', '016, 019, 020', '3', 'npm run eval scores all tasks vs thresholds; EvalRun rows visible; promotion gate enforced in UI'],
            ['WO-035', 'Provider test buttons + spend chart + budget warning SSE', 'app/settings/providers, /api/providers/*', '015', '1', 'FR-021/022 surfaces complete; unhealthy provider states render per Ch. 7'],
            ['WO-036', 'Backup job + restore drill script + Data and backup screen', 'scripts/backup*, app/settings/data', '007', '2', 'NFR-10: backup in 2 commands; restore drill passes on scratch dir; snapshot list renders'],
            ['WO-037', 'Export bundle (FR-024) with redaction scope ALL', 'lib/export/*, /api/system/export', '033', '1', 'Bundle imports into a fresh clone (reconstruction test); keys absent by schema'],
            ['WO-038', 'Performance suite: RTF, p95, search-at-1k, startup', 'perf/*', '030, 010', '2', 'NFR-01/02/03/12 thresholds measured and logged; failures block phase acceptance'],
            ['WO-039', 'E2E full-journey suite + SIGKILL crash drill at each stage', 'e2e/*', 'all prior', '2', 'FR-008 proven per stage boundary; happy path under 5 minutes; nightly job scheduled'],
            ['WO-040', 'Runbook dry-run + dogfood week + v2 backlog harvest', 'docs/runbook, CHANGELOG', 'all prior', '2', 'Ch. 10 dry-run checklist executed and dated; 5 real calls processed end-to-end; friction notes filed to v2 list, not the plan'],
        ],
    }),
    ('h2', 'Project definition of done and change control'),
    ('p', 'The project is done when this list passes in order, on the reference machine, from a clean clone: all forty work orders\' DoDs green; every FR acceptance criterion demonstrated at least once in the E2E suite; the eval harness green on active prompts (Table 6.5 thresholds); the performance suite green (Table 2.6 NFR thresholds); the egress and crash-safety invariants green; the runbook dry-run executed with a dated checklist; and five real calls processed end-to-end from upload to archived. That final state is the answer to "when can I stop planning and call it built" - and it is fully reachable with the materials in this dossier.'),
    ('table', {
        'caption': 'Table 12.7 - Change control: what can change without re-planning',
        'headers': ['Change', 'Allowed path', 'Re-plan needed?'],
        'ratios': [0.34, 0.44, 0.22],
        'rows': [
            ['Prompt wording, model ids, catalog chains', 'Settings/models.yaml + eval gate before activation', 'No'],
            ['Rubric weights, competitor list, price tables, budget cap', 'Setting edit, versioned where history matters', 'No'],
            ['Bug fixes that preserve FR acceptance criteria', 'Normal work order + regression test', 'No'],
            ['New insight types, screens, or endpoints', 'v2 backlog list - explicitly out of current plan', 'Only when v2 starts'],
            ['Changes to an FR\'s acceptance criterion', 'Change request against Ch. 2, eval impact assessed first', 'Yes - this dossier'],
            ['Schema changes beyond additive', 'Ch. 4 migration policy (add, backfill, later remove)', 'No, if policy followed'],
            ['Architecture reversals (monolith, SQLite, adapters)', 'Stop; write v3 blueprint', 'Yes - a new volume'],
        ],
    }),
    ('p', 'Forty work orders, one hundred and one focus blocks, six phases, one builder. The plan is complete: every artifact it needs exists in these twelve chapters, every requirement carries its test, every risk has its mitigation, and every session between here and "built" has a name and a definition of done. The next action on this project is not another document - it is WO-001.'),
]
