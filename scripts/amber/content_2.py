# -*- coding: utf-8 -*-
"""AMBER blueprint content — Chapters 4-6 (Hybrid AI Engine, Data Model, Feature Specifications)."""

C4 = [
    ('h1', 'Hybrid AI Engine (Cloud and Local)'),
    ('p', 'The hybrid engine is AMBER\'s heart, and it exists to satisfy one rule you set at kickoff: the system must run on both cloud APIs and local models, and it must prefer local unless there is a reason. The engine is built as three cooperating pieces. A provider registry knows every adapter - local and cloud - along with its capabilities, costs, and health. A per-task policy table, editable in Settings, decides for each AI task which tier serves it by default and when escalation is permitted. A router executes the policy: attempt, validate, escalate on failure or policy trigger, and log every run for cost and latency telemetry.'),
    ('p', 'The provider abstraction is intentionally narrow. Every adapter implements four operations - chat, structured chat (JSON-schema constrained output), embed, and transcribe - plus a health check. Five adapters ship in v1: Ollama (local, OpenAI-compatible REST), OpenAI, Anthropic, Gemini, and a generic OpenAI-compatible adapter that covers Groq, DeepSeek, Together, LM Studio, or a personal proxy by URL and key alone. Because Ollama speaks the OpenAI wire format, the local and generic-cloud adapters share nearly all their code, which is exactly the kind of leverage a small system should extract from a lucky standard.'),
    ('table', {
        'caption': 'Table 4 - Provider registry as configured by default',
        'headers': ['Provider', 'Type', 'Default role in AMBER'],
        'ratios': [0.22, 0.16, 0.62],
        'rows': [
            ['Ollama (localhost:11434)', 'Local', 'Default chat, structured extraction, and embeddings; serves every task that does not explicitly demand cloud'],
            ['OpenAI-compatible (custom)', 'Cloud', 'First escalation tier for analysis-class tasks; also the shape used for Groq, DeepSeek, Together, LM Studio, proxies'],
            ['Anthropic', 'Cloud', 'Long-context deep analysis; a 200K-class window swallows a two-hour transcript in one pass'],
            ['OpenAI', 'Cloud', 'Premium analysis tier and cloud STT (Whisper API) when local transcription is not available'],
            ['Gemini', 'Cloud', 'Budget-friendly analysis chain and multimodal experiments; generous free tier suits a personal system'],
        ],
    }),
    ('figure', {'path': 'fig2_routing.png', 'caption': 'Figure 2 - Routing decision flow. The local path is attempted first under policy; validation failures and policy triggers send the task down the cloud failover chain, and every run is persisted with telemetry.', 'max_h': 300}),
    ('p', 'Escalation triggers are enumerated, not vibes. A task escalates when: the payload exceeds the local model\'s effective context; the task\'s policy tier is set to cloud-only; the local attempt fails validation twice (a malformed JSON schema, an empty extraction, a quality score below threshold); the monthly cloud budget has room and the task is marked cost-insensitive; or you flipped the per-call "deep analysis" switch. Conversely, cloud never sees audio: STT runs locally by default, and when text goes to a cloud provider an optional redaction pass first strips names, emails, phone numbers, and any custom patterns you define. The redacted map is kept locally so insights can be re-identified on your screen only.'),
    ('table', {
        'caption': 'Table 5 - Routing policy per AI task (defaults, editable)',
        'headers': ['Task', 'Local default', 'Escalates when', 'Cloud fallback chain'],
        'ratios': [0.26, 0.24, 0.27, 0.23],
        'rows': [
            ['Transcription (STT)', 'whisper.cpp / faster-whisper, small-or-better', 'Local engine absent; user sets cloud STT', 'Whisper API (OpenAI)'],
            ['Diarization relabel', 'Local 7-8B class LLM', 'Never in v1', 'n/a (heuristic output stands)'],
            ['Summary + meeting notes', 'Local 7-8B class', 'Context overflow only', 'OpenAI-compat, then Anthropic'],
            ['Deep call analysis', 'Local attempt first', 'Quality gate fails; deep switch on', 'OpenAI-compat, Anthropic, Gemini'],
            ['MEDDIC extraction', 'Local 7-8B, structured JSON', 'Validation fails twice', 'Anthropic (200K), then OpenAI-compat'],
            ['Objection + sentiment pass', 'Local 7-8B, structured JSON', 'Quality gate fails', 'OpenAI-compat, then Gemini'],
            ['Follow-up email draft', 'Local 7-8B', 'Never forced; button to regenerate on cloud', 'OpenAI-compat'],
            ['Embeddings (indexing + search)', 'nomic-embed-text via Ollama', 'Never in v1', 'n/a'],
        ],
    }),
    ('p', 'The economics deserve their own figure, because they are the quiet argument for the whole project. The chart below compares the estimated marginal cost of processing one 30-minute call across routing strategies, using public list prices as of October 2026 and the assumptions in Table 6. The local stack costs about a cent of electricity. The hybrid strategy - local STT with one cloud deep-analysis pass - costs roughly four cents. Even the most profligate all-cloud chain stays under a quarter. And the amber line at the top is what a Gong seat costs per call once its publicly reported fees are amortized: it is not in the same sport.'),
    ('figure', {'path': 'fig3_cost.png', 'caption': 'Figure 3 - Estimated marginal cost per processed 30-minute call by routing strategy (USD, list prices, Oct 2026). Gong figures derive from third-party pricing analyses; treat as estimates and verify.', 'max_h': 250}),
    ('table', {
        'caption': 'Table 6 - Cost model assumptions (all figures editable in Settings)',
        'headers': ['Assumption', 'Value', 'Basis'],
        'ratios': [0.34, 0.22, 0.44],
        'rows': [
            ['30-minute call transcript', 'about 4,500 words, 6,000 tokens', 'Typical conversational speaking rate'],
            ['Deep analysis call', '8,000 tokens in, 1,500 out', 'Transcript + rubric + few-shot exemplars'],
            ['Whisper cloud STT', '$0.006 per minute', 'Public list price; verify at build time'],
            ['Analysis-tier LLM pricing', '$2.50 / $10 per 1M tokens in / out', 'GPT-4o-class public list; Gemini-flash and Sonnet-class priced proportionally'],
            ['Local run', 'about $0.01 electricity per call', 'Desktop-class machine, no per-token charge'],
            ['Gong comparison', '$1,600 seat + $5,000 platform, 500 calls/yr', 'Publicly reported 2026 pricing analyses (Claap, Oliv, Outdoo); upper end of reported range'],
        ],
    }),
    ('p', 'Model currency is a standing risk, so the engine treats model names as configuration, never as code. The catalog in the Appendix names the local model classes verified current as of October 2026 - the Qwen3 family around 8B, gpt-oss:20b for 16 GB machines, nomic-embed-text for embeddings - but the policy table stores whatever you pull. A one-line settings change re-points every task at a new model, and the run log tells you afterward whether quality moved. That is the entire upgrade story: AMBER never needs to be rebuilt to ride the next model wave.'),
]

