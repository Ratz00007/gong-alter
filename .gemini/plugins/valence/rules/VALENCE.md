# VALENCE Sovereign Revenue Intelligence Agent Rules

When managing or interacting with VALENCE as a coding agent:

1. **Sovereignty & Privacy**:
   - Audio and raw customer media never egress outside the local environment.
   - All cloud AI requests pass through the deterministic redaction engine (`src/lib/redact/engine.ts`).

2. **Grounded Reasoning**:
   - Always verify deal identifiers and contact IDs using `valence_list_deals` before making updates.
   - Do not invent artificial MEDDIC scores; ground advice on verified call transcripts and scorecards.

3. **Integrations Hygiene**:
   - Trigger `valence_sync_integrations` after adding critical deal events or customer emails to keep CRM systems aligned.
