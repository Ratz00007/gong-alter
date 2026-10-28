# -*- coding: utf-8 -*-
"""AMBER blueprint content — Chapters 7-10 (Design System, Security & Legal, Roadmap & Risk, Appendix)."""

C7 = [
    ('h1', 'Design System - Warm Calm'),
    ('p', 'The visual direction you selected - Warm Calm, in the family of Arc and Cron - is a strategy, not a mood. Revenue tools are built to make operators anxious: dense dark dashboards, urgency reds, alert bells. AMBER inverts that. You will spend real time reading your own conversations here, often at night, often right after a call went badly. The interface should feel like paper and lamplight: warm neutrals, generous rounding, unhurried motion, and color reserved for meaning. Calm is also a legibility strategy - a page that does not shout can afford to say more.'),
    ('table', {
        'caption': 'Table 8 - Warm Calm core tokens (app design system)',
        'headers': ['Token', 'Value', 'Usage'],
        'ratios': [0.30, 0.28, 0.42],
        'rows': [
            ['bg / paper', '#FAF7F2', 'App canvas; the "cream paper" base'],
            ['bg / raised', '#F3EDE5', 'Cards, sheets, the inbox surface'],
            ['ink / primary', '#2A2520', 'Body text and headings; never pure black'],
            ['ink / secondary', '#6E665D', 'Metadata, timestamps, disabled states'],
            ['accent / amber', '#C96F3B', 'Primary actions, active states, links; the only loud color'],
            ['accent / deep', '#8A5A2E', 'Hover and pressed states of amber'],
            ['success / warn / risk', '#5C8A64 / #C2A24B / #B0574D', 'Muted, desaturated; risk red never saturates'],
            ['line / hairline', '#E7DFD4', '1px borders; separation without weight'],
            ['radius', '12 / 16 / 24 px', 'Controls / cards / sheets; rounding is the warmth carrier'],
            ['type / display', 'Fraunces 600-700', 'Page titles, deal names, the "editorial" voice'],
            ['type / UI + body', 'Inter 400-600', 'Interface text and transcripts; tabular numerals for all metrics'],
            ['mono / data', 'JetBrains Mono', 'Timestamps, hashes, token counts'],
            ['motion', '150-250 ms, ease-out', 'Hover lifts 1px, sheets slide 12px; nothing bounces'],
        ],
    }),
    ('p', 'Two rules carry most of the aesthetic weight. First, amber is rationed: it marks interactive things and active things, nothing else - a page at rest is almost entirely warm neutral, so a single amber element reads as an invitation. Second, numbers are always tabular: metrics, timings, and scores render in tabular numerals so columns of figures align like set type. Both rules exist because the transcript view is the product; it must survive hours of reading without fatigue, and everything else in the system yields to that priority.'),
    ('bullets', [
        'CallCard - inbox and library rows: date, deal, duration, score chip, three-line transcript preview.',
        'TranscriptSegment - speaker chip, timestamp (mono), text; active highlight in amber at 8% tint.',
        'InsightChip - kind-colored at low saturation, always links to its evidence span.',
        'ScoreRing - the scorecard total as a ring, rubric detail one tap away.',
        'PipelineBoard - columns of DealCards; risk chips summarize each deal\'s open flags.',
        'StatStrip - the deterministic metrics band; every figure tabular, every figure auditable by click.',
    ]),
    ('p', 'Accessibility is part of calm, not in tension with it. All text meets 4.5:1 contrast on the paper tones (the ink pair was chosen to clear it with margin); focus rings are 2px amber and never removed; transcript text sits at 16px minimum with 1.6 line height. A dark theme is deferred, not rejected - a warm dark done well is a real project, and shipping a bad one early would betray the whole direction. Internationalization is structural (all strings externalized from day one) but v1 ships English only.'),
]

