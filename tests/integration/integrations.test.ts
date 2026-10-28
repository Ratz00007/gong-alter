// VALENCE — Integration & MCP Plugin Verification Test Suite
import { describe, test, expect, beforeAll } from 'bun:test'
import { useTestDb, seedOnce, getDb } from '../helpers'
import { autoDiscoverEmailSettings } from '@/lib/integrations/email/auto-discover'
import { analyzeEmailContent, ingestEmailMessage } from '@/lib/integrations/email/engine'
import {
  connectIntegration,
  disconnectIntegration,
  testIntegration,
  syncIntegration,
  listIntegrations,
  getRecentSyncLogs,
} from '@/lib/integrations/manager'
import { verifyAgentApiKey } from '@/lib/auth'
import { handleToolCall, handleJsonRpc } from '@/mcp/server'
import { NextRequest } from 'next/server'

beforeAll(async () => {
  useTestDb()
  await seedOnce()
})

describe('Email Auto-Discovery (Non-technical Connection)', () => {
  test('auto-detects canonical parameters for Google, Microsoft, Fastmail, and Zoho', () => {
    const gmail = autoDiscoverEmailSettings('sales@gmail.com')
    expect(gmail.imapHost).toBe('imap.gmail.com')
    expect(gmail.imapPort).toBe(993)
    expect(gmail.requiresAppPassword).toBe(true)

    const outlook = autoDiscoverEmailSettings('founder@outlook.com')
    expect(outlook.imapHost).toBe('outlook.office365.com')
    expect(outlook.imapPort).toBe(993)

    const fastmail = autoDiscoverEmailSettings('team@fastmail.com')
    expect(fastmail.imapHost).toBe('imap.fastmail.com')
    expect(fastmail.smtpPort).toBe(465)

    const zoho = autoDiscoverEmailSettings('support@zoho.com')
    expect(zoho.imapHost).toBe('imappro.zoho.com')
  })

  test('auto-derives standard TLS configuration for custom enterprise domain', () => {
    const custom = autoDiscoverEmailSettings('rep@acme-enterprises.corp')
    expect(custom.imapHost).toBe('imap.acme-enterprises.corp')
    expect(custom.imapPort).toBe(993)
    expect(custom.imapSecure).toBe(true)
  })
})

describe('Email Ingestion & Sentiment Engine', () => {
  test('correctly analyzes sentiment, buyer objections, and intent', () => {
    const closing = analyzeEmailContent(
      'Re: Contract signature and Kickoff',
      'All redlines approved. We have countersigned the annual agreement for 100 seats.',
    )
    expect(closing.sentiment).toBe('POSITIVE')
    expect(closing.intent).toBe('CLOSING')
    expect(closing.signals).toContain('Closing / Agreement indicator')

    const objection = analyzeEmailContent(
      'Vendor evaluation concerns',
      'We compared VALENCE with Gong and Chorus. Your team is too expensive and our board has budget concerns.',
    )
    expect(objection.sentiment).toBe('OBJECTION')
    expect(objection.intent).toBe('OBJECTION')
    expect(objection.signals).toContain('Competitor benchmark mentioned')
    expect(objection.signals).toContain('Pricing / Budget discussion')
  })

  test('ingests email and links to Deal and Timeline', async () => {
    const db = getDb()
    const deal = await db.deal.create({
      data: {
        title: 'Cyberdyne Defense Renewal',
        account: 'Cyberdyne',
        stage: 'PROPOSAL',
        healthScore: 80,
      },
    })

    const emailRes = await ingestEmailMessage({
      externalId: `test-email-${Date.now()}`,
      from: 'sarah@cyberdyne.com',
      to: 'sales@valence.internal',
      subject: 'Security sign-off complete',
      bodyText: 'We verified SOC2 compliance. Ready to proceed with MSA.',
      sentAt: new Date(),
      direction: 'INBOUND',
    })

    expect(emailRes.matched).toBe(true)
    expect(emailRes.dealId).toBe(deal.id)

    const storedEmail = await db.emailMessage.findUniqueOrThrow({ where: { id: emailRes.emailId } })
    expect(storedEmail.dealId).toBe(deal.id)
    expect(storedEmail.sentiment).toBe('POSITIVE')

    // Timeline event logged
    const events = await db.dealEvent.findMany({ where: { dealId: deal.id, kind: 'EMAIL_ACTIVITY' } })
    expect(events.length).toBeGreaterThan(0)
  })
})

