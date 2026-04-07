import { NextRequest, NextResponse } from 'next/server'
import { getSession, saveSession } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = getSession()
    return NextResponse.json({ session })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const current = getSession()
    const updated = { ...current, ...body }
    saveSession(updated)
    return NextResponse.json({ session: updated })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save session' }, { status: 500 })
  }
}
