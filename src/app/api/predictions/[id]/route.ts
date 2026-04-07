import { NextRequest, NextResponse } from 'next/server'
import { resolvePrediction, deletePrediction } from '@/lib/storage'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { outcome } = await req.json()
    if (outcome !== 'YES' && outcome !== 'NO') {
      return NextResponse.json({ error: 'outcome must be YES or NO' }, { status: 400 })
    }
    const prediction = resolvePrediction(params.id, outcome)
    return NextResponse.json({ prediction })
  } catch (err: any) {
    if (err?.message?.includes('not found')) {
      return NextResponse.json({ error: 'Prediction not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to resolve prediction' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    deletePrediction(params.id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete prediction' }, { status: 500 })
  }
}