C5 = [
    ('h1', 'Data Model'),
    ('p', 'The schema is designed around one reading: a call is a tree, and everything else in the system is either a branch of that tree or a lens over many trees. Transcripts belong to calls; insights belong to transcripts; deals and contacts are the entities the calls are about, and they collect calls over time. The design keeps the hot path - the call detail view - to a single query with eager relations, and it keeps the cold path - search - to a vector scan over transcript chunks. Below is the core of the Prisma schema for v1, trimmed to the essential fields; the full file lives in the repository scaffold this blueprint hands to the build phase.'),
    ('code', {
        'caption': 'Schema 1 - Core Prisma models (v1, trimmed)',
        'text': """model Deal {
  id            String   @id @default(cuid())
  title         String
  company       String?
  stage         String   @default("discovery")   // discovery..won/lost
  value         Float?
  currency      String   @default("EUR")
  meddic        Json?    // metrics, economicBuyer, decisionCriteria, ...
  riskFlags     Json?    // [{code, severity, note, callId?}]
  nextStep      String?
  nextStepDate  DateTime?
  contacts      Contact[]
  calls          Call[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Call {
  id           String   @id @default(cuid())
  dealId       String?
  deal         Deal?    @relation(fields: [dealId], references: [id])
  title        String
  occurredAt   DateTime @default(now())
  mediaHash    String   @unique          // SHA-256, de-dup key
  audioPath    String                    // media vault, content-addressed
  durationSec  Int
  status       String   @default("queued") // queued|normalizing|transcribing|analyzing|done|failed
  stage        Int      @default(0)        // resumable pipeline cursor
  transcript   Transcript?
  insights     Insight[]
  scorecard    Scorecard?
  notes        Note[]
  runs         ProviderRun[]              // telemetry per AI call
}

model Transcript {
  id        String    @id @default(cuid())
  callId    String    @unique
  call      Call      @relation(fields: [callId], references: [id])
  language  String    @default("en")
  text      String                     // full plain text
  segments  Segment[]
  embeddingIds Json?                   // vector chunk ids
}

model Segment {
  id        String    @id @default(cuid())
  transcriptId String
  speaker   String                    // "you" | "prospect" | "other" | learned name
  startMs   Int
  endMs     Int
  text      String
}

model Insight {
  id        String    @id @default(cuid())
  callId    String
  kind      String    // topic|objection|sentiment|meddic|risk|question|keyword
  payload   Json      // typed per kind
  confidence Float
  span      Json?     // [startMs, endMs] when locatable
}

model Scorecard {
  id       String  @id @default(cuid())
  callId   String  @unique
  rubric   Json    // criterion -> {score, weight, evidence}
  total    Float
}""",
    }),
    ('p', 'A few modeling decisions earn their explanation. Insight rows are a single polymorphic table keyed by kind rather than one table per insight type; personal scale never stresses this, and it keeps the analysis prompt contract - one JSON document per call - mapped trivially to storage. ProviderRun rows exist for every AI invocation with provider, model, latency, token counts, and estimated cost; they are what turn the cost chart from an estimate into a measurement, and they are the only telemetry AMBER keeps, entirely on your disk. Embeddings are stored as BLOB columns with chunk text and call reference; retrieval is brute-force cosine over them because at hundreds of calls the scan is milliseconds and adds zero dependencies.'),
    ('table', {
        'caption': 'Table 7 - Core entities and their purpose',
        'headers': ['Entity', 'Purpose', 'Notable fields'],
        'ratios': [0.18, 0.48, 0.34],
        'rows': [
            ['Deal', 'The opportunity a set of calls advances', 'stage, value, meddic Json, riskFlags, nextStep + date'],
            ['Contact', 'Person on the other side', 'name, role, email; links deal and calls'],
            ['Call', 'One recorded conversation', 'mediaHash (unique), status, stage cursor for resumability'],
            ['Transcript / Segment', 'The words, with speaker turns', 'segments with startMs/endMs per line'],
            ['Insight', 'One extracted finding', 'kind, payload, confidence, optional time span'],
            ['Scorecard', 'Rubric evaluation for one call', 'rubric Json with per-criterion evidence'],
            ['Note / FollowUpDraft', 'Human-editable outputs', 'editable text; drafts regenerate on demand'],
            ['ProviderRun', 'Telemetry per AI invocation', 'provider, model, latency, tokens, cost estimate'],
            ['Setting', 'Policy table and model config', 'JSON blobs per task; never secrets'],
        ],
    }),
    ('p', 'Deletion is designed, not bolted on. Deleting a call cascades to its transcript tree, insights, scorecard, and vault file; deleting a deal keeps calls but detaches them, because a conversation happened even if the opportunity died. A prospect\'s data can be purged on request by deleting their contact and cascading - and the retention chapter specifies why, in the EU, you should assume that duty applies to you. Backups are one SQLite file plus the vault directory; copying both is a complete, restorable AMBER.'),
]

