// Unit: desktop OAuth primitives (PKCE, sealed tokens, auth URLs) and live mail
// mappers. No network — the browser round trip is exercised manually per
// docs/INTEGRATIONS_OAUTH.md with a real Google/Microsoft test account.
import { describe, test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { pkcePair, base64url, buildAuthUrl, sealTokens, openTokens } from '@/lib/integrations/oauth'
import { mapGmailMessage, mapGraphMessage } from '@/lib/integrations/email/live'

describe('PKCE pair', () => {
  test('verifier is high-entropy base64url and challenge is its S256 digest', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toBe(base64url(createHash('sha256').update(verifier).digest()))
  })

  test('pairs are unique per attempt', () => {
    expect(pkcePair().verifier).not.toBe(pkcePair().verifier)
  })
})

describe('sealed token storage', () => {
  const tokens = {
    accessToken: 'at-123',
    refreshToken: 'rt-456',
    expiresAt: Date.now() + 3600_000,
    scope: 'gmail.readonly',
  }

  test('round-trips tokens without leaking plaintext in the seal', () => {
    const sealed = sealTokens(tokens)
    expect(sealed).not.toContain('at-123')
    expect(sealed.split('.').length).toBe(4)
    const opened = openTokens(sealed)
    expect(opened.accessToken).toBe('at-123')
    expect(opened.refreshToken).toBe('rt-456')
    expect(opened.scope).toBe('gmail.readonly')
  })

  test('tampered seals are rejected, never decrypted to garbage', () => {
    const sealed = sealTokens(tokens)
    const [v, iv, tag, data] = sealed.split('.')
    const flipped = data[0] === 'A' ? `B${data.slice(1)}` : `A${data.slice(1)}`
    expect(() => openTokens([v, iv, tag, flipped].join('.'))).toThrow()
    expect(() => openTokens('v1.a.b.c')).toThrow()
    expect(() => openTokens('v2.a.b.c')).toThrow()
  })
})

describe('authorization URLs', () => {
  const base = { clientId: 'cid', redirectUri: 'http://127.0.0.1:41000/', state: 'st', challenge: 'ch' }

  test('Google URL is the v2 desktop flow with PKCE and offline access', () => {
    const url = new URL(buildAuthUrl({ provider: 'GMAIL', ...base }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:41000/')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('ch')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('scope')).toContain('gmail.readonly')
    expect(url.searchParams.get('scope')).not.toContain('gmail.send')
  })

  test('Microsoft URL targets the tenant with PKCE and Mail.Read only', () => {
    const url = new URL(
      buildAuthUrl({ provider: 'OUTLOOK', ...base, redirectUri: 'http://localhost:41001/', tenant: 'consumers' }),
    )
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:41001/')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('Mail.Read')
    expect(url.searchParams.get('scope')).not.toContain('Mail.Send')
  })
})

describe('live mail mappers', () => {
  test('mapGmailMessage extracts headers case-insensitively and labels direction', () => {
    const msg = {
      id: 'm1',
      internalDate: '1700000000000',
      snippet: 'Can we see pricing?',
      payload: {
        headers: [
          { name: 'From', value: 'buyer@acme.com' },
          { name: 'To', value: 'me@company.com' },
          { name: 'Subject', value: 'Pricing question' },
        ],
      },
    }
    const mapped = mapGmailMessage(msg, 'me@company.com')
    expect(mapped.externalId).toBe('gmail:m1')
    expect(mapped.from).toBe('buyer@acme.com')
    expect(mapped.to).toBe('me@company.com')
    expect(mapped.subject).toBe('Pricing question')
    expect(mapped.bodyText).toBe('Can we see pricing?')
    expect(mapped.direction).toBe('INBOUND')
    expect(mapped.sentAt.getTime()).toBe(1700000000000)

    const sent = mapGmailMessage({ ...msg, payload: { headers: [{ name: 'From', value: 'Me@company.com' }] } }, 'me@company.com')
    expect(sent.direction).toBe('OUTBOUND')
  })

  test('mapGraphMessage maps Graph fields and falls back to the message id', () => {
    const mapped = mapGraphMessage(
      {
        id: 'g1',
        subject: 'Renewal',
        bodyPreview: 'Countersigned.',
        receivedDateTime: '2026-10-28T10:00:00Z',
        from: { emailAddress: { address: 'buyer@acme.com' } },
        toRecipients: [{ emailAddress: { address: 'me@company.com' } }],
      },
      'me@company.com',
    )
    expect(mapped.externalId).toBe('graph:g1')
    expect(mapped.subject).toBe('Renewal')
    expect(mapped.bodyText).toBe('Countersigned.')
    expect(mapped.direction).toBe('INBOUND')
    expect(mapped.sentAt.toISOString()).toBe('2026-10-28T10:00:00.000Z')

    const withId = mapGraphMessage({ id: 'g2', internetMessageId: '<abc@x>' }, 'me@company.com')
    expect(withId.externalId).toBe('<abc@x>')
    expect(withId.subject).toBe('(no subject)')
    expect(withId.direction).toBe('INBOUND')
  })
})
