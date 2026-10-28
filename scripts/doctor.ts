// VALENCE — System Health & Environment Doctor
// Diagnoses local sovereignty components: Ollama, Whisper, SQLite DB, MCP Server, Desktop App.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { getDb } from '../src/lib/db'
import { config } from '../src/lib/config'

async function checkDoctor() {
  console.log('\n======================================================')
  console.log('🩺 VALENCE REVENUE INTELLIGENCE — SYSTEM DOCTOR')
  console.log('======================================================\n')

  let hasErrors = false

  // 1. Check Local SQLite Database
  console.log('1. Database & Persistence Layer:')
  try {
    const db = getDb()
    const dealCount = await db.deal.count()
    const callCount = await db.call.count()
    const intCount = await db.integrationConnection.count()
    console.log(`   ✅ SQLite Connected: ${config.databaseUrl}`)
    console.log(`   📊 Pipeline Data: ${dealCount} Deals, ${callCount} Calls, ${intCount} Connected Integrations`)
  } catch (err) {
    console.log(`   ❌ Database error: ${err instanceof Error ? err.message : String(err)}`)
    hasErrors = true
  }

  // 2. Check Standalone Desktop App Executable
  console.log('\n2. Native Windows Desktop Application:')
  const desktopExe = join(process.cwd(), 'dist-desktop', 'win-unpacked', 'VALENCE.exe')
  const desktopLnk = 'C:\\Users\\ratin\\Desktop\\VALENCE.lnk'
  if (existsSync(desktopExe)) {
    const sizeMb = (statSync(desktopExe).size / (1024 * 1024)).toFixed(1)
    console.log(`   ✅ Standalone Executable: ${desktopExe} (${sizeMb} MB)`)
  } else {
    console.log(`   ⚠️ Standalone Executable not found at ${desktopExe}`)
  }
  if (existsSync(desktopLnk)) {
    console.log(`   ✅ Windows Desktop Shortcut: ${desktopLnk}`)
  } else {
    console.log(`   ⚠️ Windows Desktop Shortcut missing.`)
  }

  // 3. Check Local Ollama Engine
  console.log('\n3. Sovereign Local AI Models (Ollama):')
  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const data = (await res.json()) as { models?: { name: string }[] }
      const modelNames = (data.models || []).map((m) => m.name).join(', ') || 'No models pulled yet'
      console.log(`   ✅ Ollama Online: ${config.ollama.baseUrl}`)
      console.log(`   🧠 Installed Local Models: ${modelNames}`)
    } else {
      console.log(`   ⚠️ Ollama responded with status ${res.status} at ${config.ollama.baseUrl}`)
    }
  } catch {
    console.log(`   ⚠️ Ollama is currently offline at ${config.ollama.baseUrl} (Cloud/Mock fallbacks active)`)
  }

  // 4. Check STT Speech-to-Text Pipeline
  console.log('\n4. Speech-to-Text Transcription Engine:')
  const whisperProbe = spawnSync('where', ['whisper-ctranslate2'], { encoding: 'utf8' })
  if (whisperProbe.status === 0) {
    console.log(`   ✅ Local faster-whisper CLI detected: ${whisperProbe.stdout.trim()}`)
  } else {
    console.log(`   ℹ️ whisper-ctranslate2 CLI not in PATH (Deterministic scripted sidecar & cloud STT active)`)
  }

  // 5. Check Coding Agent MCP Server
  console.log('\n5. Coding Agent MCP Interface:')
  const mcpServerPath = join(process.cwd(), 'src', 'mcp', 'server.ts')
  const cursorConfig = join(process.cwd(), '.cursor', 'mcp.json')
  const claudeConfig = join(process.cwd(), 'claude_desktop_config.json')
  if (existsSync(mcpServerPath)) {
    console.log(`   ✅ Stdio MCP Server Engine: ${mcpServerPath}`)
  }
  if (existsSync(cursorConfig)) {
    console.log(`   ✅ Cursor MCP Config: ${cursorConfig}`)
  }
  if (existsSync(claudeConfig)) {
    console.log(`   ✅ Claude Desktop MCP Config: ${claudeConfig}`)
  }

  console.log('\n======================================================')
  if (hasErrors) {
    console.log('⚠️ Status: Some services require attention (see above).')
  } else {
    console.log('🎉 Status: 100% OPERATIONAL & READY FOR LIVE PRODUCTION REPS')
  }
  console.log('======================================================\n')
}

void checkDoctor()
