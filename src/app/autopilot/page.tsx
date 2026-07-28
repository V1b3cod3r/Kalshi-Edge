'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AutopilotSettings, AutopilotRun, AutopilotTrade, CalibrationStats } from '@/lib/types'
import { ToastNotification } from '@/components/SessionPanel'

interface Toast {
  message: string
  type: 'success' | 'error'
}

interface LastRunSummary {
  id: string
  started_at: string
  finished_at: string
  status: string
  dry_run: boolean
  markets_scanned: number
  opportunities_considered: number
  trades_executed: number
  trades_total: number
  halted?: string
  error?: string
}

interface StatusData {
  autopilot: AutopilotSettings
  last_run: LastRunSummary | null
  today_spend_usd: number
  today_realized_pnl_usd: number | null
  calibration: CalibrationStats
}

const INTERVAL_OPTIONS = [
  { label: 'Off', minutes: 0 },
  { label: 'Every 15 min', minutes: 15 },
  { label: 'Every 30 min', minutes: 30 },
  { label: 'Every 60 min', minutes: 60 },
]

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div
      className="rounded-xl border p-6 mb-6"
      style={{ backgroundColor: '#1e1e2e', borderColor: accent ?? '#2a2a3e' }}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: '#94a3b8' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  backgroundColor: '#0d0d17',
  border: '1px solid #2a2a3e',
  borderRadius: '8px',
  color: '#f1f5f9',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
  width: '100%',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: '500',
  color: '#94a3b8',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

function Toggle({ on, onClick, color = '#6366f1' }: { on: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex-shrink-0 rounded-full transition-colors"
      style={{ width: '44px', height: '24px', backgroundColor: on ? color : '#2a2a3e' }}
    >
      <span
        className="absolute rounded-full transition-transform"
        style={{
          width: '18px',
          height: '18px',
          top: '3px',
          left: on ? '23px' : '3px',
          backgroundColor: '#f1f5f9',
        }}
      />
    </button>
  )
}

function tradeRowColor(t: AutopilotTrade): { color: string; label: string } {
  if (t.skip_reason) return { color: '#64748b', label: 'SKIP' }
  if (t.intent === 'sell') {
    // Sells (exit management) read blue when executed, amber when dry-run.
    return t.executed
      ? { color: '#3b82f6', label: 'SELL' }
      : { color: '#f59e0b', label: 'SELL (DRY)' }
  }
  if (t.executed) return { color: '#22c55e', label: 'EXECUTED' }
  return { color: '#f59e0b', label: 'DRY RUN' }
}

function exitReasonLabel(reason: string | undefined): string {
  if (reason === 'take_profit') return 'Take Profit'
  if (reason === 'stop_loss') return 'Stop Loss'
  return reason ?? ''
}

