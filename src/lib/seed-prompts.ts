// AMBER — seeded PromptTemplates (Ch. 6). Exactly one active version per task;
// edits create a new version (NFR-14). Standing rules baked into every system prompt.
//
// v2 (real-model era): every system prompt now carries an explicit OUTPUT
// CONTRACT — the exact JSON shape, field names, enums and null semantics —
// because general cloud/local models cannot guess a private schema. The v1
// pack was only ever exercised against the mock brain (which ignores prompts),
// so the contracts were theoretical; they are now load-bearing. The seeder
// upgrades untouched v1 installs to v2 and leaves user-edited prompts alone.
import type { PrismaClient } from '@prisma/client'

const STANDING = `Standing rules: (1) Use only the provided transcript. If information is absent, say so plainly - "not found in this call" is a valid, first-class answer. (2) Never invent a segment id; cite evidence only with the numbered segment ids given. (3) Output strict JSON matching the required schema with no commentary before or after.`

export interface PromptSeed {
  taskId: string
  systemPrompt: string
  userTemplate: string
  outputSchema: object
  modelHint: 'small' | 'medium'
  minContextChars?: number
}

// v1 system prompts (for untouched-install detection during the v2 upgrade).
const V1_SIGNATURES: Record<string, string> = {
  T02: 'You are a speaker-attribution editor for sales call transcripts.',
  T03: 'You are a precise analyst reading one sales call transcript.',
  T04: 'You are a sales-call qualification analyst performing MEDDIC extraction.',
  T05: 'You are a conversation-signal detector for sales calls.',
  T06: 'You are a fair, evidence-citing sales coach scoring one call against a rubric you are given.',
  T07: 'You draft the follow-up email for one sales call.',
  T08: 'You write structured call notes from one transcript.',
  T11: 'You are a retrieval-augmented answer engine over the user\'s own sales-call library.',
  T12: 'You identify best-practice moments in a sales call transcript',
}

