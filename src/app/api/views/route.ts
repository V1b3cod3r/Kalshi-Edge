import { NextRequest, NextResponse } from 'next/server'
import { getViews, createView } from '@/lib/storage'

// GET handlers without dynamic APIs can be statically cached at build time in
// Next 14 — force runtime evaluation so responses always reflect current data.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const views = getViews()
    return NextResponse.json({ views })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load views' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const view = createView(body)
    return NextResponse.json({ view }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create view' },
      { status: 500 }
    )
  }
}
