import { NextRequest, NextResponse } from 'next/server'
import { resolvePrediction, deletePrediction, getSettings } from '@/lib/storage'
import { extractLessonForPrediction } from '@/lib/lessons'

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

    // Fire-and-forget lesson extraction for wrong predictions
    if (prediction.direction !== prediction.outcome) {
      const settings = getSettings()
      if (settings.anthropic_api_key) {
        extractLessonForPrediction(prediction, settings.anthropic_api_key).catch(() => {})
      }
    }

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
