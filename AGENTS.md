# Universal Coding Agent Contract — GONG-ALTER

This repository is synchronized with Ratin's Second Brain in Obsidian:
- **Project Hub**: `10-Projects/gong-alter/gong-alter Hub.md`
- **Knowledge Graph**: `10-Projects/gong-alter/Graph Architecture.md`
- **Visual Canvas**: `10-Projects/gong-alter/gong-alter Architecture.canvas`
- **Memory CLI**: `agent-mem context gong-alter` · `agent-mem recap`

## 1. Cross-Agent Continuity Directive
ALL agents (Freebuff, Antigravity, OpenCode, Claude Code, Hermes, Cursor, Codex, Devin) working in this project MUST maintain context continuity:
1. **On Session Start**: Run `agent-mem context gong-alter` or review the live ledger below.
2. **On Session Conclusion**: Run `agent-mem recap --project gong-alter --agent <your_agent> --title "<title>" --summary "<summary>"` to synchronize subsequent agents.

## Live Cross-Agent Continuity Ledger (Auto-Synced: 2026-10-28 04:46)
> ALL coding agents (Freebuff, Antigravity, OpenCode, Claude Code, Hermes, Cursor, Codex, Devin) MUST review this shared ledger before answering user requests. If the user refers to recent conversations or tasks, this is the canonical history.

- **[2026-10-28] 🤖 `antigravity` on `windows-meeting-recorder`**: 2026-10-28 — Deployed Online Meeting Capture Fix to Installed App and Built Installer recap
  *Summary*: Diagnosed that user was running Stillnote via desktop shortcut pointing to AppData Local Programs Stillnote, which had an un-updated app.asar from Oct 19. Added direct main-window sender verification and speaker-selec...
- **[2026-10-28] 🤖 `antigravity` on `advantage-incubator-platform`**: 2026-10-28 — Completed Waves 0-4 Product-Grade Transformation recap
  *Summary*: Completed brutal 7-panel audit and full implementation of Waves 0, 1, 2, 3, and 4. Delivered edge SSRF fix, distributed rate-limiting, encrypted disaster recovery, SSE token streaming mentor, cognitive memory, FSRS v4...
- **[2026-10-28] 🤖 `antigravity` on `windows-meeting-recorder`**: 2026-10-28 — Smart Sentence Grouping and Anti-Hallucination for Transcription recap
  *Summary*: Fixed Whisper repetition loops and fragmented 2-second timestamp clutter. Added repetition_penalty and no_repeat_ngram_size in model generation, implemented intra-phrase and consecutive segment deduplication for silen...
- **[2026-10-28] 🤖 `antigravity` on `windows-meeting-recorder`**: 2026-10-28 — Fixed Invalid Capture Constraints for Online Meetings recap
  *Summary*: Diagnosed and resolved 'Invalid capture constraints' error when starting an Online call. Fixed Electron setDisplayMediaRequestHandler origin resolution where request.senderFrame was undefined, added missing display-ca...
- **[2026-10-28] 🤖 `antigravity` on `gstack`**: 2026-10-28 — Universal Cross-Agent Continuity for Freebuff, Antigravity, Hermes, OpenCode, Claude Code recap
  *Summary*: Integrated Freebuff Desktop SQLite ingestion (17 sessions synced), updated Antigravity global rules (.gemini/config/AGENTS.md), and distributed tailored AGENTS.md and CLAUDE.md across all 37 active project repositorie...
- **[2026-10-28] 🤖 `antigravity` on `gong-alter`**: 2026-10-28 — Resolved Sandbox Desktop Isolation & Launched Interactive Native Windows App recap
  *Summary*: Diagnosed why clicking the desktop shortcut previously failed: 1) Agent runner sandbox desktop isolation (exebox vs WinSta0\Default), 2) Single-instance lock deadlock between background test process and user interacti...

- *Unified Memory CLI*: Run `agent-mem context <proj>` or `agent-mem search "<query>"` to load deeper history.
- *Central Vault*: `C:\Users\ratin\Documents\Obsidian Vault`


## 2. Graph Architecture & Core Abstractions
Consult `graphify-out/GRAPH_REPORT.md` or `10-Projects/gong-alter/Graph Architecture.md` for community structure and God Nodes before performing large refactors. Run `graphify update .` after touching code files.
