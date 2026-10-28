// Probe ZAI SDK: model param behavior + ASR round-trip.
import ZAI from 'z-ai-web-dev-sdk'
import { execSync } from 'node:child_process'

async function main() {
  const zai = await ZAI.create()

  // 1) explicit model param
  try {
    const r = await zai.chat.completions.create({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      thinking: { type: 'disabled' },
    })
    console.log('MODEL_EXPLICIT_OK:', JSON.stringify(r.choices?.[0]?.message?.content?.slice(0, 80)))
  } catch (e) {
    console.log('MODEL_EXPLICIT_FAIL:', e instanceof Error ? e.message.slice(0, 150) : String(e))
  }

  // 2) usage/token fields present?
  try {
    const r = await zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      thinking: { type: 'disabled' },
    })
    console.log('DEFAULT_MODEL_OK usage:', JSON.stringify(r.usage ?? null).slice(0, 200), 'model:', r.model ?? '(none)')
  } catch (e) {
    console.log('DEFAULT_FAIL:', e instanceof Error ? e.message.slice(0, 150) : String(e))
  }

  // 3) ASR: generate a tiny spoken wav via espeak/macos say fallback -> test base64 path
  try {
    execSync('which espeak || which ffmpeg || echo none', { stdio: 'ignore' })
    // make 1s silent-ish tone wav as smoke (ASR may return empty text; we only verify the call shape)
    const wav = Buffer.alloc(16000 * 2 + 44)
    // RIFF header for 16kHz 16-bit mono
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + 16000 * 2, 4); wav.write('WAVE', 8)
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
    wav.write('data', 36); wav.writeUInt32LE(32000, 40)
    for (let i = 0; i < 16000; i++) {
      const v = Math.round(Math.sin((i / 60) * Math.PI * 2) * 3000 * (0.5 + 0.5 * Math.sin(i / 800)))
      wav.writeInt16LE(v, 44 + i * 2)
    }
    const r = await zai.audio.asr.create({ file_base64: wav.toString('base64') })
    console.log('ASR_SHAPE_OK:', JSON.stringify(r).slice(0, 300))
  } catch (e) {
    console.log('ASR_FAIL:', e instanceof Error ? e.message.slice(0, 200) : String(e))
  }
}

main()
