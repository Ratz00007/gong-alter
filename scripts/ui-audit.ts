// UI audit: send screenshots to VLM for a professional UI/UX critique.
import ZAI from 'z-ai-web-dev-sdk'
import { readFileSync } from 'node:fs'

const files = [
  'v4-dashboard.png',
  'v4-calls.png',
]

async function main() {
  const zai = await ZAI.create()
  for (const f of files) {
    const b64 = readFileSync(`/home/z/my-project/scripts/ui-audit/${f}`).toString('base64')
    try {
      const completion = await zai.chat.completions.createVision({
        model: 'glm-4.6',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are a strict principal product designer (ex-Linear, ex-Arc). This is the "${f.replace('.png', '')}" screen of AMBER, a private revenue-intelligence app with a warm cream design system. Rate visual craft out of 10, then list the 3 highest-impact improvements (specific: spacing, hierarchy, color, typography, component polish). No praise padding. Format: SCORE: n/10\\n1. ...\\n2. ...\\n3. ...`,
              },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      })
      const text = completion.choices?.[0]?.message?.content ?? ""
      console.log(`\n===== ${f} =====\n${text.trim().slice(0, 900)}`)
    await new Promise((r) => setTimeout(r, 8000))
    } catch (e) {
      console.log(`\n===== ${f} =====\nVLM_FAIL: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

main()