C8 = [
    ('h1', 'Security, Privacy and Legal'),
    ('p', 'AMBER\'s privacy posture is a consequence of its architecture, not a policy bolted on. Audio and video files never leave the machine that runs AMBER; by default every model that touches a call runs locally, and when a task escalates to a cloud provider, what crosses the network is text - a transcript excerpt, not a recording - with an optional redaction pass applied first. API keys live in the OS keychain (or a .env file git-ignored by the scaffold) and never in the database, never in logs, never in telemetry - and there is no telemetry: no crash reporter, no analytics, no "phone home" of any kind, because a personal tool has nobody to report to.'),
    ('bullets', [
        'Keys: OS keychain or .env; the Settings UI writes them there and displays only masked values.',
        'Redaction: configurable patterns (names, emails, phones, custom regex) applied before any cloud call; the redaction map stays local so insights re-identify on your screen only.',
        'Budget: a monthly cloud spend cap in Settings; the router refuses escalation when the cap is hit, and the refusal is visible in the run log.',
        'At rest: the SQLite file and vault inherit full-disk encryption (FileVault / BitLocker); SQLCipher is a documented upgrade if you want the database itself encrypted.',
        'Backups: one file plus one folder; copy both and you hold the entire system.',
    ]),
    ('p', 'The legal section is short and serious, and it is not legal advice. You are in the EU, and two regimes matter. Recording consent: many EU jurisdictions require the knowledge or consent of participants for recording; the safest durable practice is to state at the top of a call that it is being recorded - most meeting platforms can display a standing notice, and honesty ages better than cleverness. GDPR: your transcripts contain other people\'s personal data. That gives you duties in practice - purpose limitation (your own coaching), retention limits you actually enforce, and deletion on request: the data model\'s contact-cascade delete exists precisely so "please delete everything about me" is one command, honored honestly.'),
    ('p', 'Treat the following as the compliance floor for personal use: keep recordings only as long as they serve your coaching and deal work; when a relationship ends, delete the contact cascade; never move raw audio to a cloud provider, even a trusted one, unless you have decided the trade-off consciously; and if you ever share a transcript outside AMBER, share it redacted. The system is built so that the private-by-default path is also the path of least resistance - that alignment between convenience and correctness is the entire security design.'),
]

C9 = [
    ('h1', 'Build Roadmap and Risk Register'),
    ('p', 'The roadmap is phrased in focused sessions - long, undistracted working blocks of roughly three hours - because for a personal project, calendar time is a fiction and attention is the real currency. The sequence below is dependency-ordered, not priority-ordered: each phase produces something usable on its own, so the project can stop after any phase and what exists is already worth having. The estimates assume the blueprint in hand (this document), which is the point of writing it first.'),
    ('table', {
        'caption': 'Table 9 - Phase plan with exit criteria',
        'headers': ['Phase', 'Scope', 'Exit criteria', 'Effort'],
        'ratios': [0.14, 0.40, 0.32, 0.14],
        'rows': [
            ['P0 Foundations', 'Scaffold, Prisma schema, vault, upload + hash + queue, pipeline skeleton with resumable stages', 'A file lands in the vault, a call row walks stages, restart resumes mid-flight', '3-4 sessions'],
            ['P1 Core loop', 'whisper.cpp wiring, transcript view with speakers and timestamps, deterministic metric strip', 'A 30-min call produces a readable transcript and honest metrics, fully offline', '4-5 sessions'],
            ['P2 Intelligence', 'Provider registry + five adapters, policy table, router with escalation, insight prompts + validation', 'Insights with evidence spans render; run log records cost and latency', '4-6 sessions'],
            ['P3 Deal + Library', 'MEDDIC extraction, risk rules, board, deal timeline; embeddings + semantic search + filters', 'A query retrieves the right span across all calls; board shows live flags', '4-5 sessions'],
            ['P4 Coaching', 'Rubric screen, scorecard generation, trend charts, best-practice snippets', 'Scorecards accumulate; trends answer "am I improving" honestly', '3-4 sessions'],
            ['P5 Polish', 'Notes + follow-up drafts, saved searches, exports (.md/.eml), Warm Calm pass over every surface', 'The whole loop feels deliberate; nothing requires a terminal', '3-4 sessions'],
        ],
    }),
    ('p', 'Twenty to twenty-eight sessions for the full v1 is the honest envelope; the midpoint is roughly three months of focused weekends. The risk register below names the things most likely to bend that line, with mitigations that are already reflected in the architecture rather than promises to be careful.'),
    ('table', {
        'caption': 'Table 10 - Risk register',
        'headers': ['Risk', 'Likelihood', 'Impact', 'Mitigation'],
        'ratios': [0.34, 0.13, 0.13, 0.40],
        'rows': [
            ['Local diarization quality disappoints on 3+ speaker calls', 'High', 'Medium', 'Ships as heuristic + LLM relabel; WhisperX-style VAD + forced alignment is the documented upgrade path (sidecar)'],
            ['CPU-only STT too slow on long calls', 'Medium', 'Medium', 'Policy defaults to small-class models on CPU; distil-class cuts time ~6x at ~1% WER cost; GPU machines auto-select large-class'],
            ['Model drift: catalog names age quickly', 'Certain', 'Low', 'Models are configuration, not code; Appendix catalog is dated and the run log verifies quality after any swap'],
            ['Structured outputs fail schema too often locally', 'Medium', 'Medium', 'Validation + one retry, then escalation (Table 5); prompt registry with few-shot exemplars tuned per task'],
            ['Scope creep - the personal-project classic', 'High', 'High', 'This blueprint is the contract; new ideas enter a v2 list, never the current phase'],
            ['Cloud API cost surprises', 'Low', 'Low', 'Monthly cap in Settings; run log makes spend visible per call; local-first means cloud is opt-in by construction'],
            ['Consent/GDPR exposure from recordings', 'Low', 'High', 'Standing record notice; contact-cascade deletion; redaction before any cloud text leaves the machine'],
        ],
    }),
    ('p', 'One meta-risk deserves its own sentence: the temptation to build infrastructure before the loop. Every phase above produces user-visible value, and the sequence deliberately puts transcription and the metric strip before anything intelligent, because the moment AMBER shows you your own call honestly is the moment it earns the rest of the work.'),
]

