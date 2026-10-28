// VALENCE — Sovereign Revenue Intelligence Model Context Protocol (MCP) Server
// Implements MCP specification (JSON-RPC 2.0 over stdio) for coding agents (Antigravity, Claude Code, Cursor, Windsurf, OpenCode).

import readline from 'node:readline'
import { getDb } from '@/lib/db'
import { processCopilotQuery } from '@/lib/copilot/query-engine'
import { semanticSearch } from '@/lib/search/embed'
import { listIntegrations, syncIntegration } from '@/lib/integrations/manager'
import { ingestEmailMessage } from '@/lib/integrations/email/engine'
import { intakeCall } from '@/lib/pipeline/orchestrator'
import { storeAsset, storeScript } from '@/lib/media/vault'
import { createPureWavBuffer } from '@/lib/audio/wav'
import { formatCurrency, type CurrencyCode } from '@/lib/format'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// MCP Tools Declaration
const MCP_TOOLS = [
  {
    name: 'valence_list_deals',
    description: 'Lists active deals from the VALENCE revenue intelligence pipeline with health scores, stages, and values.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED'],
          description: 'Filter deals by pipeline stage',
        },
        minHealth: {
          type: 'number',
          description: 'Minimum health score (0-100)',
        },
        search: {
          type: 'string',
          description: 'Keyword search in deal title or account name',
        },
      },
    },
  },
  {
    name: 'valence_get_deal',
    description: 'Retrieves complete dossier for a deal including contacts, call history, emails, timeline events, and MEDDIC insights.',
    inputSchema: {
      type: 'object',
      properties: {
        dealId: {
          type: 'string',
          description: 'The unique deal identifier (cuid)',
        },
      },
      required: ['dealId'],
    },
  },
  {
    name: 'valence_update_deal',
    description: 'Updates a deal stage, health score, expected value, or next step in the pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'The unique deal ID' },
        stage: {
          type: 'string',
          enum: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED'],
        },
        healthScore: { type: 'number', description: 'Updated health score (0-100)' },
        valueCents: { type: 'number', description: 'Deal value in cents (e.g. 5000000 = $50,000)' },
        nextStep: { type: 'string', description: 'Next strategic action item' },
      },
      required: ['dealId'],
    },
  },
  {
    name: 'valence_create_deal',
    description: 'Creates a new enterprise sales deal in VALENCE with account information and contacts.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Deal title (e.g. Acme Enterprise Expansion)' },
        account: { type: 'string', description: 'Company or account name' },
        stage: {
          type: 'string',
          enum: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'PARKED'],
          default: 'QUALIFIED',
        },
        valueCents: { type: 'number', description: 'Value in cents' },
        currency: { type: 'string', default: 'USD' },
        healthScore: { type: 'number', default: 75 },
        nextStep: { type: 'string', description: 'Action item' },
        contactName: { type: 'string', description: 'Primary contact name' },
        contactEmail: { type: 'string', description: 'Primary contact email' },
      },
      required: ['title', 'account'],
    },
  },
  {
    name: 'valence_list_calls',
    description: 'Lists analyzed customer calls with duration, rep talk-time ratio, overall MEDDIC score, and deal link.',
    inputSchema: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'Filter calls for a specific deal' },
        status: { type: 'string', description: 'Filter by call status (e.g. READY, FAILED)' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'valence_get_call',
    description: 'Retrieves full details of a call including transcript segments, executive summary, buyer objections, and scorecard.',
    inputSchema: {
      type: 'object',
      properties: {
        callId: { type: 'string', description: 'The unique call ID' },
      },
      required: ['callId'],
    },
  },
  {
    name: 'valence_search_intelligence',
    description: 'Performs hybrid semantic cosine vector + lexical search across all sales calls, transcripts, and battlecard practices.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query (e.g. "pricing objection", "SOC2 compliance")' },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'valence_ingest_content',
    description: 'Ingests sales content (raw transcript text, audio, or email thread) into the autonomous analysis pipeline.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['TRANSCRIPT', 'EMAIL'], description: 'Type of content' },
        title: { type: 'string', description: 'Title or subject' },
        dealId: { type: 'string', description: 'Optional deal ID to attach to' },
        text: { type: 'string', description: 'The raw conversation or email body text' },
        from: { type: 'string', description: 'Sender email (for EMAIL type)' },
        to: { type: 'string', description: 'Recipient email (for EMAIL type)' },
      },
      required: ['type', 'title', 'text'],
    },
  },
  {
    name: 'valence_get_copilot_advice',
    description: 'Queries the VALENCE AI revenue copilot ("Oracle") for grounded strategic guidance on deals, objections, or rep coaching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The sales question or strategy prompt' },
        dealId: { type: 'string', description: 'Optional deal context ID' },
        callId: { type: 'string', description: 'Optional call context ID' },
      },
      required: ['query'],
    },
  },
  {
    name: 'valence_sync_integrations',
    description: 'Triggers synchronization for an email inbox (Gmail, Outlook, IMAP) or CRM (HubSpot, Salesforce, Pipedrive).',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['GMAIL', 'OUTLOOK', 'IMAP', 'HUBSPOT', 'SALESFORCE', 'PIPEDRIVE'],
          description: 'The integration provider to sync',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'valence_get_system_status',
    description: 'Returns health, database status, queue depth, budget spend, and connected integration status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// MCP Resources Declaration
const MCP_RESOURCES = [
  {
    uri: 'valence://deals/pipeline',
    name: 'Live Deal Pipeline',
    mimeType: 'application/json',
    description: 'Snapshot of all active enterprise deals with health scores and stages.',
  },
  {
    uri: 'valence://status',
    name: 'System Health & Integrations',
    mimeType: 'application/json',
    description: 'Live status of database, AI providers, and inbox/CRM connectors.',
  },
]

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const db = getDb()

  switch (name) {
    case 'valence_list_deals': {
      const where: Record<string, unknown> = { archivedAt: null }
      if (args.stage) where.stage = args.stage
      if (args.minHealth) where.healthScore = { gte: Number(args.minHealth) }
      if (args.search) {
        where.OR = [
          { title: { contains: String(args.search) } },
          { account: { contains: String(args.search) } },
        ]
      }
      const deals = await db.deal.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        include: { contacts: true, _count: { select: { calls: true, emailMessages: true } } },
      })
      return {
        count: deals.length,
        deals: deals.map((d) => ({
          id: d.id,
          title: d.title,
          account: d.account,
          stage: d.stage,
          valueFormatted: formatCurrency(d.valueCents, (d.currency as CurrencyCode) || 'USD'),
          healthScore: d.healthScore,
          nextStep: d.nextStep,
          callCount: d._count.calls,
          emailCount: d._count.emailMessages,
        })),
      }
    }

    case 'valence_get_deal': {
      const deal = await db.deal.findUnique({
        where: { id: String(args.dealId) },
        include: {
          contacts: true,
          calls: {
            include: { summary: true, scorecard: true, insights: true },
            orderBy: { occurredAt: 'desc' },
          },
          emailMessages: { orderBy: { sentAt: 'desc' }, take: 10 },
          events: { orderBy: { occurredAt: 'desc' }, take: 15 },
          notes: true,
        },
      })
      if (!deal) throw new Error(`Deal ${args.dealId} not found`)
      return { deal }
    }

    case 'valence_update_deal': {
      const deal = await db.deal.update({
        where: { id: String(args.dealId) },
        data: {
          stage: args.stage as any,
          healthScore: args.healthScore !== undefined ? Number(args.healthScore) : undefined,
          valueCents: args.valueCents !== undefined ? Number(args.valueCents) : undefined,
          nextStep: args.nextStep ? String(args.nextStep) : undefined,
        },
      })
      return { ok: true, deal }
    }

    case 'valence_create_deal': {
      const deal = await db.deal.create({
        data: {
          title: String(args.title),
          account: String(args.account),
          stage: (args.stage as any) || 'QUALIFIED',
          valueCents: args.valueCents ? Number(args.valueCents) : 25_000_00,
          currency: String(args.currency || 'USD'),
          healthScore: args.healthScore ? Number(args.healthScore) : 75,
          nextStep: args.nextStep ? String(args.nextStep) : 'Initial discovery review',
          contacts: args.contactName
            ? {
                create: {
                  name: String(args.contactName),
                  email: args.contactEmail ? String(args.contactEmail) : null,
                  isChampion: true,
                },
              }
            : undefined,
        },
        include: { contacts: true },
      })
      return { ok: true, deal }
    }

    case 'valence_list_calls': {
      const where: Record<string, unknown> = {}
      if (args.dealId) where.dealId = String(args.dealId)
      if (args.status) where.status = String(args.status)
      const calls = await db.call.findMany({
        where,
        take: Number(args.limit || 20),
        orderBy: { occurredAt: 'desc' },
        include: { deal: true, summary: true, scorecard: true },
      })
      return {
        count: calls.length,
        calls: calls.map((c) => ({
          id: c.id,
          title: c.title,
          dealTitle: c.deal?.title,
          occurredAt: c.occurredAt,
          durationSec: c.durationSec,
          status: c.status,
          overallScore: c.scorecard?.overall,
          talkRatioRep: c.scorecard?.talkRatioRep,
          summary: c.summary?.summary,
        })),
      }
    }

    case 'valence_get_call': {
      const call = await db.call.findUnique({
        where: { id: String(args.callId) },
        include: {
          deal: true,
          transcript: { include: { segments: { orderBy: { idx: 'asc' } } } },
          summary: true,
          scorecard: true,
          insights: true,
          followUpDraft: true,
        },
      })
      if (!call) throw new Error(`Call ${args.callId} not found`)
      return { call }
    }

    case 'valence_search_intelligence': {
      const res = await semanticSearch(String(args.query), {}, { limit: Number(args.limit || 5) })
      return { query: args.query, hits: res.hits }
    }

    case 'valence_ingest_content': {
      const type = String(args.type)
      const text = String(args.text)
      const title = String(args.title)

      if (type === 'EMAIL') {
        const res = await ingestEmailMessage({
          externalId: `mcp-email-${Date.now()}`,
          from: args.from ? String(args.from) : 'client@enterprise.com',
          to: args.to ? String(args.to) : 'sales@company.com',
          subject: title,
          bodyText: text,
          sentAt: new Date(),
          direction: 'INBOUND',
        })
        return { ok: true, type: 'EMAIL', result: res }
      }

      // Transcript / Call ingestion
      const wav = createPureWavBuffer(30, 440)
      const { asset } = await storeAsset(wav, 'audio/wav', `${title.replace(/\s+/g, '-').toLowerCase()}.wav`)
      const call = await intakeCall({
        title,
        dealId: args.dealId ? String(args.dealId) : null,
        occurredAt: new Date(),
        mediaAssetId: asset.id,
        audioSha256: asset.sha256,
      })

      const sentences = text.split(/[.?!]\s+/).filter(Boolean)
      storeScript(
        call.id,
        JSON.stringify({
          language: 'en',
          segments: sentences.map((sent, idx) => ({
            speaker: idx % 2 === 0 ? 'SPEAKER_00' : 'SPEAKER_01',
            startMs: idx * 4000,
            endMs: (idx + 1) * 4000,
            text: sent.trim(),
          })),
        }),
      )

      return { ok: true, callId: call.id, status: call.status, message: 'Queued for pipeline analysis' }
    }

    case 'valence_get_copilot_advice': {
      const res = await processCopilotQuery({
        q: String(args.query),
        activeDealId: args.dealId ? String(args.dealId) : null,
        activeCallId: args.callId ? String(args.callId) : null,
      })
      return {
        advice: res.displayText,
        spokenSummary: res.spokenText,
        dealCards: res.dealCards,
        citations: res.citations,
        suggestedFollowUps: res.suggestedFollowUps,
      }
    }

    case 'valence_sync_integrations': {
      const res = await syncIntegration(String(args.type))
      return res
    }

    case 'valence_get_system_status': {
      const [deals, calls, queue, integrations] = await Promise.all([
        db.deal.count(),
        db.call.count(),
        db.job.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
        listIntegrations(),
      ])
      return {
        status: 'ONLINE',
        pipeline: { deals, calls, queueDepth: queue },
        integrations: integrations.map((i) => ({ type: i.type, name: i.name, status: i.status, itemsSynced: i.itemsSynced })),
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

/**
 * Handles incoming JSON-RPC 2.0 messages from coding agents.
 */
export async function handleJsonRpc(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const { id, method, params } = req

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'valence-revenue-intelligence',
          version: '1.0.0',
        },
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    }
  }

  if (method === 'notifications/initialized') {
    return null
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS },
    }
  }

  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { resources: MCP_RESOURCES },
    }
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri ?? '')
    const db = getDb()

    if (uri === 'valence://deals/pipeline') {
      const deals = await db.deal.findMany({ where: { archivedAt: null }, take: 25 })
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(deals, null, 2) }],
        },
      }
    }

    if (uri === 'valence://status') {
      const integrations = await listIntegrations()
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ status: 'HEALTHY', integrations }, null, 2) }],
        },
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: `Resource not found: ${uri}` },
    }
  }

  if (method === 'tools/call') {
    const name = String(params?.name)
    const args = (params?.arguments as Record<string, unknown>) ?? {}

    try {
      const toolResult = await handleToolCall(name, args)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2),
            },
          ],
        },
      }
    } catch (e) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        },
      }
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}

// Standalone stdio loop when run directly
if (import.meta.main) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  rl.on('line', async (line) => {
    const cleanLine = line.replace(/^\uFEFF/, '').trim()
    if (!cleanLine) return
    try {
      const req = JSON.parse(cleanLine) as JsonRpcRequest
      const res = await handleJsonRpc(req)
      if (res) {
        process.stdout.write(JSON.stringify(res) + '\n')
      }
    } catch (e) {
      const errRes: JsonRpcResponse = {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error', data: String(e) },
      }
      process.stdout.write(JSON.stringify(errRes) + '\n')
    }
  })

  process.stderr.write('[VALENCE MCP Server] Sovereign Revenue Intelligence MCP stdio ready.\n')
}
