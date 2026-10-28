---
name: valence-revenue-intelligence
description: Manage and query the VALENCE sovereign revenue intelligence platform directly. Use when inspecting deals, querying analyzed calls and transcripts, extracting buyer objections, triggering email inbox / CRM syncs, or querying the Voice Copilot.
---

# VALENCE Sovereign Revenue Intelligence Skill

Use this skill whenever you need to interact with the **VALENCE** sovereign revenue intelligence system (Gong alternative) as a coding agent.

## Core Capabilities

1. **Pipeline & Deal Management**:
   - Query deals by stage, health score, or account name (`valence_list_deals`).
   - Retrieve full deal dossiers with contacts, calls, and emails (`valence_get_deal`).
   - Create and update deals (`valence_create_deal`, `valence_update_deal`).

2. **Call Intelligence & MEDDIC Scorecards**:
   - List customer calls with duration, talk ratio, and MEDDIC score (`valence_list_calls`).
   - Access verbatim transcripts, speaker segments, objections, and follow-up emails (`valence_get_call`).
   - Grounded hybrid vector + keyword search across all calls (`valence_search_intelligence`).

3. **Autonomous Ingestion**:
   - Ingest sales call audio, conversation transcripts, or email threads directly (`valence_ingest_content`).
   - The sovereign pipeline automatically normalizes, transcribes, labels speakers, and extracts MEDDIC signals.

4. **Revenue Copilot ("Oracle")**:
   - Ask strategic revenue and coaching questions grounded with actual pipeline data (`valence_get_copilot_advice`).

5. **Universal Email & CRM Integrations**:
   - Trigger instant synchronization with Gmail, Outlook, IMAP, HubSpot, Salesforce, or Pipedrive (`valence_sync_integrations`).

## Example MCP Invocations

### Listing deals with health score under 80:
```json
{
  "name": "valence_list_deals",
  "arguments": {
    "minHealth": 80
  }
}
```

### Ingesting an email thread into the pipeline:
```json
{
  "name": "valence_ingest_content",
  "arguments": {
    "type": "EMAIL",
    "title": "Procurement Redline Discussion",
    "from": "cfo@acmecorp.com",
    "to": "sales@ourcompany.com",
    "text": "We have reviewed the enterprise pricing proposal. Can you bundle 50 additional licenses for EMEA?"
  }
}
```

### Querying the Copilot on objection handling:
```json
{
  "name": "valence_get_copilot_advice",
  "arguments": {
    "query": "What are our primary competitor objections against Gong and Chorus, and how should reps respond?"
  }
}
```

## REST API Fallback
When connecting over HTTP instead of stdio MCP:
- Endpoint: `http://localhost:3000/api/agent/v1`
- Auth: `Authorization: Bearer valence_agent_master_key_sov2026` or `x-valence-key: valence_agent_master_key_sov2026`
