import { NextRequest, NextResponse } from 'next/server'
import { getView, updateView, deleteView } from '@/lib/storage'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const view = getView(params.id)
    if (!view) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }
    return NextResponse.json({ view })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load view' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const view = updateView(params.id, body)
    return NextResponse.json({ view })
  } catch (error: any) {
    if (error?.message?.includes('not found')) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update view' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    deleteView(params.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete view' }, { status: 500 })
  }
}
