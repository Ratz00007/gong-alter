// Debug TTS response shape.
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const res = await zai.audio.tts.create({ input: 'Hello Sarah, this is a test.', response_format: 'wav' })
  console.log('typeof:', typeof res)
  if (res && typeof res === 'object') {
    if (res instanceof ArrayBuffer) console.log('ArrayBuffer byteLength:', res.byteLength)
    else console.log('keys:', Object.keys(res), JSON.stringify(Object.prototype.toString.call(res)))
    for (const k of Object.keys(res as object).slice(0, 5)) {
      const v = (res as Record<string, unknown>)[k]
      console.log(`  ${k}: type=${typeof v} preview=${typeof v === 'string' ? v.slice(0, 50) : String(v).slice(0, 80)}`)
    }
  } else if (typeof res === 'string') {
    console.log('string len:', res.length, 'preview:', res.slice(0, 80))
  }
}

main()
