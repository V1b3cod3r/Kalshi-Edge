import { NextRequest, NextResponse } from 'next/server'
import { runScan, ScanError } from '@/lib/scan'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      category,
      limit = 15,
      min_volume = 0,
    }: {
      category?: string
      limit?: number
      min_volume?: number
    } = body

    const result = await runScan({ category, limit, min_volume })

    return NextResponse.json({
      opportunities: result.opportunities,
      screened_out: result.screened_out,
      session_notes: result.session_notes,
      markets_scanned: result.markets_scanned,
    })
  } catch (error: any) {
    if (error instanceof ScanError) {
      const status = error.code === 'config' ? 400 : error.code === 'no_markets' ? 404 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    console.error('Auto-scan error:', error)
    return NextResponse.json(
      { error: error?.message || 'Auto-scan failed' },
      { status: 500 }
    )
  }
}