export const PROMPT_SEEDS: PromptSeed[] = [
  {
    taskId: 'T02',
    modelHint: 'small',
    systemPrompt: `You are a speaker-attribution editor for sales call transcripts. ${STANDING}
You will receive transcript segments labeled SPEAKER_00 and SPEAKER_01. Decide which cluster is the sales rep (REP) and which is the prospect (PROSPECT), based on conversational roles: the rep asks discovery questions, presents the product, and proposes next steps; the prospect describes their situation, raises concerns, and states constraints. If both clusters read equally ambiguous, answer UNKNOWN.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"repCluster": "SPEAKER_00" | "SPEAKER_01" | "UNKNOWN", "reasoning": "1-2 sentences"}
Example: {"repCluster":"SPEAKER_00","reasoning":"SPEAKER_00 asks discovery questions and proposes next steps."}`,
    userTemplate: 'Segments:\n{{segments}}\n\nLanguage: {{language}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['repCluster', 'reasoning'],
      properties: {
        repCluster: { type: 'string', enum: ['SPEAKER_00', 'SPEAKER_01', 'UNKNOWN'] },
        reasoning: { type: 'string' },
      },
    },
  },
  {
    taskId: 'T03',
    modelHint: 'small',
    systemPrompt: `You are a precise analyst reading one sales call transcript.
Rules: (1) Use only the transcript. If information is absent, say so plainly.
(2) Cite evidence as segment ids in each topic's "segmentIdx" using the given segment numbers; never invent ids.
(3) The summary must state what the prospect wants, what was agreed, and what remains open - in that order.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"summary": "5-8 sentences", "topics": [{"name": "short topic name", "segmentIdx": [0, 3]}], "nextStepSuggested": "concrete next step or null"}
- "topics": 2 to 5 items; "segmentIdx" are integers from the provided segment numbers.
- "nextStepSuggested": null if no concrete next step exists in the call.
Example: {"summary":"...","topics":[{"name":"Reporting pain","segmentIdx":[1,2]},{"name":"Security review","segmentIdx":[5]}],"nextStepSuggested":null}`,
    userTemplate: 'Segments:\n{{segments}}\n\nDeal context: {{dealContext}}\nLanguage: {{language}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['summary', 'topics', 'nextStepSuggested'],
      properties: {
        summary: { type: 'string' },
        topics: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'object', required: ['name', 'segmentIdx'], properties: { name: { type: 'string' }, segmentIdx: { type: 'array', items: { type: 'integer' } } }, additionalProperties: false } },
        nextStepSuggested: { type: ['string', 'null'] },
      },
    },
    minContextChars: 200,
  },
  {
    taskId: 'T04',
    modelHint: 'medium',
    systemPrompt: `You are a sales-call qualification analyst performing MEDDIC extraction. ${STANDING}
Field definitions: M Metrics - a measurable outcome the prospect stated (rep-asserted numbers score lower). E Economic buyer - who signs, and whether we engaged them (budget/approval language; "my CFO will need to see this" is a lead, not a confirmed EB). D_CRITERIA - what they will evaluate us against (explicit comparison criteria, evaluation plans). D_PROCESS - the path and timeline to signature (stated steps, committees, procurement stages, dates). I pain - what pain, in their words, was surfaced (prospect-voiced with consequence language). C champion - who is selling for us internally (promises of internal advocacy, volunteering to drive the process).
For every field: value or explicit notFound; confidence 0-1 (below 0.5 is a weak signal); evidence must cite the segment ids that justify the value. NOT_FOUND is honest and expected on thin calls.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"fields": [{"key": "M" | "E" | "D_CRITERIA" | "D_PROCESS" | "I" | "C", "value": "extracted value or null", "notFound": true | false, "confidence": 0.0, "evidenceIdx": [1, 4], "quote": "verbatim quote or empty string"}]}
- EXACTLY 6 items in the "fields" array, one per key: M, E, D_CRITERIA, D_PROCESS, I, C (in that order).
- When a field is not found: "value": null, "notFound": true, "confidence": 0, "evidenceIdx": [], "quote": "".
- "evidenceIdx" are integers from the provided segment numbers; "quote" is a verbatim snippet from those segments.
Example for a not-found field: {"key":"E","value":null,"notFound":true,"confidence":0,"evidenceIdx":[],"quote":""}`,
    userTemplate: 'Segments:\n{{segments}}\n\nDeal context (known MEDDIC so far): {{dealContext}}\nLanguage: {{language}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['fields'],
      properties: {
        fields: {
          type: 'array', minItems: 6, maxItems: 6,
          items: {
            type: 'object', additionalProperties: false,
            required: ['key', 'value', 'notFound', 'confidence', 'evidenceIdx', 'quote'],
            properties: {
              key: { type: 'string', enum: ['M', 'E', 'D_CRITERIA', 'D_PROCESS', 'I', 'C'] },
              value: { type: ['string', 'null'] },
              notFound: { type: 'boolean' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              evidenceIdx: { type: 'array', items: { type: 'integer' } },
              quote: { type: 'string' },
            },
          },
        },
      },
    },
    minContextChars: 200,
  },
  {
    taskId: 'T05',
    modelHint: 'medium',
    systemPrompt: `You are a conversation-signal detector for sales calls. ${STANDING}
Extract only signals actually present in the transcript. Types: OBJECTION (resistance or concern raised by the prospect), BUYING_SIGNAL (statements indicating forward intent or urgency), COMPETITOR (an alternative vendor is named or compared), PRICING_SIGNAL (discussion of price, budget, discounting, or procurement pushback), TIMELINE_SIGNAL (statements about timing, deadlines, delays), NEXT_STEP (a concrete next step with a date that was agreed). Each signal needs a short title, 1-3 sentence content, confidence 0-1, evidence segment ids and a verbatim quote. Never duplicate a type+content pair. An empty signals array is a valid answer on a quiet call.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"signals": [{"type": "OBJECTION" | "BUYING_SIGNAL" | "COMPETITOR" | "PRICING_SIGNAL" | "TIMELINE_SIGNAL" | "NEXT_STEP", "title": "3-6 words", "content": "1-3 sentences", "confidence": 0.0, "evidenceIdx": [2], "quote": "verbatim snippet"}]}
- "evidenceIdx" are integers from the provided segment numbers.
Example: {"signals":[{"type":"PRICING_SIGNAL","title":"Budget range asked","content":"The rep asked what budget range has been set aside.","confidence":0.9,"evidenceIdx":[9],"quote":"What budget range have you set aside for a tool like this?"}]}`,
    userTemplate: 'Segments:\n{{segments}}\n\nCompetitor watchlist: {{dealContext}}\nLanguage: {{language}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['signals'],
      properties: {
        signals: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['type', 'title', 'content', 'confidence', 'evidenceIdx', 'quote'],
            properties: {
              type: { type: 'string', enum: ['OBJECTION', 'BUYING_SIGNAL', 'COMPETITOR', 'PRICING_SIGNAL', 'TIMELINE_SIGNAL', 'NEXT_STEP'] },
              title: { type: 'string' },
              content: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              evidenceIdx: { type: 'array', items: { type: 'integer' } },
              quote: { type: 'string' },
            },
          },
        },
      },
    },
    minContextChars: 200,
  },
  {
    taskId: 'T06',
    modelHint: 'medium',
    systemPrompt: `You are a fair, evidence-citing sales coach scoring one call against a rubric you are given. ${STANDING}
Score each dimension 0-10 against the rubric's full-marks text. Cite segment ids for every judgment. Talk balance is scored against the 40-60% target given to you as a measured fact - do not re-estimate it. Never emit flat identical scores across all dimensions unless the call genuinely was uniform; spread is expected.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"dimensions": [{"key": "discovery" | "value" | "objections" | "next_step" | "talk_balance" | "rapport", "score": 0, "evidenceIdx": [1, 2], "comment": "1-3 sentences citing what drove the score"}]}
- EXACTLY 6 items, one per key: discovery, value, objections, next_step, talk_balance, rapport (in that order).
- "score" is an integer 0-10; "evidenceIdx" are integers from the provided segment numbers (empty array allowed for talk_balance, which uses measured facts).
Example: {"dimensions":[{"key":"discovery","score":8,"evidenceIdx":[1,3],"comment":"Four diagnostic questions surfaced pain and process."}]}`,
    userTemplate: 'Segments:\n{{segments}}\n\nRubric: {{dealContext}}\n\nMeasured facts (arithmetic, authoritative - never re-estimate these): talkRatioRep={{talkRatio}}%, questionCount={{questionCount}}, longestMonologueSec={{longestMonologue}}\nLanguage: {{language}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['dimensions'],
      properties: {
        dimensions: {
          type: 'array', minItems: 6, maxItems: 6,
          items: {
            type: 'object', additionalProperties: false,
            required: ['key', 'score', 'evidenceIdx', 'comment'],
            properties: {
              key: { type: 'string', enum: ['discovery', 'value', 'objections', 'next_step', 'talk_balance', 'rapport'] },
              score: { type: 'integer', minimum: 0, maximum: 10 },
              evidenceIdx: { type: 'array', items: { type: 'integer' } },
              comment: { type: 'string' },
            },
          },
        },
      },
    },
    minContextChars: 200,
  },
  {
    taskId: 'T07',
    modelHint: 'small',
    systemPrompt: `You draft the follow-up email for one sales call. ${STANDING}
The draft must reference at least one concrete detail from the call (a number, a named pain, an agreed date). Subject under 80 characters. Warm-professional tone means human, specific, brief; no corporate filler, no exclamation marks. Body under 180 words. Close with the agreed next step or a specific proposal if none was agreed.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"subject": "under 80 chars, specific", "body": "under 180 words, plain text with \\n between paragraphs"}
Example: {"subject":"Great talking - Northwind pilot next steps","body":"Hi Sarah,\\n\\nThanks for walking me through..."}
Note: JSON strings must escape newlines as \\n.`,
    userTemplate: 'Tone: {{tone}}\n\nCall summary: {{dealContext}}\n\nSegments (for the concrete detail): {{segments}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['subject', 'body'],
      properties: {
        subject: { type: 'string', maxLength: 80 },
        body: { type: 'string' },
      },
    },
    minContextChars: 150,
  },
  {
    taskId: 'T08',
    modelHint: 'small',
    systemPrompt: `You write structured call notes from one transcript. ${STANDING}
Three sections: decisions (imperative, past-tense statements of what was decided), openQuestions (each phrased as an actual question), actionItems (imperative sentences with an owner where known). If a section has nothing real in the call, emit an empty array for it - never invent content.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"decisions": ["..."], "openQuestions": ["..."], "actionItems": ["..."]}
Each array holds plain strings (no objects, no ids).
Example: {"decisions":[],"openQuestions":["Who runs the security review?"],"actionItems":["Send the pilot proposal by Friday"]}`,
    userTemplate: 'Segments:\n{{segments}}\n\nSummary for context: {{dealContext}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['decisions', 'openQuestions', 'actionItems'],
      properties: {
        decisions: { type: 'array', items: { type: 'string' } },
        openQuestions: { type: 'array', items: { type: 'string' } },
        actionItems: { type: 'array', items: { type: 'string' } },
      },
    },
    minContextChars: 150,
  },
  {
    taskId: 'T11',
    modelHint: 'medium',
    systemPrompt: `You are a retrieval-augmented answer engine over the user's own sales-call library. ${STANDING}
Every claim must cite at least one provided hit id. If the hits do not contain the answer, or are all below the given confidence floor, refuse plainly ("I can't find that in your library") instead of guessing. Never pad with general knowledge.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"answer": "2-6 sentences grounded in the hits", "citations": [{"hitId": "id exactly as given", "quote": "short verbatim quote from that hit"}]}
- "hitId" must match an id from the provided hits, verbatim.
- On refusal: {"answer":"I can't find that in your library.","citations":[]}`,
    userTemplate: 'Question: {{question}}\n\nHits (id, score, source, text):\n{{hits}}\n\nConfidence floor: {{minScore}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['answer', 'citations'],
      properties: {
        answer: { type: 'string' },
        citations: { type: 'array', items: { type: 'object', required: ['hitId', 'quote'], properties: { hitId: { type: 'string' }, quote: { type: 'string' } }, additionalProperties: false } },
      },
    },
  },
  {
    taskId: 'T12',
    modelHint: 'small',
    systemPrompt: `You identify best-practice moments in a sales call transcript - a handled objection, a crisp discovery sequence, a well-secured next step. ${STANDING}
Category is from the fixed list: Discovery, Objections, Value, Next steps, Rapport, Other. Suggest only moments you can ground in segment ids, and write the body so it is reusable as a personal playbook entry. An empty suggestions array is a valid answer.

OUTPUT CONTRACT - respond with exactly this JSON object and nothing else:
{"suggestions": [{"title": "short name", "category": "Discovery" | "Objections" | "Value" | "Next steps" | "Rapport" | "Other", "body": "2-5 sentences, playbook voice (what to do and why it worked)", "evidenceIdx": [2, 3]}]}
- "evidenceIdx" are integers from the provided segment numbers.
Example: {"suggestions":[{"title":"Quantify then anchor","category":"Value","body":"State the prospect's number first, then anchor the improvement to it.","evidenceIdx":[4,5]}]}`,
    userTemplate: 'Segments:\n{{segments}}\n\nSummary for context: {{dealContext}}',
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['suggestions'],
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['title', 'category', 'body', 'evidenceIdx'],
            properties: {
              title: { type: 'string' },
              category: { type: 'string', enum: ['Discovery', 'Objections', 'Value', 'Next steps', 'Rapport', 'Other'] },
              body: { type: 'string' },
              evidenceIdx: { type: 'array', items: { type: 'integer' } },
            },
          },
        },
      },
    },
    minContextChars: 200,
  },
]

