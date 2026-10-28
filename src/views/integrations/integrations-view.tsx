'use client'
// VALENCE — Integrations Hub View
// Universal Email Inboxes (Gmail, Outlook, IMAP), CRMs (HubSpot, Salesforce, Pipedrive),
// and Coding Agent MCP Plugin management with non-technical 1-click connectors.

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Mail,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Bot,
  Zap,
  Building2,
  Lock,
  ArrowRight,
  Copy,
  Sparkles,
  Inbox,
  Layers,
  ChevronRight,
  Database,
  Terminal,
} from 'lucide-react'
import { navigate } from '@/lib/router'

interface IntegrationRow {
  id: string
  type: string
  name: string
  accountEmail: string | null
  status: 'CONNECTED' | 'DISCONNECTED' | 'SYNCING' | 'ERROR'
  lastSyncAt: string | null
  lastError: string | null
  autoSync: boolean
  syncIntervalMin: number
  itemsSynced: number
  config: Record<string, unknown>
}

interface IngestedEmailItem {
  id: string
  from: string
  to: string
  subject: string
  bodyText: string
  sentAt: string
  direction: string
  sentiment: string | null
  intent: string | null
  deal: { id: string; title: string; account: string; healthScore: number | null } | null
  insightsJson?: { signals?: string[]; objections?: string[] }
}