C10 = [
    ('h1', 'Appendix - Hardware, Models, Costs, Glossary'),
    ('p', 'This appendix holds the reference tables the build phase will reach for, plus the glossary for future-you reading this document after the stack has inevitably moved on. All model names reflect the Ollama library and public cloud tiers as of October 2026; the model-currency rule in Chapter 4 - models are configuration - is what keeps this appendix advisory rather than load-bearing.'),
    ('table', {
        'caption': 'Table 11 - Hardware tiers',
        'headers': ['Tier', 'Specification', 'What to expect'],
        'ratios': [0.18, 0.38, 0.44],
        'rows': [
            ['Minimum', '16 GB RAM, modern 6-core CPU, any recent iGPU', 'small-class STT near real time after processing; 7-8B local LLM at usable speeds; embeddings trivial'],
            ['Recommended', '32 GB RAM, 8 GB+ VRAM GPU (RTX-class or Apple Silicon unified 24 GB+)', 'large-class STT faster than real time; deep-analysis prompts run locally with headroom for longer calls'],
            ['CPU-only note', 'distil-class STT models', 'About 6x faster than large at roughly 1% word-error cost - the right default when no GPU is present'],
        ],
    }),
    ('table', {
        'caption': 'Table 12 - Model catalog by task (October 2026)',
        'headers': ['Task', 'Local default class', 'Cloud fallback class'],
        'ratios': [0.28, 0.40, 0.32],
        'rows': [
            ['General LLM (analysis, notes, relabel)', 'Qwen3 family 7-8B; gpt-oss:20b on 16 GB machines (128K context)', 'GPT-4o-class / Sonnet-class (200K) / Gemini 2.x-class'],
            ['Speech-to-text', 'Whisper small-or-better via whisper.cpp; faster-whisper large-v3 on GPU', 'Whisper API (text-only, never audio, by policy)'],
            ['Embeddings', 'nomic-embed-text (the library default, 274 MB); mxbai-embed-large if quality disappoints', 'None - embeddings never leave the machine in v1'],
            ['Structured extraction', 'Same as general LLM, JSON-schema constrained', 'Same chain as analysis; Anthropic preferred for long transcripts'],
        ],
    }),
    ('p', 'The cost figure worth internalizing is not any single row of Table 6 - it is the shape: local marginal cost is effectively zero, cloud marginal cost is cents, and both are so far below any seat-based commercial product that cost should never be the reason a task runs locally; privacy and ownership should be, and are. Verify every list price at build time; the assumptions table is one settings screen, and the run log will replace estimates with measurements within your first ten calls.'),
    ('bullets', [
        'STT (speech-to-text) - converting recorded audio to timestamped text.',
        'Diarization - attributing text spans to speakers ("who said what").',
        'MEDDIC - a qualification framework: Metrics, Economic buyer, Decision criteria/process, Identify pain, Champion.',
        'Embedding / vector - a numeric representation of text enabling semantic (meaning-based) search.',
        'RTF (real-time factor) - processing time divided by audio duration; below 1.0 means faster than real time.',
        'Structured output - model output constrained to a JSON schema the code can validate.',
        'Redaction - stripping identifiers (names, emails, phones, custom patterns) before text leaves the machine.',
    ]),
    ('p', 'Final word to the builder, from the team that wrote this: keep the loop honest. The metric strip must stay deterministic; the prompts must stay visible; the router must stay local-first; the design must stay warm. Everything else in this blueprint is negotiable with experience - those four properties are the product\'s character, and they are the reason a personal system can honestly call itself better rather than merely cheaper.'),
]
