import { NextResponse } from 'next/server'
import { getCalibrationStats } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ stats: getCalibrationStats() })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load calibration stats' }, { status: 500 })
  }
}
