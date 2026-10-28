// VALENCE — Unit tests for Voice Copilot Query Engine
import { describe, expect, it } from 'bun:test'
import { cleanForSpeech, processCopilotQuery } from '@/lib/copilot/query-engine'

describe('Voice Copilot Query Engine', () => {
  describe('cleanForSpeech formatter', () => {
    it('strips markdown bold, italics, and headers', () => {
      const input = '### Acme Corporation\n**Sarah** agreed to *sign* the order form.'
      const cleaned = cleanForSpeech(input)
      expect(cleaned).not.toContain('**')
      expect(cleaned).not.toContain('*')
      expect(cleaned).not.toContain('###')
      expect(cleaned).toContain('Sarah agreed to sign the order form')
    })

    it('strips markdown links and citations', () => {
      const input = 'Check out [Acme Deal](#/deals/123) and reference [SEGMENT:456].'
      const cleaned = cleanForSpeech(input)
      expect(cleaned).not.toContain('#/deals/123')
      expect(cleaned).not.toContain('[Acme Deal]')
      expect(cleaned).not.toContain('[SEGMENT:456]')
      expect(cleaned).toContain('Acme Deal')
    })

    it('smooths currency amounts for speech', () => {
      const input = 'The contract value is $150k and the pilot cost €45k.'
      const cleaned = cleanForSpeech(input)
      expect(cleaned).toContain('150 thousand dollars')
      expect(cleaned).toContain('45 thousand euros')
    })

    it('removes bullet points and cleans whitespace pauses', () => {
      const input = '- First action item\n- Second action item\n- Third action item'
      const cleaned = cleanForSpeech(input)
      expect(cleaned).not.toContain('-')
      expect(cleaned).toContain('First action item')
    })
  })

  describe('processCopilotQuery engine', () => {
    it('handles general pipeline queries', async () => {
      const result = await processCopilotQuery({ q: 'What deals are currently in my pipeline?' })
      expect(result).toBeDefined()
      expect(typeof result.spokenText).toBe('string')
      expect(typeof result.displayText).toBe('string')
      expect(Array.isArray(result.dealCards)).toBe(true)
      expect(Array.isArray(result.citations)).toBe(true)
      expect(Array.isArray(result.suggestedFollowUps)).toBe(true)
    })

    it('handles non-existent search gracefully with helpful fallback', async () => {
      const result = await processCopilotQuery({ q: 'NonExistentCompanyXYZ999' })
      expect(result).toBeDefined()
      expect(typeof result.spokenText).toBe('string')
      expect(result.spokenText.length).toBeGreaterThan(0)
      expect(result.suggestedFollowUps.length).toBeGreaterThan(0)
    })
  })
})
