import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/storage'
import { AutopilotSettings } from '@/lib/types'

export const dynamic = 'force-dynamic'

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '••••••••' : ''
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

// Server-side bounds on the FINAL (post-merge) autopilot settings — the only
// enforcement that previously existed was client-side HTML min/max attributes
// on the autopilot page's <input> elements, trivially bypassed by a direct
// PUT. A bad write to a dollar-denominated guardrail field (a typo appending
// a zero to max_daily_loss_usd or max_exposure_usd) defeats that specific
// guardrail with zero code-level resistance — kelly_fraction itself is still
// clamped by evaluateOpportunity's headroom math, but the guardrail CAPS it's
// clamped against are not. Ranges mirror the autopilot page's own <input>
// min/max attributes plus the ordering intent already documented on
// DEFAULT_AUTOPILOT (storage.ts). Rejects (not silently clamps) an
// out-of-range write, so a legitimate deliberate change (e.g. raising
// max_exposure_usd as the account grows) surfaces as an error to fix, not a
// number quietly clamped underneath the caller.
function validateAutopilotSettings(ap: AutopilotSettings): string[] {
  const errors: string[] = []
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const positive = (name: string, v: unknown) => {
    if (!finite(v) || v <= 0) errors.push(`${name} must be a positive number`)
  }
  const nonNegative = (name: string, v: unknown) => {
    if (!finite(v) || v < 0) errors.push(`${name} must be a non-negative number`)
  }
  const inRange = (name: string, v: unknown, min: number, max: number) => {
    if (!finite(v) || v < min || v > max) errors.push(`${name} must be between ${min} and ${max}`)
  }

  inRange('kelly_fraction', ap.kelly_fraction, 0.05, 1)
  inRange('min_effective_edge_pct', ap.min_effective_edge_pct, 0, 100)
  positive('max_per_trade_usd', ap.max_per_trade_usd)
  positive('max_daily_spend_usd', ap.max_daily_spend_usd)
  positive('max_daily_loss_usd', ap.max_daily_loss_usd)
  positive('max_exposure_usd', ap.max_exposure_usd)
  positive('max_per_cluster_usd', ap.max_per_cluster_usd)
  inRange('max_open_positions', ap.max_open_positions, 1, 1000)
  inRange('scan_limit', ap.scan_limit, 1, 500)
  inRange('take_profit_pct', ap.take_profit_pct, 1, 1000)
  inRange('max_days_to_resolution', ap.max_days_to_resolution, 1, 3650)
  nonNegative('min_resolved_predictions_for_live', ap.min_resolved_predictions_for_live)
  inRange('kelly_haircut_high_pp', ap.kelly_haircut_high_pp, 0, 100)
  inRange('kelly_haircut_medium_pp', ap.kelly_haircut_medium_pp, 0, 100)
  inRange('kelly_haircut_low_pp', ap.kelly_haircut_low_pp, 0, 100)

  // Ordering intent already documented on DEFAULT_AUTOPILOT: the per-trade
  // cap is meaningless if it exceeds what a single day/the whole book could
  // ever spend anyway.
  if (finite(ap.max_per_trade_usd) && finite(ap.max_daily_spend_usd) && ap.max_per_trade_usd > ap.max_daily_spend_usd) {
    errors.push('max_per_trade_usd cannot exceed max_daily_spend_usd')
  }
  if (finite(ap.max_daily_spend_usd) && finite(ap.max_exposure_usd) && ap.max_daily_spend_usd > ap.max_exposure_usd) {
    errors.push('max_daily_spend_usd cannot exceed max_exposure_usd')
  }
  if (finite(ap.max_per_cluster_usd) && finite(ap.max_exposure_usd) && ap.max_per_cluster_usd > ap.max_exposure_usd) {
    errors.push('max_per_cluster_usd cannot exceed max_exposure_usd')
  }

  if (ap.strategy_dated_favorites_enabled) {
    inRange('dated_favorites_min_price_cents', ap.dated_favorites_min_price_cents, 1, 99)
    inRange('dated_favorites_max_price_cents', ap.dated_favorites_max_price_cents, 1, 99)
    if (finite(ap.dated_favorites_min_price_cents) && finite(ap.dated_favorites_max_price_cents) &&
        ap.dated_favorites_min_price_cents > ap.dated_favorites_max_price_cents) {
      errors.push('dated_favorites_min_price_cents cannot exceed dated_favorites_max_price_cents')
    }
    positive('dated_favorites_min_days', ap.dated_favorites_min_days)
    positive('dated_favorites_max_days', ap.dated_favorites_max_days)
    if (finite(ap.dated_favorites_min_days) && finite(ap.dated_favorites_max_days) &&
        ap.dated_favorites_min_days > ap.dated_favorites_max_days) {
      errors.push('dated_favorites_min_days cannot exceed dated_favorites_max_days')
    }
  }
  if (ap.strategy_settlement_snipe_enabled) {
    nonNegative('settlement_snipe_margin_f', ap.settlement_snipe_margin_f)
    inRange('settlement_snipe_max_confidence_pct', ap.settlement_snipe_max_confidence_pct, 50, 99)
  }

  return errors
}

export async function GET() {
  try {
    const settings = getSettings()
    return NextResponse.json({
      settings: {
        ...settings,
        anthropic_api_key: maskKey(settings.anthropic_api_key),
        kalshi_api_key: maskKey(settings.kalshi_api_key),
        // Don't return the private key — just indicate whether it's saved
        kalshi_private_key: settings.kalshi_private_key ? '[saved]' : '',
        tavily_api_key: maskKey(settings.tavily_api_key),
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
    if (body.kalshi_private_key !== undefined) {
      // Don't overwrite if client sends back the placeholder
      if (body.kalshi_private_key === '[saved]' || body.kalshi_private_key === '') {
        newSettings.kalshi_private_key = current.kalshi_private_key
      }
    }
    if (body.autopilot !== undefined) {
      // Deep-merge the autopilot block so a partial update (e.g. just toggling
      // enabled) can never wipe the other guardrail fields.
      newSettings.autopilot = { ...current.autopilot, ...body.autopilot }

      // Validate the FINAL merged object, not just the fields present in this
      // particular PUT — a partial update must still produce a settings
      // object that satisfies the ordering constraints (max_per_trade_usd ≤
      // max_daily_spend_usd ≤ max_exposure_usd, etc).
      const errors = validateAutopilotSettings(newSettings.autopilot)
      if (errors.length > 0) {
        return NextResponse.json(
          { error: `Invalid autopilot settings: ${errors.join('; ')}` },
          { status: 400 }
        )
      }
    }

    saveSettings(newSettings)
    return NextResponse.json({
      settings: {
        ...newSettings,
        anthropic_api_key: maskKey(newSettings.anthropic_api_key),
        kalshi_api_key: maskKey(newSettings.kalshi_api_key),
        kalshi_private_key: newSettings.kalshi_private_key ? '[saved]' : '',
        tavily_api_key: maskKey(newSettings.tavily_api_key),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