function RunRow({ run }: { run: AutopilotRun }) {
  const [expanded, setExpanded] = useState(false)
  const executed = run.trades.filter((t) => t.executed).length
  const dryTrades = run.trades.filter((t) => !t.executed && !t.skip_reason).length
  const skips = run.trades.filter((t) => t.skip_reason).length

  const statusColor =
    run.status === 'error' ? '#ef4444'
    : run.status === 'halted' ? '#f59e0b'
    : '#22c55e'

  return (
    <div className="rounded-lg border mb-2" style={{ borderColor: '#2a2a3e', backgroundColor: '#12121a' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: '#64748b', transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 150ms' }}>
            ▶
          </span>
          <span className="text-xs font-mono" style={{ color: '#94a3b8' }}>
            {new Date(run.started_at).toLocaleString()}
          </span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ color: statusColor, backgroundColor: `${statusColor}18`, border: `1px solid ${statusColor}40` }}
          >
            {run.status.toUpperCase()}
          </span>
          {run.dry_run && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{ color: '#f59e0b', backgroundColor: '#f59e0b18', border: '1px solid #f59e0b40' }}
            >
              DRY RUN
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs" style={{ color: '#64748b' }}>
          <span>{run.markets_scanned} scanned</span>
          <span>{run.opportunities_considered} opps</span>
          {executed > 0 && <span style={{ color: '#22c55e' }}>{executed} executed</span>}
          {dryTrades > 0 && <span style={{ color: '#f59e0b' }}>{dryTrades} dry</span>}
          {skips > 0 && <span>{skips} skipped</span>}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {run.halted && (
            <div className="text-xs px-3 py-2 rounded mb-2" style={{ color: '#f59e0b', backgroundColor: '#f59e0b10', border: '1px solid #f59e0b30' }}>
              {run.halted}
            </div>
          )}
          {run.error && (
            <div className="text-xs px-3 py-2 rounded mb-2" style={{ color: '#ef4444', backgroundColor: '#ef444410', border: '1px solid #ef444430' }}>
              {run.error}
            </div>
          )}
          {run.trades.length === 0 ? (
            <p className="text-xs py-2" style={{ color: '#64748b' }}>
              No qualifying opportunities this cycle.
            </p>
          ) : (
            <div className="rounded-lg border overflow-x-auto" style={{ borderColor: '#2a2a3e' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ backgroundColor: '#0d0d17' }}>
                    <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Status</th>
                    <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Ticker</th>
                    <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Side</th>
                    <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Contracts</th>
                    <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Price</th>
                    <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Cost</th>
                    <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Edge</th>
                    <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {run.trades.map((t, i) => {
                    const { color, label } = tradeRowColor(t)
                    const isSell = t.intent === 'sell'
                    return (
                      <tr key={`${t.ticker}-${i}`} style={{ borderTop: '1px solid #1a1a28' }}>
                        <td className="px-3 py-2">
                          <span
                            className="font-bold"
                            style={
                              isSell && !t.skip_reason
                                ? { color, backgroundColor: `${color}18`, border: `1px solid ${color}40`, borderRadius: '4px', padding: '1px 6px' }
                                : { color }
                            }
                          >
                            {label}
                          </span>
                        </td>
                        <td className="px-3 py-2" style={{ maxWidth: '260px' }}>
                          <div style={{ color: t.skip_reason ? '#64748b' : '#f1f5f9' }}>
                            {t.title && t.title !== t.ticker ? t.title : t.ticker}
                          </div>
                          {t.title && t.title !== t.ticker && (
                            <div className="font-mono" style={{ color: '#475569', fontSize: '10px' }}>
                              {t.ticker}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-bold" style={{ color: t.side === 'yes' ? '#22c55e' : '#ef4444' }}>
                          {t.side.toUpperCase()}
                        </td>
                        <td className="px-3 py-2 text-right" style={{ color: '#e2e8f0' }}>
                          {t.skip_reason ? '—' : t.contracts}
                        </td>
                        <td className="px-3 py-2 text-right" style={{ color: '#e2e8f0' }}>
                          {t.price > 0 ? `$${t.price.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right" style={{ color: '#e2e8f0' }}>
                          {t.skip_reason ? '—' : `$${t.cost.toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2 text-right" style={{ color: isSell ? '#3b82f6' : t.effective_edge_pct >= 7 ? '#22c55e' : '#94a3b8' }}>
                          {isSell
                            ? (t.exit_reason ? exitReasonLabel(t.exit_reason) : '—')
                            : `${t.effective_edge_pct.toFixed(1)}%`}
                        </td>
                        <td className="px-3 py-2" style={{ color: '#64748b', maxWidth: '340px' }}>
                          {t.skip_reason
                            ? t.skip_reason
                            : isSell
                              ? `${exitReasonLabel(t.exit_reason)} · ${t.executed ? `Sold ${t.contracts} @ $${t.price.toFixed(2)}${t.order_id ? ` · Order ${t.order_id}` : ''}` : `Would sell ${t.contracts} @ $${t.price.toFixed(2)}`}`
                              : t.executed
                                ? `Order ${t.order_id ?? ''} · Kelly stake $${t.kelly_stake.toFixed(2)}`
                                : `Would place · Kelly stake $${t.kelly_stake.toFixed(2)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AutopilotPage() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [runs, setRuns] = useState<AutopilotRun[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // Guardrail form state
  const [form, setForm] = useState<AutopilotSettings | null>(null)

  // Scheduler
  const [intervalMin, setIntervalMin] = useState(0)
  const [nextRunAt, setNextRunAt] = useState<number | null>(null)
  const [countdown, setCountdown] = useState('')
  const runningRef = useRef(false)

  const showToast = (msg: string, type: 'success' | 'error') => setToast({ message: msg, type })

  const loadStatus = useCallback(async () => {
    try {
      const [statusRes, logRes] = await Promise.all([
        fetch('/api/autopilot/status'),
        fetch('/api/autopilot/log?limit=20'),
      ])
      const statusData = await statusRes.json()
      const logData = await logRes.json()
      if (!statusRes.ok) throw new Error(statusData.error)
      setStatus(statusData)
      setForm((prev) => prev ?? statusData.autopilot)
      setRuns(logData.runs ?? [])
    } catch (err: any) {
      showToast(err.message || 'Failed to load autopilot status', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Persist a partial autopilot settings update (always sends the full block)
  const saveAutopilot = async (updates: Partial<AutopilotSettings>) => {
    if (!status) return
    const next = { ...status.autopilot, ...updates }
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autopilot: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setStatus((s) => (s ? { ...s, autopilot: next } : s))
      setForm((f) => (f ? { ...f, ...updates } : f))
      return true
    } catch (err: any) {
      showToast(err.message || 'Failed to save settings', 'error')
      return false
    }
  }

  const toggleEnabled = async () => {
    if (!status) return
    const turningOn = !status.autopilot.enabled
    const ok = await saveAutopilot({ enabled: turningOn })
    if (ok) showToast(turningOn ? 'Autopilot enabled' : 'Autopilot stopped', 'success')
  }

  const toggleDryRun = async () => {
    if (!status) return
    const turningOff = status.autopilot.dry_run
    if (turningOff) {
      const confirmed = window.confirm('Autopilot will place REAL orders with REAL money. Continue?')
      if (!confirmed) return
    }
    const ok = await saveAutopilot({ dry_run: !status.autopilot.dry_run })
    if (ok) showToast(turningOff ? 'LIVE mode — real orders will be placed' : 'Dry-run mode on', 'success')
  }

  const killSwitch = async () => {
    const ok = await saveAutopilot({ enabled: false })
    if (ok) showToast('Autopilot STOPPED', 'success')
    setIntervalMin(0)
    setNextRunAt(null)
  }

  const saveGuardrails = async () => {
    if (!form) return
    const ok = await saveAutopilot({
      min_effective_edge_pct: form.min_effective_edge_pct,
      min_confidence: form.min_confidence,
      max_per_trade_usd: form.max_per_trade_usd,
      max_daily_spend_usd: form.max_daily_spend_usd,
      max_daily_loss_usd: form.max_daily_loss_usd,
      max_open_positions: form.max_open_positions,
      max_exposure_usd: form.max_exposure_usd,
      kelly_fraction: form.kelly_fraction,
      category_blacklist: form.category_blacklist,
      max_per_cluster_usd: form.max_per_cluster_usd,
      exit_enabled: form.exit_enabled,
      take_profit_pct: form.take_profit_pct,
      stop_loss_pct: form.stop_loss_pct,
      kelly_haircut_high_pp: form.kelly_haircut_high_pp,
      kelly_haircut_medium_pp: form.kelly_haircut_medium_pp,
      kelly_haircut_low_pp: form.kelly_haircut_low_pp,
      scan_limit: form.scan_limit,
      max_days_to_resolution: form.max_days_to_resolution,
      min_resolved_predictions_for_live: form.min_resolved_predictions_for_live,
      require_calibration_to_go_live: form.require_calibration_to_go_live,
    })
    if (ok) showToast('Guardrails saved', 'success')
  }

  const runCycle = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    try {
      const res = await fetch('/api/autopilot/run', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const report: AutopilotRun = data.report
      if (report.status === 'disabled') {
        showToast('Autopilot is disabled — enable it first', 'error')
      } else if (report.status === 'error') {
        showToast(`Cycle error: ${report.error}`, 'error')
      } else if (report.status === 'halted') {
        showToast('Cycle halted by circuit breaker', 'error')
      } else {
        const executed = report.trades.filter((t) => t.executed).length
        const dry = report.trades.filter((t) => !t.executed && !t.skip_reason).length
        showToast(
          report.dry_run
            ? `Dry run complete: ${dry} would-be trade${dry === 1 ? '' : 's'}, ${report.trades.length - dry} skipped`
            : `Cycle complete: ${executed} order${executed === 1 ? '' : 's'} placed`,
          'success'
        )
      }
    } catch (err: any) {
      showToast(err.message || 'Autopilot run failed', 'error')
    } finally {
      runningRef.current = false
      setRunning(false)
      loadStatus()
    }
  }, [loadStatus])

  // Client-side scheduler: fires while this tab is open
  useEffect(() => {
    if (intervalMin <= 0) {
      setNextRunAt(null)
      return
    }
    setNextRunAt(Date.now() + intervalMin * 60_000)
    const id = setInterval(() => {
      setNextRunAt(Date.now() + intervalMin * 60_000)
      runCycle()
    }, intervalMin * 60_000)
    return () => clearInterval(id)
  }, [intervalMin, runCycle])

  // Countdown ticker
  useEffect(() => {
    if (!nextRunAt) {
      setCountdown('')
      return
    }
    const tick = () => {
      const ms = nextRunAt - Date.now()
      if (ms <= 0) {
        setCountdown('running...')
        return
      }
      const m = Math.floor(ms / 60_000)
      const s = Math.floor((ms % 60_000) / 1000)
      setCountdown(`${m}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [nextRunAt])

  if (loading || !status || !form) {
    return (
      <div className="p-8 max-w-4xl">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border p-6 mb-6 shimmer h-48" style={{ borderColor: '#1e1e2e' }} />
        ))}
      </div>
    )
  }

  const ap = status.autopilot
  const live = ap.enabled && !ap.dry_run

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
          Autopilot
        </h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Autonomous trade execution with hard guardrails. Every limit is enforced in code before any order is placed.
        </p>
      </div>

      {/* Status header */}
      <div
        className="rounded-xl border p-6 mb-6"
        style={{
          backgroundColor: '#1e1e2e',
          borderColor: live ? '#ef4444' : ap.enabled ? '#f59e0b' : '#2a2a3e',
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-3xl font-black tracking-tight" style={{ color: ap.enabled ? '#22c55e' : '#64748b' }}>
                {ap.enabled ? 'ENABLED' : 'DISABLED'}
              </div>
              <div className="text-xs mt-1" style={{ color: '#64748b' }}>
                Master switch
              </div>
            </div>
            {ap.dry_run ? (
              <span
                className="text-xs font-bold px-3 py-1.5 rounded-lg"
                style={{ color: '#f59e0b', backgroundColor: '#f59e0b18', border: '1px solid #f59e0b50' }}
              >
                DRY RUN — no real orders
              </span>
            ) : (
              <span
                className="text-xs font-bold px-3 py-1.5 rounded-lg animate-pulse"
                style={{ color: '#fff', backgroundColor: '#ef4444', border: '1px solid #ef4444' }}
              >
                LIVE — real money
              </span>
            )}
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: '#94a3b8' }}>Enabled</span>
              <Toggle on={ap.enabled} onClick={toggleEnabled} color="#22c55e" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: '#94a3b8' }}>Dry run</span>
              <Toggle on={ap.dry_run} onClick={toggleDryRun} color="#f59e0b" />
            </div>
          </div>
        </div>

        {/* Today stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="rounded-lg p-3" style={{ backgroundColor: '#0d0d17' }}>
            <div className="text-xs" style={{ color: '#64748b' }}>Spent today (executed)</div>
            <div className="text-lg font-bold" style={{ color: '#f1f5f9' }}>
              ${status.today_spend_usd.toFixed(2)}
              <span className="text-xs font-normal ml-1" style={{ color: '#64748b' }}>/ ${ap.max_daily_spend_usd}</span>
            </div>
          </div>
          <div className="rounded-lg p-3" style={{ backgroundColor: '#0d0d17' }}>
            <div className="text-xs" style={{ color: '#64748b' }}>Realized P&L today</div>
            <div
              className="text-lg font-bold"
              style={{
                color: status.today_realized_pnl_usd == null
                  ? '#64748b'
                  : status.today_realized_pnl_usd >= 0 ? '#22c55e' : '#ef4444',
              }}
            >
              {status.today_realized_pnl_usd == null ? '—' : `$${status.today_realized_pnl_usd.toFixed(2)}`}
              <span className="text-xs font-normal ml-1" style={{ color: '#64748b' }}>halt at -${ap.max_daily_loss_usd}</span>
            </div>
          </div>
          <div className="rounded-lg p-3" style={{ backgroundColor: '#0d0d17' }}>
            <div className="text-xs" style={{ color: '#64748b' }}>Last run</div>
            <div className="text-lg font-bold" style={{ color: '#f1f5f9' }}>
              {status.last_run ? new Date(status.last_run.started_at).toLocaleTimeString() : '—'}
              {status.last_run && (
                <span className="text-xs font-normal ml-1" style={{ color: '#64748b' }}>
                  {status.last_run.trades_executed} executed / {status.last_run.trades_total} decisions
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Kill switch */}
        <button
          onClick={killSwitch}
          className="w-full mt-5 py-3 rounded-lg text-sm font-black tracking-widest"
          style={{ backgroundColor: '#ef4444', color: '#fff' }}
        >
          ■ STOP AUTOPILOT
        </button>
      </div>

      {/* Go-live gate: real orders are blocked in code until calibration proves out */}
      {(() => {
        const cal = status.calibration
        const required = ap.min_resolved_predictions_for_live
        const enoughSamples = cal.resolved_predictions >= required
        const beatsMarket = cal.market_brier != null && cal.claude_brier < cal.market_brier
        const gateMet = enoughSamples && beatsMarket
        const color = gateMet ? '#22c55e' : '#f59e0b'
        return (
          <div
            className="rounded-xl border p-4 mb-6 text-xs"
            style={{ backgroundColor: '#1e1e2e', borderColor: `${color}50`, color: '#94a3b8' }}
          >
            <div className="font-bold mb-1" style={{ color }}>
              {gateMet ? 'Live-trading gate: MET' : 'Live-trading gate: NOT MET (real orders blocked in code)'}
            </div>
            <div>
              {cal.resolved_predictions}/{required} predictions resolved
              {cal.market_brier != null && (
                <> · Claude Brier {cal.claude_brier.toFixed(3)} vs market {cal.market_brier.toFixed(3)} ({beatsMarket ? 'beats market' : 'does not beat market'})</>
              )}
            </div>
          </div>
        )
      })()}

      {/* Run controls */}
      <Section title="Run">
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={runCycle}
            disabled={running}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ backgroundColor: running ? '#4338ca' : '#6366f1', color: '#fff', opacity: running ? 0.8 : 1 }}
          >
            {running && (
              <span
                className="inline-block w-3.5 h-3.5 rounded-full border-2 animate-spin"
                style={{ borderColor: '#ffffff40', borderTopColor: '#fff' }}
              />
            )}
            {running ? 'Running cycle...' : 'Run cycle now'}
          </button>

          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: '#94a3b8' }}>Auto-run</label>
            <select
              value={intervalMin}
              onChange={(e) => setIntervalMin(parseInt(e.target.value))}
              style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: '13px' }}
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.minutes} value={o.minutes}>{o.label}</option>
              ))}
            </select>
            {intervalMin > 0 && countdown && (
              <span className="text-xs font-mono px-2 py-1 rounded" style={{ color: '#a5b4fc', backgroundColor: '#6366f115' }}>
                next in {countdown}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs mt-3" style={{ color: '#64748b' }}>
          Auto-run only fires while this tab is open. Each cycle re-checks every guardrail before any order.
        </p>
      </Section>

      {/* Guardrails */}
      <Section title="Guardrails">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label style={labelStyle}>Markets to scan / cycle</label>
            <input type="number" min={5} max={100} step={5} value={form.scan_limit ?? 40}
              onChange={(e) => setForm({ ...form, scan_limit: parseInt(e.target.value) || 40 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Min effective edge (%)</label>
            <input type="number" min={1} max={50} step={0.5} value={form.min_effective_edge_pct}
              onChange={(e) => setForm({ ...form, min_effective_edge_pct: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Min confidence</label>
            <select value={form.min_confidence}
              onChange={(e) => setForm({ ...form, min_confidence: e.target.value as 'MEDIUM' | 'HIGH' })} style={inputStyle}>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Kelly fraction</label>
            <input type="number" min={0.05} max={1} step={0.05} value={form.kelly_fraction}
              onChange={(e) => setForm({ ...form, kelly_fraction: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max per trade ($)</label>
            <input type="number" min={1} value={form.max_per_trade_usd}
              onChange={(e) => setForm({ ...form, max_per_trade_usd: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max daily spend ($)</label>
            <input type="number" min={1} value={form.max_daily_spend_usd}
              onChange={(e) => setForm({ ...form, max_daily_spend_usd: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max daily loss ($)</label>
            <input type="number" min={1} value={form.max_daily_loss_usd}
              onChange={(e) => setForm({ ...form, max_daily_loss_usd: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max open positions</label>
            <input type="number" min={1} max={100} value={form.max_open_positions}
              onChange={(e) => setForm({ ...form, max_open_positions: parseInt(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max total exposure ($)</label>
            <input type="number" min={1} value={form.max_exposure_usd}
              onChange={(e) => setForm({ ...form, max_exposure_usd: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max per cluster ($)</label>
            <input type="number" min={1} value={form.max_per_cluster_usd}
              onChange={(e) => setForm({ ...form, max_per_cluster_usd: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Max days to resolution</label>
            <input type="number" min={1} max={730} value={form.max_days_to_resolution}
              onChange={(e) => setForm({ ...form, max_days_to_resolution: parseInt(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Resolved preds required for live</label>
            <input type="number" min={0} max={500} value={form.min_resolved_predictions_for_live}
              onChange={(e) => setForm({ ...form, min_resolved_predictions_for_live: parseInt(e.target.value) || 0 })} style={inputStyle} />
          </div>

          {/* Go-live calibration gate — off by default per explicit user request.
              Kept as a toggle (not deleted) so it can be turned back on. */}
          <div className="col-span-2 md:col-span-3 mt-2 pt-4" style={{ borderTop: '1px solid #2a2a3e' }}>
            <div className="flex items-center justify-between">
              <div>
                <label style={{ ...labelStyle, marginBottom: '2px', color: form.require_calibration_to_go_live ? '#94a3b8' : '#ef4444' }}>
                  Require proven edge before live trades
                </label>
                <p className="text-xs" style={{ color: '#64748b' }}>
                  When ON, live orders are blocked until the "Resolved preds required for live" count is met AND
                  Claude's Brier score beats the market's. When OFF, autopilot can place real orders with{' '}
                  <strong style={{ color: '#ef4444' }}>zero evidence it has any edge</strong> — recommended only
                  once you understand and accept that risk.
                </p>
              </div>
              <Toggle
                on={form.require_calibration_to_go_live}
                onClick={() => setForm({ ...form, require_calibration_to_go_live: !form.require_calibration_to_go_live })}
                color="#ef4444"
              />
            </div>
          </div>
          <div className="col-span-2 md:col-span-3">
            <label style={labelStyle}>Category blacklist (comma-separated)</label>
            <input type="text" value={form.category_blacklist.join(', ')}
              onChange={(e) => setForm({
                ...form,
                category_blacklist: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })}
              placeholder="Sports" style={inputStyle} />
          </div>

          {/* Exit management — LLM-free take-profit / stop-loss on open positions */}
          <div className="col-span-2 md:col-span-3 mt-2 pt-4" style={{ borderTop: '1px solid #2a2a3e' }}>
            <div className="flex items-center justify-between">
              <div>
                <label style={{ ...labelStyle, marginBottom: '2px' }}>Exit management</label>
                <p className="text-xs" style={{ color: '#64748b' }}>
                  Each cycle, sell open positions to lock profit or cut losses — pure price mechanics, no Claude call.
                </p>
              </div>
              <Toggle
                on={form.exit_enabled}
                onClick={() => setForm({ ...form, exit_enabled: !form.exit_enabled })}
                color="#3b82f6"
              />
            </div>
          </div>
          {/* Kelly confidence haircut — sizes from a conservative LOWER BOUND
              on win probability rather than the point estimate, because Kelly
              is hypersensitive to error in p. Higher = smaller bets. */}
          <div className="col-span-2 md:col-span-3 mt-2 pt-4" style={{ borderTop: '1px solid #2a2a3e' }}>
            <label style={{ ...labelStyle, marginBottom: '2px' }}>Kelly confidence haircut (pp)</label>
            <p className="text-xs mb-3" style={{ color: '#64748b' }}>
              Percentage points subtracted from the estimated win probability before sizing.
              Kelly assumes a true probability; ours is an estimate, and Kelly is hypersensitive
              to that error. Higher values = smaller, safer positions.
            </p>
          </div>
          <div>
            <label style={labelStyle}>Haircut — HIGH conf</label>
            <input type="number" min={0} max={30} step={1} value={form.kelly_haircut_high_pp ?? 3}
              onChange={(e) => setForm({ ...form, kelly_haircut_high_pp: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Haircut — MEDIUM conf</label>
            <input type="number" min={0} max={30} step={1} value={form.kelly_haircut_medium_pp ?? 5}
              onChange={(e) => setForm({ ...form, kelly_haircut_medium_pp: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Haircut — LOW conf</label>
            <input type="number" min={0} max={30} step={1} value={form.kelly_haircut_low_pp ?? 8}
              onChange={(e) => setForm({ ...form, kelly_haircut_low_pp: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Take profit at +%</label>
            <input type="number" min={1} step={1} value={form.take_profit_pct}
              onChange={(e) => setForm({ ...form, take_profit_pct: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Stop loss at −%</label>
            <input type="number" min={1} step={1} value={form.stop_loss_pct}
              onChange={(e) => setForm({ ...form, stop_loss_pct: parseFloat(e.target.value) || 0 })} style={inputStyle} />
          </div>
        </div>
        <button
          onClick={saveGuardrails}
          className="w-full mt-5 py-2.5 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#6366f1', color: '#fff' }}
        >
          Save Guardrails
        </button>
      </Section>

      {/* Decision log */}
      <Section title="Decision Log">
        {runs.length === 0 ? (
          <div className="text-center py-8 rounded-lg" style={{ backgroundColor: '#0d0d17' }}>
            <p className="text-sm" style={{ color: '#64748b' }}>
              No runs yet. Enable autopilot and run a cycle — dry-run mode is a safe way to see what it would do.
            </p>
          </div>
        ) : (
          <div>
            {runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </Section>

      {toast && <ToastNotification toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
