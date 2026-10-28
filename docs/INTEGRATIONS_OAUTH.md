# Connecting Gmail and Outlook (real browser sign-in)

VALENCE connects with OAuth — the sign-in page opens in **your browser**, and the
app never sees or stores your mailbox password. Access tokens are encrypted
(AES-256-GCM) before they touch the local database. Scopes are read-only:
`gmail.readonly` for Google, `Mail.Read` for Microsoft. No send access.

This is a one-time setup per provider: you create a free OAuth client and paste
its ID into **Integrations → Connect with Google/Microsoft**. You can also set
`GMAIL_CLIENT_ID` / `OUTLOOK_CLIENT_ID` in the environment instead.

## Gmail (Google)

1. Open <https://console.cloud.google.com/> and select (or create) a project.
2. **APIs & Services → Library →** enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen**: User type *External* (personal
   Gmail accounts), app name, your email, save. While the app is in *Testing*,
   add your Google account under **Test users** (authorization expires after 7
   days in Testing — publish the app for personal daily use).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Application type: Desktop app.** Copy the **Client ID**
   (`....apps.googleusercontent.com`).
5. In VALENCE: **Integrations → Connect with Google** → paste the Client ID →
   **Open browser sign-in**. Approve the read-only Gmail scope.
6. VALENCE calls `users/me/profile` to verify the account, then shows it as
   **Connected**. *Sync Now* pulls recent messages (25 per run) into the feed.

No redirect URI needs registering: desktop clients allow the loopback
(`http://127.0.0.1:<any port>`), which is where the sign-in result returns.

## Outlook / Microsoft 365

1. Open <https://entra.microsoft.com/> → **App registrations → New registration**.
2. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts** (or *personal only* for @outlook.com).
3. **Authentication → Add a platform → Mobile and desktop applications** →
   check `http://localhost` as the redirect URI (Microsoft allows any loopback
   port). Copy the **Application (client) ID**.
4. **API permissions → Add a permission → Microsoft Graph → Delegated →**
   `Mail.Read` (and `openid`, `email`, `profile`, `offline_access` are requested
   automatically). Personal accounts consent for themselves; work accounts may
   need an admin.
5. In VALENCE: **Integrations → Connect with Microsoft** → paste the client ID
   (and tenant: `consumers` for personal, `common` for both, or your directory
   ID) → **Open browser sign-in**.
6. VALENCE calls `GET /me` to verify the account, then syncs recent mail via
   Microsoft Graph.

## What "connected" means here

A connection only shows **Connected** after a live identity probe against the
provider succeeds. Rows created by older builds (demo/sandbox connectors) show
**Not verified** and can be removed with *Remove saved unverified credentials*;
disconnecting also wipes any stored credential blob.

## Not yet implemented

- IMAP password accounts and CRM connectors (HubSpot/Salesforce/Pipedrive) are
  still simulated — the UI labels them as unverified and refuses to save
  passwords until real flows exist.
- Real transcription needs local Whisper (`WHISPER_BINDING=whisper`), and local
  AI needs Ollama running.

## Troubleshooting

- *redirect_uri_mismatch* on Google: the client must be type **Desktop app**.
- *AADSTS* errors from Microsoft: check the redirect `http://localhost` exists
  under **Mobile and desktop applications**, and the tenant matches the account
  type (use `consumers` for @outlook.com).
- *State mismatch* in VALENCE: the browser tab took longer than 5 minutes —
  start the flow again.
- Tokens stop working after 7 days: the Google consent screen is in *Testing*;
  add yourself as a test user or publish the app.
