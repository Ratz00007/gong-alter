// VALENCE — Integration & Connector Types (Email Inboxes, CRMs, Coding Agents)
import type { IntegrationType, IntegrationStatus } from '@prisma/client'

export type { IntegrationType, IntegrationStatus }

export interface BaseConnectorConfig {
  accountEmail?: string
  autoSync?: boolean
  syncIntervalMin?: number
}

export interface GmailConnectorConfig extends BaseConnectorConfig {
  authMode: 'oauth' | 'sandbox' | 'app_password'
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  labelFilter?: string // e.g. "INBOX", "Sales"
}

export interface OutlookConnectorConfig extends BaseConnectorConfig {
  authMode: 'oauth' | 'sandbox' | 'app_password'
  accessToken?: string
  refreshToken?: string
  tenantId?: string
  clientId?: string
  folderFilter?: string
}

export interface ImapConnectorConfig extends BaseConnectorConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password?: string
  folder?: string
}

export interface HubSpotConnectorConfig extends BaseConnectorConfig {
  authMode: 'token' | 'sandbox'
  accessToken?: string
  portalId?: string
  syncDeals?: boolean
  pushCallNotes?: boolean
  pushMeddicScores?: boolean
}

export interface SalesforceConnectorConfig extends BaseConnectorConfig {
  authMode: 'token' | 'sandbox'
  instanceUrl?: string
  accessToken?: string
  refreshToken?: string
  pushTasks?: boolean
  syncOpportunities?: boolean
}

export interface PipedriveConnectorConfig extends BaseConnectorConfig {
  authMode: 'token' | 'sandbox'
  apiToken?: string
  companyDomain?: string
  pushActivities?: boolean
}

export interface WebhookConnectorConfig extends BaseConnectorConfig {
  targetUrl: string
  secretKey?: string
  events: ('call.analyzed' | 'deal.health_changed' | 'cue.fired' | 'email.ingested')[]
}

export type AnyConnectorConfig =
  | GmailConnectorConfig
  | OutlookConnectorConfig
  | ImapConnectorConfig
  | HubSpotConnectorConfig
  | SalesforceConnectorConfig
  | PipedriveConnectorConfig
  | WebhookConnectorConfig

export interface TestConnectionResult {
  ok: boolean
  latencyMs: number
  message: string
  details?: Record<string, unknown>
}

export interface SyncConnectionResult {
  ok: boolean
  connectionId: string
  type: IntegrationType
  itemsSynced: number
  durationMs: number
  message: string
  details?: Record<string, unknown>
}

export interface IngestedEmail {
  externalId: string
  from: string
  to: string
  subject: string
  bodyText: string
  sentAt: Date
  direction: 'INBOUND' | 'OUTBOUND'
  sentiment?: 'POSITIVE' | 'NEUTRAL' | 'CAUTION' | 'OBJECTION'
  intent?: 'INQUIRY' | 'PRICING' | 'OBJECTION' | 'CLOSING' | 'GENERAL'
  insights?: {
    signals: string[]
    objections: string[]
    suggestedDealTitle?: string
    companyDomain?: string
  }
}
