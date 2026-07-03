import { NextRequest, NextResponse } from 'next/server'
import { getAutopilotRuns } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get('limit')
    let limit = limitParam ? parseInt(limitParam, 10) : 20
    if (!Number.isFinite(limit) || limit < 1) limit = 20
    limit = Math.min(limit, 100)
    return NextResponse.json({ runs: getAutopilotRuns(limit) })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load autopilot log' },
      { status: 500 }
    )
  }
}
