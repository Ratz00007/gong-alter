// VALENCE Agent API v1 — Content Ingestion (Audio / Transcript / Email)
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { intakeCall } from '@/lib/pipeline/orchestrator'
import { storeAsset, storeScript } from '@/lib/media/vault'
import { createPureWavBuffer } from '@/lib/audio/wav'
import { ingestEmailMessage } from '@/lib/integrations/email/engine'
import { z } from 'zod'

const ingestSchema = z.object({
  type: z.enum(['TRANSCRIPT', 'AUDIO', 'EMAIL']),
  title: z.string().min(1),
  dealId: z.string().optional(),
  contactId: z.string().optional(),
  // For TRANSCRIPT
  transcriptText: z.string().optional(),
  speakerTurns: z
    .array(
      z.object({
        speaker: z.string(),
        text: z.string(),
        startMs: z.number().default(0),
        endMs: z.number().default(1000),
      }),
    )
    .optional(),
  // For EMAIL
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  bodyText: z.string().optional(),
  // For AUDIO
  durationSec: z.number().int().positive().default(30),
})

export async function POST(req: NextRequest) {
  const db = getDb()
  try {
    const body = await req.json()
    const parsed = ingestSchema.parse(body)

    if (parsed.type === 'EMAIL') {
      const emailRes = await ingestEmailMessage({
        externalId: `agent-msg-${Date.now()}`,
        from: parsed.from ?? 'prospect@client.com',
        to: parsed.to ?? 'sales@ourcompany.com',
        subject: parsed.subject ?? parsed.title,
        bodyText: parsed.bodyText ?? parsed.transcriptText ?? '',
        sentAt: new Date(),
        direction: 'INBOUND',
      })
      return NextResponse.json({ ok: true, type: 'EMAIL', result: emailRes })
    }

    // For TRANSCRIPT or AUDIO, create a Call
    const wavDuration = parsed.durationSec || 30
    const wavBuf = createPureWavBuffer(wavDuration, 440)
    const { asset } = await storeAsset(wavBuf, 'audio/wav', `${parsed.title.replace(/\s+/g, '-').toLowerCase()}.wav`)

    const call = await intakeCall({
      title: parsed.title,
      dealId: parsed.dealId ?? null,
      contactId: parsed.contactId ?? null,
      occurredAt: new Date(),
      mediaAssetId: asset.id,
      audioSha256: asset.sha256,
    })

    // Store scripted transcript if provided
    if (parsed.speakerTurns && parsed.speakerTurns.length > 0) {
      storeScript(
        call.id,
        JSON.stringify({
          language: 'en',
          segments: parsed.speakerTurns.map((s, idx) => ({
            speaker: s.speaker.toUpperCase().includes('REP') ? 'SPEAKER_00' : 'SPEAKER_01',
            startMs: s.startMs || idx * 3000,
            endMs: s.endMs || (idx + 1) * 3000,
            text: s.text,
          })),
        }),
      )
    } else if (parsed.transcriptText) {
      // Split into simple sentences
      const sentences = parsed.transcriptText.split(/[.?!]\s+/).filter(Boolean)
      storeScript(
        call.id,
        JSON.stringify({
          language: 'en',
          segments: sentences.map((sent, idx) => ({
            speaker: idx % 2 === 0 ? 'SPEAKER_00' : 'SPEAKER_01',
            startMs: idx * 4000,
            endMs: (idx + 1) * 4000,
            text: sent.trim(),
          })),
        }),
      )
    }

    return NextResponse.json({
      ok: true,
      type: parsed.type,
      callId: call.id,
      status: call.status,
      message: 'Content queued for sovereign revenue intelligence analysis',
    })
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'INGEST_FAILED', message: e instanceof Error ? e.message : 'Ingestion failed' } },
      { status: 400 },
    )
  }
}
