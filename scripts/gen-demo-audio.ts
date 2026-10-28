// Generate a real spoken sales-call snippet via ZAI TTS -> wav for the AMBER E2E.
// A realistic discovery-call monologue rich in MEDDIC signals so the analysis
// stages have real material to extract from.
import ZAI from 'z-ai-web-dev-sdk'
import { writeFileSync } from 'node:fs'

const SCRIPT = `Hi Sarah, thanks for making time today. Before I show you anything, I'd love to understand your world a bit. Walk me through how your team handles pipeline reporting right now. What is manual about it? Interesting — so your reps spend around four hours a week updating stages by hand, and your forecast is still off by twenty percent most quarters. That lines up with what we hear from teams your size. Typically customers like Northwind cut that manual work by seventy percent and get forecast error under five percent within two months. Quick question — if we were to solve this, who besides you would need to be involved in the decision? And is there a formal security review we should prepare for? If we can align on that before the end of the month, we could realistically start a pilot with your enterprise team in early Q3. What budget range have you set aside for a tool like this?`

async function main() {
  const zai = await ZAI.create()
  const res = await zai.audio.tts.create({
    input: SCRIPT,
    response_format: 'wav',
  })
  // Response may be a fetch Response (per SDK), base64 string, or buffer
  let buf: Buffer | null = null
  if (res && typeof res === 'object' && typeof (res as Response).arrayBuffer === 'function') {
    buf = Buffer.from(await (res as Response).arrayBuffer())
  } else if (typeof res === 'string') {
    buf = Buffer.from(res, 'base64')
  } else if (res instanceof ArrayBuffer) {
    buf = Buffer.from(res)
  } else if (Buffer.isBuffer(res)) {
    buf = res
  } else if (res && typeof res === 'object') {
    const b64 = (res as { audio?: string; data?: string }).audio ?? (res as { data?: string }).data
    if (b64) buf = Buffer.from(b64, 'base64')
  }
  if (!buf || buf.length < 1000) {
    console.log('TTS_UNEXPECTED:', JSON.stringify(String(typeof res === 'object' && res ? Object.keys(res) : typeof res)), String(typeof res === 'string' ? res.slice(0, 60) : '').slice(0, 80))
    process.exit(1)
  }
  writeFileSync('/home/z/my-project/scripts/ui-audit/demo-call.wav', buf)
  console.log(`TTS_OK bytes=${buf.length}`)
}

main()
