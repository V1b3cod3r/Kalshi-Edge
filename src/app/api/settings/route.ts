import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/storage'

export const dynamic = 'force-dynamic'

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '••••••••' : ''
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

export async function GET() {
  try {
    const settings = getSettings()
    return NextResponse.json({
      settings: {
        ...settings,
        anthropic_api_key: maskKey(settings.anthropic_api_key),
        kalshi_api_key: maskKey(settings.kalshi_api_key),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const current = getSettings()

    // Only update API keys if they are not masked values
    const newSettings = { ...current, ...body }
    if (body.anthropic_api_key !== undefined) {
      if (body.anthropic_api_key.includes('••••')) {
        newSettings.anthropic_api_key = current.anthropic_api_key
      }
    }
    if (body.kalshi_api_key !== undefined) {
      if (body.kalshi_api_key.includes('••••')) {
        newSettings.kalshi_api_key = current.kalshi_api_key
      }
    }

    saveSettings(newSettings)
    return NextResponse.json({
      settings: {
        ...newSettings,
        anthropic_api_key: maskKey(newSettings.anthropic_api_key),
        kalshi_api_key: maskKey(newSettings.kalshi_api_key),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
