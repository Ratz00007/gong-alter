import { NextRequest } from 'next/server'
import { handler, ok, requireSession, notFound, fail } from '@/lib/http'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(req)
  const { id } = await ctx.params
  const db = getDb()
  const call = await db.call.findUnique({ where: { id } })
  if (!call) return notFound('Call')

  const body = (await req.json().catch(() => ({}))) as { crm?: string }
  const crmType = (body.crm?.toUpperCase() ?? 'HUBSPOT') as 'HUBSPOT' | 'SALESFORCE' | 'PIPEDRIVE'
  if (!['HUBSPOT', 'SALESFORCE', 'PIPEDRIVE'].includes(crmType)) {
    return fail('VALIDATION_ERROR', `Invalid CRM type: ${body.crm}. Supported: HUBSPOT, SALESFORCE, PIPEDRIVE`)
  }

  return ok({ ok: false, message: `Real ${crmType} integration is not implemented; nothing was sent.` })
})
