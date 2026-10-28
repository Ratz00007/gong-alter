// VALENCE — Universal Email Auto-Discovery
// Non-technical connection: user types their email address, and VALENCE automatically detects
// the optimal IMAP/SMTP host, port, TLS security, and instructions.

export interface DiscoveredEmailServer {
  domain: string
  providerName: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  requiresAppPassword: boolean
  setupHelpUrl: string
  notes?: string
}

const KNOWN_PROVIDERS: Record<string, DiscoveredEmailServer> = {
  'gmail.com': {
    domain: 'gmail.com',
    providerName: 'Google Gmail / Google Workspace',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://myaccount.google.com/apppasswords',
    notes: 'Use a 16-character Google App Password with 2FA enabled.',
  },
  'googlemail.com': {
    domain: 'googlemail.com',
    providerName: 'Google Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://myaccount.google.com/apppasswords',
  },
  'outlook.com': {
    domain: 'outlook.com',
    providerName: 'Microsoft Outlook / 365',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://account.live.com/proofs/AppPassword',
  },
  'hotmail.com': {
    domain: 'hotmail.com',
    providerName: 'Microsoft Hotmail / Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://account.live.com/proofs/AppPassword',
  },
  'icloud.com': {
    domain: 'icloud.com',
    providerName: 'Apple iCloud Mail',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://appleid.apple.com/account/manage',
    notes: 'Generate an app-specific password in Apple Account security settings.',
  },
  'me.com': {
    domain: 'me.com',
    providerName: 'Apple iCloud Mail',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://appleid.apple.com/account/manage',
  },
  'fastmail.com': {
    domain: 'fastmail.com',
    providerName: 'Fastmail',
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://www.fastmail.help/hc/en-001/articles/360058752854-App-passwords',
  },
  'zoho.com': {
    domain: 'zoho.com',
    providerName: 'Zoho Mail',
    imapHost: 'imappro.zoho.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtppro.zoho.com',
    smtpPort: 465,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://www.zoho.com/mail/help/imap-access.html',
  },
  'yahoo.com': {
    domain: 'yahoo.com',
    providerName: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
    requiresAppPassword: true,
    setupHelpUrl: 'https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html',
  },
}

/**
 * Auto-discovers server host and ports from an email address.
 * Falls back to canonical `imap.<domain>` / `smtp.<domain>` standard convention.
 */
export function autoDiscoverEmailSettings(email: string): DiscoveredEmailServer {
  const parts = email.trim().toLowerCase().split('@')
  const domain = parts.length > 1 ? parts[1] : 'custom.domain'

  if (KNOWN_PROVIDERS[domain]) {
    return KNOWN_PROVIDERS[domain]
  }

  // Heuristic convention for custom business domains
  return {
    domain,
    providerName: `${domain} Mail`,
    imapHost: `imap.${domain}`,
    imapPort: 993,
    imapSecure: true,
    smtpHost: `smtp.${domain}`,
    smtpPort: 587,
    smtpSecure: true,
    requiresAppPassword: false,
    setupHelpUrl: `https://${domain}`,
    notes: `Configured using standard SSL convention for ${domain}. You can edit host and port if your provider uses custom mail servers.`,
  }
}