export function IntegrationsView() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState('email')

  // Modals state
  const [connectModalType, setConnectModalType] = useState<string | null>(null)
  const [clientIdInput, setClientIdInput] = useState('')
  const [tenantInput, setTenantInput] = useState('common')
  const [oauthPending, setOauthPending] = useState(false)
  const [agentTestTool, setAgentTestTool] = useState('valence_list_deals')
  const [agentToolResult, setAgentToolResult] = useState<string | null>(null)

  // Fetch all connections & logs
  const connections = useQuery({
    queryKey: ['integrations-list'],
    queryFn: () =>
      api.get<{
        items: IntegrationRow[]
        recentLogs: Array<{
          id: string
          action: string
          status: string
          itemsCount: number
          message: string
          createdAt: string
          connection?: { name: string; type: string }
        }>
        counts: { total: number; connected: number; syncing: number }
      }>('/api/integrations'),
    refetchInterval: 15_000,
  })

  // Fetch emails feed
  const emails = useQuery({
    queryKey: ['integrations-emails'],
    queryFn: () => api.get<{ items: IngestedEmailItem[] }>('/api/integrations/emails'),
    refetchInterval: 20_000,
  })

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: (type: string) => api.post<{ ok: boolean; message: string; itemsSynced: number }>('/api/integrations/sync', { type }),
    onSuccess: (res, type) => {
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(`${type} Synced: ${res.message}`)
      qc.invalidateQueries({ queryKey: ['integrations-list'] })
      qc.invalidateQueries({ queryKey: ['integrations-emails'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Sync failed'),
  })

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: (data: { type: string; name?: string; accountEmail?: string; config: Record<string, unknown> }) =>
      api.post('/api/integrations', data),
    onSuccess: (_res, vars) => {
      toast.success(`${vars.type} connected successfully!`)
      setConnectModalType(null)
      qc.invalidateQueries({ queryKey: ['integrations-list'] })
      // Auto-trigger sync
      syncMutation.mutate(vars.type)
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Connection failed'),
  })

  // OAuth client app configuration (Settings rows; env vars also work)
  const settings = useQuery({
    queryKey: ['integration-settings'],
    queryFn: () => api.get<{ items: { key: string; value: unknown }[] }>('/api/settings'),
  })

  // Real browser OAuth: opens the system browser, then polls the loopback callback.
  const oauthMutation = useMutation({
    mutationFn: async (provider: 'GMAIL' | 'OUTLOOK') => {
      const start = await api.post<{ requestId: string; authUrl: string }>('/api/integrations/oauth/start', { provider })
      window.open(start.authUrl, '_blank', 'noopener')
      setOauthPending(true)
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const status = await api.get<{ status: string; accountEmail?: string; error?: string }>(
          `/api/integrations/oauth/status?requestId=${start.requestId}`,
        )
        if (status.status === 'connected') return status
        if (status.status === 'failed') throw new Error(status.error ?? 'Authorization failed')
      }
      throw new Error('Authorization timed out')
    },
    onSuccess: (status, provider) => {
      toast.success(`${status.accountEmail ?? provider} connected`)
      setConnectModalType(null)
      qc.invalidateQueries({ queryKey: ['integrations-list'] })
      syncMutation.mutate(provider)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Authorization failed'),
    onSettled: () => setOauthPending(false),
  })

  const handleOAuthConnect = async (provider: 'GMAIL' | 'OUTLOOK') => {
    try {
      if (clientIdInput.trim()) {
        await api.patch('/api/settings', {
          key: provider === 'GMAIL' ? 'integrations.gmailClientId' : 'integrations.outlookClientId',
          value: clientIdInput.trim(),
        })
      }
      if (provider === 'OUTLOOK' && tenantInput.trim()) {
        await api.patch('/api/settings', { key: 'integrations.outlookTenantId', value: tenantInput.trim() })
      }
      oauthMutation.mutate(provider)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the OAuth configuration')
    }
  }

  useEffect(() => {
    if (!connectModalType || !settings.data) return
    const val = (k: string) => (settings.data!.items.find((s) => s.key === k)?.value as string | undefined) ?? ''
    if (connectModalType === 'GMAIL') setClientIdInput(val('integrations.gmailClientId'))
    if (connectModalType === 'OUTLOOK') {
      setClientIdInput(val('integrations.outlookClientId'))
      setTenantInput(val('integrations.outlookTenantId') || 'common')
    }
  }, [connectModalType, settings.data])

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: (type: string) => api.post('/api/integrations/disconnect', { type }),
    onSuccess: (_res, type) => {
      toast.info(`${type} disconnected`)
      qc.invalidateQueries({ queryKey: ['integrations-list'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Disconnect failed'),
  })

  // Run agent tool test
  const handleRunAgentToolTest = async () => {
    setAgentToolResult('Calling tool...')
    try {
      if (agentTestTool === 'valence_list_deals') {
        const res = await api.get('/api/agent/v1/deals')
        setAgentToolResult(JSON.stringify(res, null, 2))
      } else if (agentTestTool === 'valence_get_system_status') {
        const res = await api.get('/api/agent/v1/health')
        setAgentToolResult(JSON.stringify(res, null, 2))
      } else if (agentTestTool === 'valence_get_copilot_advice') {
        const res = await api.post('/api/agent/v1/copilot', { query: 'Summarize top risks across our active deals.' })
        setAgentToolResult(JSON.stringify(res, null, 2))
      }
    } catch (e) {
      setAgentToolResult(e instanceof Error ? e.message : String(e))
    }
  }

  const items = connections.data?.items ?? []
  const getConnection = (type: string) => items.find((i) => i.type === type)

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-editorial text-[length:var(--text-display)] font-semibold tracking-tight text-[var(--foreground)]">
              Integrations & Agent Plugin
            </h1>
            <Badge variant="outline" className="border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary)]">
              Sovereign Bridges
            </Badge>
          </div>
          <p className="mt-1 text-[var(--text-small)] text-[var(--muted-foreground)]">
Gmail and Outlook connect with real browser sign-in — VALENCE never asks for your mailbox password. IMAP and CRM connectors are still simulated and labeled as unverified.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['integrations-list'] })
              qc.invalidateQueries({ queryKey: ['integrations-emails'] })
              toast.info('Refreshed integration statuses')
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </Button>
          <Button
            size="sm"
            className="brand-gradient gap-2 text-white shadow-[var(--shadow-sm)]"
            onClick={() => {
              toast.info('Real integrations are not connected yet.')
            }}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Sync All Channels</span>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="glass-panel p-1 border-[var(--border)]">
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-4 w-4" />
            <span>Email Inboxes</span>
            {items.some((i) => ['GMAIL', 'OUTLOOK', 'IMAP'].includes(i.type) && i.status === 'CONNECTED') && (
              <span className="h-2 w-2 rounded-full bg-[var(--positive)]" />
            )}
          </TabsTrigger>
          <TabsTrigger value="crm" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span>CRMs</span>
            {items.some((i) => ['HUBSPOT', 'SALESFORCE', 'PIPEDRIVE'].includes(i.type) && i.status === 'CONNECTED') && (
              <span className="h-2 w-2 rounded-full bg-[var(--positive)]" />
            )}
          </TabsTrigger>
          <TabsTrigger value="agent" className="gap-2">
            <Bot className="h-4 w-4" />
            <span>Coding Agents & MCP</span>
            <Badge variant="secondary" className="text-[10px] py-0 px-1.5">Plugin Active</Badge>
          </TabsTrigger>
          <TabsTrigger value="feed" className="gap-2">
            <Inbox className="h-4 w-4" />
            <span>Ingested Emails</span>
            {(emails.data?.items?.length ?? 0) > 0 && (
              <span className="rounded-full bg-[var(--raised)] px-1.5 py-0.2 text-[10px] font-mono">
                {emails.data?.items?.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <Database className="h-4 w-4" />
            <span>Sync Logs</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: EMAIL INBOXES */}
        <TabsContent value="email" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Gmail Card */}
            {(() => {
              const conn = getConnection('GMAIL')
              const isConnected = conn?.status === 'CONNECTED'
              return (
                <Card className="glass-card hover-lift flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                        <Mail className="h-6 w-6" />
                      </div>
                      <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-[var(--positive)] text-white' : ''}>
                        {isConnected ? 'Connected' : conn ? 'Not verified' : 'Not connected'}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 font-editorial text-lg">Google Workspace / Gmail</CardTitle>
                    <CardDescription>
                      Continuously ingests client inbound/outbound threads, extracts buyer objections, and links emails to deals.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isConnected ? (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[var(--text-micro)] space-y-1">
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Account:</span>
                          <span className="font-medium text-[var(--foreground)] truncate max-w-[140px]">
                            {conn?.accountEmail ?? 'sales@company.com'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Items Synced:</span>
                          <span className="font-medium text-[var(--foreground)]">{conn?.itemsSynced ?? 0}</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Status:</span>
                          <span className="text-[var(--positive)] font-medium">Auto-sync active</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[11px] text-[var(--muted-foreground)]">
                        No verified Gmail connection. Connect opens Google sign-in in your browser.
                      </div>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      {isConnected ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5"
                            disabled={syncMutation.isPending}
                            onClick={() => syncMutation.mutate('GMAIL')}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            Sync Now
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--muted-foreground)] hover:text-red-500"
                            onClick={() => disconnectMutation.mutate('GMAIL')}
                          >
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <>
                          {conn && <Button variant="outline" size="sm" onClick={() => disconnectMutation.mutate('GMAIL')}>Remove saved unverified credentials</Button>}
                          <Button
                            size="sm"
                            className="w-full brand-gradient text-white"
                            onClick={() => setConnectModalType('GMAIL')}
                          >
                            Connect with Google
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}

            {/* Outlook Card */}
            {(() => {
              const conn = getConnection('OUTLOOK')
              const isConnected = conn?.status === 'CONNECTED'
              return (
                <Card className="glass-card hover-lift flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                        <Mail className="h-6 w-6" />
                      </div>
                      <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-[var(--positive)] text-white' : ''}>
                        {isConnected ? 'Connected' : conn ? 'Not verified' : 'Not connected'}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 font-editorial text-lg">Microsoft Outlook 365</CardTitle>
                    <CardDescription>
                      Connect your Microsoft 365 / Exchange account to capture buyer communications and contract approvals.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isConnected ? (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[var(--text-micro)] space-y-1">
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Account:</span>
                          <span className="font-medium text-[var(--foreground)] truncate max-w-[140px]">
                            {conn?.accountEmail ?? 'sales@enterprise.com'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Items Synced:</span>
                          <span className="font-medium text-[var(--foreground)]">{conn?.itemsSynced ?? 0}</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Status:</span>
                          <span className="text-[var(--positive)] font-medium">Auto-sync active</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[11px] text-[var(--muted-foreground)]">
                        No verified Outlook connection. Connect opens Microsoft sign-in in your browser.
                      </div>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      {isConnected ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5"
                            disabled={syncMutation.isPending}
                            onClick={() => syncMutation.mutate('OUTLOOK')}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            Sync Now
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--muted-foreground)] hover:text-red-500"
                            onClick={() => disconnectMutation.mutate('OUTLOOK')}
                          >
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <>
                          {conn && <Button variant="outline" size="sm" onClick={() => disconnectMutation.mutate('OUTLOOK')}>Remove saved unverified credentials</Button>}
                          <Button
                            size="sm"
                            className="w-full brand-gradient text-white"
                            onClick={() => setConnectModalType('OUTLOOK')}
                          >
                            Connect with Microsoft
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}

            {/* Universal IMAP Card */}
            {(() => {
              const conn = getConnection('IMAP')
              const isConnected = conn?.status === 'CONNECTED'
              return (
                <Card className="glass-card hover-lift flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                        <Layers className="h-6 w-6" />
                      </div>
                      <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-[var(--positive)] text-white' : ''}>
                        {isConnected ? 'Connected' : conn ? 'Not verified' : 'Not connected'}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 font-editorial text-lg">Universal IMAP / SMTP</CardTitle>
                    <CardDescription>
                      Connect any email provider (Fastmail, Zoho, iCloud, custom domain) with smart non-technical auto-discovery.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isConnected ? (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[var(--text-micro)] space-y-1">
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Account:</span>
                          <span className="font-medium text-[var(--foreground)] truncate max-w-[140px]">
                            {conn?.accountEmail ?? 'custom@company.com'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Items Synced:</span>
                          <span className="font-medium text-[var(--foreground)]">{conn?.itemsSynced ?? 0}</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Status:</span>
                          <span className="text-[var(--positive)] font-medium">SSL Encrypted</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[11px] text-[var(--muted-foreground)]">
                        Real IMAP sign-in and mailbox sync are not implemented yet.
                      </div>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      {isConnected ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5"
                            disabled={syncMutation.isPending}
                            onClick={() => syncMutation.mutate('IMAP')}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            Sync Now
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--muted-foreground)] hover:text-red-500"
                            onClick={() => disconnectMutation.mutate('IMAP')}
                          >
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <>
                          {conn && <Button variant="outline" size="sm" onClick={() => disconnectMutation.mutate('IMAP')}>Remove saved unverified credentials</Button>}
                          <Button size="sm" className="w-full brand-gradient text-white" onClick={() => setConnectModalType('IMAP')}>
                            Custom email connection status
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}
          </div>
        </TabsContent>

        {/* TAB 2: CRMS */}
        <TabsContent value="crm" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* HubSpot */}
            {(() => {
              const conn = getConnection('HUBSPOT')
              const isConnected = conn?.status === 'CONNECTED'
              return (
                <Card className="glass-card hover-lift flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-[var(--positive)] text-white' : ''}>
                        {isConnected ? 'Connected' : conn ? 'Not verified' : 'Not connected'}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 font-editorial text-lg">HubSpot CRM</CardTitle>
                    <CardDescription>
                      Bi-directional deal sync. Automatically pushes call summaries, MEDDIC scorecards, and next steps to HubSpot Deal notes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isConnected ? (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[var(--text-micro)] space-y-1">
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Deals Synced:</span>
                          <span className="font-medium text-[var(--foreground)]">{conn?.itemsSynced ?? 0}</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Field Mapping:</span>
                          <span className="font-medium text-[var(--foreground)]">Scorecard + Objections</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Status:</span>
                          <span className="text-[var(--positive)] font-medium">Bi-directional active</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[11px] text-[var(--muted-foreground)]">
                        Sync your pipeline and eliminate manual CRM entry for sales reps.
                      </div>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      {isConnected ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5"
                            disabled={syncMutation.isPending}
                            onClick={() => syncMutation.mutate('HUBSPOT')}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            Sync Pipeline
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--muted-foreground)] hover:text-red-500"
                            onClick={() => disconnectMutation.mutate('HUBSPOT')}
                          >
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="w-full brand-gradient text-white"
                            onClick={() =>
                              connectMutation.mutate({
                                type: 'HUBSPOT',
                                config: { authMode: 'sandbox', syncDeals: true, pushCallNotes: true },
                              })
                            }
                          >
                            HubSpot connection unavailable
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}

            {/* Salesforce */}
            {(() => {
              const conn = getConnection('SALESFORCE')
              const isConnected = conn?.status === 'CONNECTED'
              return (
                <Card className="glass-card hover-lift flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-[var(--positive)] text-white' : ''}>
                        {isConnected ? 'Connected' : conn ? 'Not verified' : 'Not connected'}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 font-editorial text-lg">Salesforce Enterprise</CardTitle>
                    <CardDescription>
                      Pushes call activities, logs MEDDIC insights to Opportunities, and keeps account decision-makers up to date.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isConnected ? (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[var(--text-micro)] space-y-1">
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Opportunities:</span>
                          <span className="font-medium text-[var(--foreground)]">{conn?.itemsSynced ?? 0}</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Tasks Logged:</span>
                          <span className="font-medium text-[var(--foreground)]">Active</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Status:</span>
                          <span className="text-[var(--positive)] font-medium">Enterprise bridge ready</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[11px] text-[var(--muted-foreground)]">
                        Connect with 1-click to push call tasks and Opportunity health metrics.
                      </div>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      {isConnected ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5"
                            disabled={syncMutation.isPending}
                            onClick={() => syncMutation.mutate('SALESFORCE')}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            Sync Salesforce
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--muted-foreground)] hover:text-red-500"
                            onClick={() => disconnectMutation.mutate('SALESFORCE')}
                          >
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full brand-gradient text-white"
                          onClick={() =>
                            connectMutation.mutate({
                              type: 'SALESFORCE',
                              config: { authMode: 'sandbox', pushTasks: true, syncOpportunities: true },
                            })
                          }
                        >
                          Salesforce connection unavailable
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}

            {/* Pipedrive */}
            {(() => {
              const conn = getConnection('PIPEDRIVE')
              const isConnected = conn?.status === 'CONNECTED'
              return (
                <Card className="glass-card hover-lift flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-[var(--positive)] text-white' : ''}>
                        {isConnected ? 'Connected' : conn ? 'Not verified' : 'Not connected'}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 font-editorial text-lg">Pipedrive CRM</CardTitle>
                    <CardDescription>
                      Syncs deal stages and logs customer objections directly to Pipedrive deal notes and activity feeds.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isConnected ? (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[var(--text-micro)] space-y-1">
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Activities Synced:</span>
                          <span className="font-medium text-[var(--foreground)]">{conn?.itemsSynced ?? 0}</span>
                        </div>
                        <div className="flex justify-between text-[var(--muted-foreground)]">
                          <span>Status:</span>
                          <span className="text-[var(--positive)] font-medium">Activity feed live</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[var(--raised)] p-3 text-[11px] text-[var(--muted-foreground)]">
                        Streamline your sales pipeline with automatic call logging.
                      </div>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      {isConnected ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5"
                            disabled={syncMutation.isPending}
                            onClick={() => syncMutation.mutate('PIPEDRIVE')}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            Sync Pipedrive
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--muted-foreground)] hover:text-red-500"
                            onClick={() => disconnectMutation.mutate('PIPEDRIVE')}
                          >
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full brand-gradient text-white"
                          onClick={() =>
                            connectMutation.mutate({
                              type: 'PIPEDRIVE',
                              config: { authMode: 'sandbox', pushActivities: true },
                            })
                          }
                        >
                          Pipedrive connection unavailable
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}
          </div>
        </TabsContent>

        {/* TAB 3: CODING AGENTS & MCP */}
        <TabsContent value="agent" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Direct Plugin Card */}
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="brand-gradient grid h-10 w-10 place-items-center rounded-xl text-white">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="font-editorial text-lg">Coding Agent MCP Plugin</CardTitle>
                      <CardDescription>Direct interface for Antigravity, Claude Code, Cursor, and OpenCode</CardDescription>
                    </div>
                  </div>
                  <Badge className="bg-[var(--positive)] text-white">Ready</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-[var(--text-small)] text-[var(--muted-foreground)]">
                  Coding agents can directly query your sales pipeline, ingest calls or emails, extract customer objections,
                  and run revenue queries without using the web UI.
                </p>

                {/* Agent Key */}
                <div className="space-y-2 rounded-xl bg-[var(--raised)] p-4 border border-[var(--border)]">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-[var(--foreground)]">Agent API Key (Bearer Token)</Label>
                    <span className="text-[10px] text-[var(--muted-foreground)]">Sovereign local auth</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value="valence_agent_master_key_sov2026"
                      className="font-mono text-xs bg-[var(--card)]"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText('valence_agent_master_key_sov2026')
                        toast.success('Agent API key copied!')
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Fast Setup Snippets */}
                <div className="space-y-3">
                  <Label className="text-xs font-medium">1-Click Configuration Snippets</Label>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 font-mono text-xs space-y-2">
                    <div className="flex justify-between items-center text-[var(--muted-foreground)] text-[11px]">
                      <span>Claude Code / Cursor (.cursor/mcp.json)</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify({ mcpServers: { valence: { command: 'bun', args: ['src/mcp/server.ts'] } } }, null, 2))
                          toast.success('MCP config copied!')
                        }}
                      >
                        Copy JSON
                      </Button>
                    </div>
                    <pre className="overflow-x-auto text-[11px] text-[var(--ink-secondary)] p-2 rounded bg-[var(--raised)]">
{`{
  "mcpServers": {
    "valence": {
      "command": "bun",
      "args": ["src/mcp/server.ts"]
    }
  }
}`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Interactive Agent Tool Tester */}
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-[var(--primary)]" />
                  <CardTitle className="font-editorial text-lg">Agent Tool Execution Sandbox</CardTitle>
                </div>
                <CardDescription>Test the MCP tools that coding agents execute in real-time</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Select MCP Tool</Label>
                  <select
                    value={agentTestTool}
                    onChange={(e) => setAgentTestTool(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)]"
                  >
                    <option value="valence_list_deals">valence_list_deals (Query active pipeline)</option>
                    <option value="valence_get_system_status">valence_get_system_status (Health & integrations)</option>
                    <option value="valence_get_copilot_advice">valence_get_copilot_advice (Grounded revenue consultation)</option>
                  </select>
                </div>

                <Button
                  onClick={handleRunAgentToolTest}
                  size="sm"
                  className="brand-gradient text-white gap-2"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Execute Tool as Coding Agent
                </Button>

                {agentToolResult && (
                  <div className="space-y-1.5 pt-2">
                    <Label className="text-[11px] text-[var(--muted-foreground)]">Tool Output (JSON Response)</Label>
                    <pre className="max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--raised)] p-3 font-mono text-[11px] text-[var(--ink-secondary)] scroll-warm">
                      {agentToolResult}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 4: INGESTED EMAILS FEED */}
        <TabsContent value="feed" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-editorial text-lg font-semibold">Live Ingested Sales Emails</h2>
              <p className="text-[var(--text-micro)] text-[var(--muted-foreground)]">
                Email threads pulled from Gmail, Outlook, or IMAP with automatic buyer sentiment and objection tagging.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => syncMutation.mutate('GMAIL')}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Pull New Emails</span>
            </Button>
          </div>

          <div className="space-y-3">
            {(emails.data?.items ?? []).length === 0 ? (
              <div className="glass-panel p-8 text-center rounded-2xl">
                <Mail className="mx-auto h-8 w-8 text-[var(--muted-foreground)] mb-2" />
                <p className="font-editorial text-sm font-medium">No email threads ingested yet</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  Connect Gmail or Outlook with browser sign-in, then Sync Now to ingest real customer emails.
                </p>
                <Button
                  size="sm"
                  className="mt-4 brand-gradient text-white"
                  onClick={() => syncMutation.mutate('GMAIL')}
                >
                  Sync Gmail
                </Button>
              </div>
            ) : (
              emails.data?.items.map((em) => (
                <div key={em.id} className="glass-card hover-lift p-4 rounded-2xl space-y-2 border border-[var(--border)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs text-[var(--foreground)]">{em.from}</span>
                      <ArrowRight className="h-3 w-3 text-[var(--muted-foreground)]" />
                      <span className="text-[11px] text-[var(--muted-foreground)]">{em.to}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {em.sentiment && (
                        <Badge
                          variant="outline"
                          className={
                            em.sentiment === 'POSITIVE'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                              : em.sentiment === 'OBJECTION'
                              ? 'border-red-500/30 bg-red-500/10 text-red-600'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
                          }
                        >
                          {em.sentiment}
                        </Badge>
                      )}
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        {new Date(em.sentAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">{em.subject}</h3>
                    {em.deal && (
                      <button
                        onClick={() => navigate(`/deals/${em.deal!.id}`)}
                        className="flex items-center gap-1 text-[11px] font-medium text-[var(--primary)] hover:underline"
                      >
                        <span>{em.deal.title}</span>
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-[var(--ink-secondary)] line-clamp-2">{em.bodyText}</p>

                  {/* Signals pills */}
                  {em.insightsJson?.signals && em.insightsJson.signals.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {em.insightsJson.signals.map((sig, i) => (
                        <span key={i} className="rounded-full bg-[var(--raised)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                          {sig}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* TAB 5: SYNC HISTORY & AUDIT LOG */}
        <TabsContent value="audit" className="space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="font-editorial text-lg">Integration Sync Audit Log</CardTitle>
              <CardDescription>Real-time audit trail of background and manual synchronization operations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(connections.data?.recentLogs ?? []).map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-[var(--raised)] border border-[var(--border)] text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`grid h-7 w-7 place-items-center rounded-lg ${
                          log.status === 'OK' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600'
                        }`}
                      >
                        {log.status === 'OK' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      </div>
                      <div>
                        <div className="font-medium text-[var(--foreground)]">
                          {log.connection?.name ?? log.connection?.type ?? 'Integration'} · {log.action}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">{log.message}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={connectModalType !== null} onOpenChange={() => setConnectModalType(null)}>
        <DialogContent className="glass-panel max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Connect {connectModalType === 'GMAIL' ? 'Google / Gmail' : connectModalType === 'OUTLOOK' ? 'Microsoft Outlook' : 'an IMAP inbox'}
            </DialogTitle>
            <DialogDescription>
              {connectModalType === 'IMAP'
                ? 'IMAP sync is not implemented yet — do not enter your mailbox password here.'
                : 'Sign-in opens in your system browser. VALENCE never sees your password and stores only sealed tokens.'}
            </DialogDescription>
          </DialogHeader>

          {connectModalType === 'IMAP' ? (
            <p className="text-sm text-[var(--ink-secondary)]">
              Real IMAP access is still on the roadmap. No credentials were saved or verified.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {connectModalType === 'GMAIL' ? 'Google OAuth Client ID' : 'Microsoft Entra Application (client) ID'}
                  <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">one-time setup; env var works too</span>
                </Label>
                <Input
                  className="font-mono text-xs"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  placeholder={connectModalType === 'GMAIL' ? 'xxxx.apps.googleusercontent.com' : '00000000-0000-0000-0000-000000000000'}
                />
              </div>
              {connectModalType === 'OUTLOOK' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Tenant</Label>
                  <Input value={tenantInput} onChange={(e) => setTenantInput(e.target.value)} placeholder="common" className="font-mono text-xs" />
                </div>
              )}
              <div className="rounded-xl bg-[var(--raised)] p-3 text-[11px] text-[var(--muted-foreground)] space-y-1">
                {connectModalType === 'GMAIL' ? (
                  <>
                    <p>Google Cloud Console → enable the Gmail API → OAuth consent screen → create a <b>Desktop app</b> client.</p>
                    <p>Scopes requested: <span className="font-mono">gmail.readonly</span> (read mail for analysis). No send access.</p>
                  </>
                ) : (
                  <>
                    <p>Microsoft Entra → App registrations → <b>Mobile and desktop applications</b> → redirect <span className="font-mono">http://localhost</span> → delegated <span className="font-mono">Mail.Read</span>.</p>
                    <p>Scopes requested: <span className="font-mono">Mail.Read</span> + sign-in. No send access.</p>
                  </>
                )}
                <p>Full steps: <span className="font-mono">docs/INTEGRATIONS_OAUTH.md</span></p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectModalType(null)}>Cancel</Button>
            {connectModalType !== 'IMAP' && (
              <Button
                className="brand-gradient text-white"
                disabled={oauthPending || !clientIdInput.trim()}
                onClick={() => void handleOAuthConnect(connectModalType as 'GMAIL' | 'OUTLOOK')}
              >
                {oauthPending ? 'Waiting for browser sign-in…' : 'Open browser sign-in'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
