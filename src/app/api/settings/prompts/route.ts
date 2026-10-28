import { NextRequest } from 'next/server'
import { handler, collection, requireSession } from '@/lib/http'
import { listTemplates } from '@/lib/prompts/engine'

export const dynamic = 'force-dynamic'

export const GET = handler(async (req: NextRequest) => {
  requireSession(req)
  const items = await listTemplates()
  return collection(items, items.length)
})
