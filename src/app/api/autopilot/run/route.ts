import { NextResponse } from 'next/server'
import { runAutopilotCycle } from '@/lib/autopilot'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  try {
    const report = await runAutopilotCycle()
    return NextResponse.json({ report })
  } catch (error: any) {
    // runAutopilotCycle catches its own errors; this is a last-resort net.
    console.error('Autopilot run error:', error)
    return NextResponse.json(
      { error: error?.message || 'Autopilot run failed' },
      { status: 500 }
    )
  }
}