describe('Integration Manager (Email & CRM)', () => {
  test('refuses unimplemented Gmail, Outlook and CRM connections without saving credentials', async () => {
    const db = getDb()
    for (const type of ['GMAIL', 'OUTLOOK', 'HUBSPOT'] as const) {
      await expect(connectIntegration({ type, config: { password: 'test-only-password' } })).rejects.toThrow('not implemented')
      expect((await testIntegration(type)).ok).toBe(false)
      expect((await syncIntegration(type)).ok).toBe(false)
      expect(await db.integrationConnection.count({ where: { type } })).toBe(0)
    }
  })

  test('marks legacy connections unverified, hides credentials and removes them on disconnect', async () => {
    const db = getDb()
    const legacy = await db.integrationConnection.create({ data: {
      type: 'GMAIL', name: 'Old Gmail', status: 'CONNECTED', configJson: { password: 'test-only-password' },
    } })
    await db.integrationSyncLog.create({ data: { connectionId: legacy.id, status: 'OK', action: 'TEST' } })
    const gmail = (await listIntegrations()).find((i) => i.id === legacy.id)
    expect(gmail?.status).toBe('ERROR')
    expect(JSON.stringify(gmail)).not.toContain('test-only-password')
    expect(JSON.stringify(await getRecentSyncLogs())).not.toContain('test-only-password')
    expect((await testIntegration('GMAIL')).ok).toBe(false)
    expect((await syncIntegration('GMAIL')).ok).toBe(false)
    expect(await disconnectIntegration('GMAIL')).toBe(true)
    const stored = await db.integrationConnection.findUniqueOrThrow({ where: { id: legacy.id } })
    expect(stored.status).toBe('DISCONNECTED')
    expect(stored.configJson).toEqual({})
  })
})

describe('Coding Agent API & MCP Server', () => {
  test('verifies Coding Agent API Key via Bearer header or x-valence-key', () => {
    const req1 = new NextRequest('http://localhost/api/agent/v1/health', {
      headers: { authorization: 'Bearer valence_agent_master_key_sov2026' },
    })
    expect(verifyAgentApiKey(req1)).toBe(true)

    const req2 = new NextRequest('http://localhost/api/agent/v1/health', {
      headers: { 'x-valence-key': 'valence_agent_master_key_sov2026' },
    })
    expect(verifyAgentApiKey(req2)).toBe(true)

    const reqBad = new NextRequest('http://localhost/api/agent/v1/health', {
      headers: { authorization: 'Bearer invalid_key' },
    })
    expect(verifyAgentApiKey(reqBad)).toBe(false)
  })

  test('MCP tool execution: valence_list_deals & valence_get_system_status', async () => {
    const dealsRes = (await handleToolCall('valence_list_deals', {})) as { count: number; deals: unknown[] }
    expect(typeof dealsRes.count).toBe('number')
    expect(Array.isArray(dealsRes.deals)).toBe(true)

    const statusRes = (await handleToolCall('valence_get_system_status', {})) as { status: string; pipeline: unknown }
    expect(statusRes.status).toBe('ONLINE')
    expect(statusRes.pipeline).toBeTruthy()
  })

  test('MCP JSON-RPC 2.0 handshake and tool listing', async () => {
    const initRes = await handleJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    })
    const resultObj = initRes?.result as { serverInfo?: { name: string } }
    expect(resultObj?.serverInfo?.name).toBe('valence-revenue-intelligence')

    const toolsRes = await handleJsonRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    const tools = (toolsRes?.result as { tools: { name: string }[] }).tools
    expect(tools.length).toBeGreaterThanOrEqual(10)
    expect(tools.map((t) => t.name)).toContain('valence_list_deals')
    expect(tools.map((t) => t.name)).toContain('valence_search_intelligence')
    expect(tools.map((t) => t.name)).toContain('valence_sync_integrations')

    const callRes = await handleJsonRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'valence_get_system_status',
        arguments: {},
      },
    })
    expect(callRes?.result).toBeTruthy()
    const content = (callRes?.result as { content: { text: string }[] }).content
    expect(content[0].text).toContain('ONLINE')
  })
})