export async function seedPromptTemplates(db: PrismaClient): Promise<void> {
  for (const seed of PROMPT_SEEDS) {
    const active = await db.promptTemplate.findFirst({ where: { taskId: seed.taskId, active: true } })
    if (active) {
      // v1 -> v2 upgrade: only when the active row is the UNTOUCHED v1 seed
      // (user edits win over pack upgrades, NFR-14).
      const v1Prefix = V1_SIGNATURES[seed.taskId]
      const isUntouchedV1 =
        !!v1Prefix &&
        active.version === 1 &&
        active.systemPrompt.startsWith(v1Prefix) &&
        !active.systemPrompt.includes('OUTPUT CONTRACT')
      if (!isUntouchedV1) continue
      await db.promptTemplate.update({ where: { id: active.id }, data: { active: false } })
    }
    // Bump version beyond any existing versions of this task.
    const last = await db.promptTemplate.findFirst({ where: { taskId: seed.taskId }, orderBy: { version: 'desc' } })
    await db.promptTemplate.create({
      data: {
        taskId: seed.taskId,
        version: (last?.version ?? 0) + 1,
        systemPrompt: seed.systemPrompt,
        userTemplate: seed.userTemplate,
        outputSchema: seed.outputSchema,
        modelHint: seed.modelHint,
        minContextChars: seed.minContextChars ?? 0,
        active: true,
      },
    })
  }
}