C6 = [
    ('h1', 'Feature Specifications - Four Pillars'),
    ('p', 'This chapter is the build contract for v1: each pillar is specified as a user flow, the AI tasks it consumes (all defined in Table 5), the interface it renders, and the MVP line where later work starts. The through-line for every pillar is the same discipline: deterministic computation wherever arithmetic suffices, model judgment only where language understanding is genuinely required, and every model output carrying a confidence you can see.'),
    ('h2', 'Pillar 1 - The Core Loop'),
    ('p', 'The loop begins at the Upload Inbox: drag a recording in, and AMBER computes its hash, checks it against the vault for de-duplication, asks (when filename heuristics fail) which deal and contact to attach it to, and enqueues processing. Progress renders as a staged indicator - normalizing, transcribing, analyzing, done - each stage persisting its output so an interrupted run resumes rather than restarts. When the call completes, you land on the Call Detail view: the transcript on the left with speaker turns, timestamps, and clickable highlights; the metric strip above it; and tabs for insights, notes, and the follow-up draft on the right.'),
    ('p', 'The metric strip is the part that must never lie, so none of it is model-generated. Talk-listen ratio, longest monologue, questions asked, words per minute, and per-speaker speaking time are all computed from Segment timings - pure arithmetic, reproducible to the millisecond, immune to model drift. What the models produce sits beneath the strip, clearly labeled: topics with spans, objections with the exact sentences that raised them, sentiment per span rather than a misleading whole-call average, and keywords with counts. Every insight chip links to its evidence span in the transcript; tapping it seeks the audio to that moment, because the point of analysis is to hear the moment again.'),
    ('p', 'The notes and follow-up draft close the loop. Meeting notes are generated from the transcript with a prompt you can read and edit in Settings; they render as an editable document with a copy button and a plain .md export. The follow-up email draft is persona-aware: it references the prospect\'s stated problems, the commitments made, and the next step with its date, and it regenerates with one click - on local by default, on cloud by choice. In v1 these drafts are the end of the automation; auto-sending anything is deliberately out of scope, because the one-person version of AMBER should draft, not act.'),
    ('h2', 'Pillar 2 - Deal Intelligence'),
    ('p', 'Deal intelligence turns calls into a living pipeline. The MEDDIC extraction runs on every call linked to a deal and updates the deal\'s fields: metrics the prospect volunteered, economic buyer (named or suspiciously absent), decision criteria and process, identified pain, and champion (named or absent). Because extraction is structured JSON with confidence, the deal view shows not just the value but the evidence - each field links to the span in the call where it was learned, and stale fields (nothing new in 14 days) fade visually. The pipeline board is a local kanban over stages you define; drag-and-drop updates stage, and wins/losses write a closure note automatically.'),
    ('p', 'Risk flags are rules plus inference, in that order. Deterministic rules fire first: no next step set within 24 hours of a call ends; a next step date that passed without a following call; single-threaded - every call with the same one contact; budget never discussed across all calls on a deal; two consecutive calls with declining sentiment. The model layer then writes risk notes attached to spans (a hesitation pattern, a competitor mention without a rebuttal). Flags render on the board as severity chips, and each flag links to the exact calls that raised it. The deal timeline at the bottom of the deal view is auto-built: one row per call and per stage change, newest first - the story of the deal, assembled without anyone writing it.'),
    ('h2', 'Pillar 3 - Coaching'),
    ('p', 'Coaching in a one-person system means comparing you to you. The scorecard rubric is fully user-owned: a default set ships - next step set, question rate above target, talk ratio within your band, objections answered rather than deflected, discovery before pitch - and every criterion carries a weight you set. Scoring a call runs the rubric prompt with the transcript and writes per-criterion evidence links, so "question rate: 6, below target 10" comes with the six questions highlighted in place. The rubric edit screen is where coaching strategy lives; AMBER never hides the rubric the way closed products do.'),
    ('p', 'Trends render as small multiples over the metric strip history: scorecard total, talk ratio, question rate, objection-handling rate, all on a per-week basis with a target band you set per metric. The best-practice library is the compounding asset: save any transcript span as a snippet with a tag (objection handled well, discovery sequence, pricing defense), and the library indexes it by embedding so "how did I handle the budget pushback last quarter" retrieves your own moments, not a generic coach\'s. Gong needs a team for this feature to make sense; a single user with a growing library gets more from it, not less.'),
    ('h2', 'Pillar 4 - The Library'),
    ('p', 'The library is search over everything you have ever said on a call. Semantic search runs the query through the same embedding model as indexing (local, always) and returns transcript chunks ranked by cosine similarity, each result showing the call, the date, the linked deal, and the matched span with the query terms effectively highlighted by proximity. Filters compose: by date range, by deal, by contact, by insight kind (only moments flagged as objections), by sentiment span, and by scorecard score band. Saved searches pin to the sidebar - "lost deals, pricing objections" is one click away forever.'),
    ('p', 'The MVP line for the library is deliberately conservative: no cross-call theme clustering, no auto-generated topic taxonomy, no "ask my history anything" chat agent in v1. Those are attractive and all buildable on the same vectors later; they are deferred because the retrieval core must first prove itself in daily use. The test the library must pass is simple: three months in, when you wonder how a phrase landed six weeks ago, the answer arrives before the memory of asking the question fades. That is the whole feature; everything beyond it is ornament.'),
]
