// Quick probe: does the z-ai SDK work in this sandbox without manual config?
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a terse JSON emitter.' },
        { role: 'user', content: 'Return exactly this JSON object: {"ok": true, "provider": "zai"}' },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices?.[0]?.message?.content ?? ''
    console.log('CHAT_OK:', JSON.stringify(text.slice(0, 200)))
  } catch (e) {
    console.log('CHAT_FAIL:', e instanceof Error ? e.message : String(e))
  }
}

main()
