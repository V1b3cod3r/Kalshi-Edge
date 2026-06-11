'use client'

import { useEffect, useState } from 'react'

// ─── Types (mirror the API route) ─────────────────────────────────────────────

interface PnLSummary {
  total_invested: number
  total_returned: number
  total_pnl: number
  open_value: number
  unrealized_pnl: number
  win_rate: number
  wins: number
  losses: number
  total_settled: number
  roi_pct: number
  balance: number
  position_count: number
}

interface OpenPosition {
  ticker: string
  market_title: string
  side: 'YES' | 'NO'
  contracts: number
  current_value: number
  cost_basis: number
  unrealized_pnl: number
  avg_price: number
  current_price: number
  category: string
}

interface Settlement {
  ticker: string
  title: string
  revenue: number
  cost: number
  profit: number
  won: boolean
  settled_at: string
  category: string
  source: 'scanner' | 'analyze' | 'manual' | 'unknown'
}

interface CategoryBreakdown {
  category: string
  pnl: number
  invested: number
  wins: number
  losses: number
  win_rate: number
  roi_pct: number
}

interface SourceBreakdown {
  source: string
  pnl: number
  invested: number
  wins: number
  losses: number
  win_rate: number
  roi_pct: number
}

interface PnLData {
  summary: PnLSummary
  open_positions: OpenPosition[]
  settlements: Settlement[]
  by_category: CategoryBreakdown[]
  by_source: SourceBreakdown[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) {
  return Math.abs(n).toFixed(decimals)
}

function fmtPct(n: number, decimals = 1) {
  return n.toFixed(decimals) + '%'
}

function pnlColor(v: number) {
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#64748b'
}

function sign(v: number) {
  return v > 0 ? '+' : v < 0 ? '-' : ''
}

function fmtDollar(v: number) {
  return `${sign(v)}$${fmt(v)}`
}

function fmtDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function sourceLabel(src: string) {
  if (src === 'scanner') return 'Bot (Scanner)'
  if (src === 'analyze') return 'Bot (Analyze)'
  if (src === 'manual') return 'Manual'
  return 'Unknown'
}

function sourceColor(src: string) {
  if (src === 'scanner') return '#6366f1'
  if (src === 'analyze') return '#8b5cf6'
  if (src === 'manual') return '#94a3b8'
  return '#64748b'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  valueColor,
  mono = false,
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
        {label}
      </div>
      <div
        className={`text-2xl font-bold${mono ? ' font-mono' : ''}`}
        style={{ color: valueColor || '#f1f5f9' }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: '#475569' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function SpinnerIcon({ size = 24, color = '#6366f1' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
    >
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  )
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-3.09" />
    </svg>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [data, setData] = useState<PnLData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'positions' | 'settlements' | 'breakdown'>('positions')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio/pnl')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const s = data?.summary

  return (
    <div className="flex-1 p-8 space-y-8" style={{ backgroundColor: '#0a0a12', minHeight: '100vh' }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>
            P&amp;L Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: '#64748b' }}>
            Realized &amp; unrealized performance from Kalshi
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: '#1e1e2e',
            color: loading ? '#64748b' : '#a5b4fc',
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          <RefreshIcon spinning={loading} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Error / no-key state */}
      {error && (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{ backgroundColor: '#1a0808', borderColor: '#ef444430', color: '#ef4444' }}
        >
          {error.toLowerCase().includes('api key') || error.toLowerCase().includes('kalshi') ? (
            <>
              Kalshi API key not configured.{' '}
              <a href="/settings" style={{ color: '#a5b4fc', textDecoration: 'underline' }}>
                Go to Settings
              </a>{' '}
              to add your credentials.
            </>
          ) : (
            error
          )}
        </div>
      )}

      {/* Loading spinner (no data yet) */}
      {loading && !data && (
        <div className="flex items-center justify-center py-24">
          <div className="text-center space-y-3">
            <SpinnerIcon size={32} />
            <p className="text-sm" style={{ color: '#64748b' }}>Loading portfolio from Kalshi...</p>
          </div>
        </div>
      )}

      {/* ── DATA LOADED ─────────────────────────────────────────────────────── */}
      {!loading && data && s && (
        <>
          {/* ── Summary bar ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              label="Total Invested"
              value={`$${fmt(s.total_invested)}`}
              sub="Settled trades cost basis"
              mono
            />
            <StatCard
              label="Total Returned"
              value={`$${fmt(s.total_returned)}`}
              sub="Settled trades revenue"
              mono
            />
            <StatCard
              label="Net P&L"
              value={fmtDollar(s.total_pnl)}
              sub={`${s.wins}W / ${s.losses}L settled`}
              valueColor={pnlColor(s.total_pnl)}
              mono
            />
            <StatCard
              label="ROI"
              value={`${sign(s.roi_pct)}${fmtPct(Math.abs(s.roi_pct))}`}
              sub="On settled capital"
              valueColor={pnlColor(s.roi_pct)}
              mono
            />
            <StatCard
              label="Win Rate"
              value={fmtPct(s.win_rate * 100)}
              sub={`${s.total_settled} settled trades`}
              valueColor={s.win_rate >= 0.55 ? '#22c55e' : s.win_rate >= 0.45 ? '#f59e0b' : '#ef4444'}
            />
          </div>

          {/* ── Secondary stats row ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Cash Balance"
              value={`$${fmt(s.balance)}`}
              sub="Available to trade"
              mono
            />
            <StatCard
              label="Open Positions"
              value={String(s.position_count)}
              sub={`$${fmt(s.open_value)} current value`}
            />
            <StatCard
              label="Unrealized P&L"
              value={fmtDollar(s.unrealized_pnl)}
              sub="From open positions"
              valueColor={pnlColor(s.unrealized_pnl)}
              mono
            />
            <StatCard
              label="Total P&L (incl. open)"
              value={fmtDollar(s.total_pnl + s.unrealized_pnl)}
              sub="Realized + unrealized"
              valueColor={pnlColor(s.total_pnl + s.unrealized_pnl)}
              mono
            />
          </div>

          {/* ── Tabs ─────────────────────────────────────────────────────────── */}
          <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ backgroundColor: '#12121a' }}>
            {(
              [
                { key: 'positions', label: `Open Positions (${data.open_positions.length})` },
                { key: 'settlements', label: `Settlements (${data.settlements.length})` },
                { key: 'breakdown', label: 'Breakdown' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: tab === key ? '#6366f1' : 'transparent',
                  color: tab === key ? '#fff' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Open Positions table ─────────────────────────────────────────── */}
          {tab === 'positions' && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              {data.open_positions.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="text-3xl mb-3" style={{ color: '#334155' }}>&#9634;</div>
                  <p className="text-sm" style={{ color: '#64748b' }}>No open positions</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e1e2e' }}>
                        {['Market', 'Side', 'Contracts', 'Avg Price', 'Curr Price', 'Cost Basis', 'Curr Value', 'Unrealized P&L'].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={{ color: '#64748b' }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.open_positions.map((pos) => (
                        <tr
                          key={pos.ticker}
                          style={{ borderBottom: '1px solid #1e1e2e' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1a1a28')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium" style={{ color: '#f1f5f9', maxWidth: 260 }}>
                              {pos.market_title || pos.ticker}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs font-mono" style={{ color: '#64748b' }}>
                                {pos.ticker}
                              </span>
                              {pos.category && (
                                <span
                                  className="text-xs px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: '#1e1e2e', color: '#94a3b8' }}
                                >
                                  {pos.category}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="font-semibold text-xs px-2 py-1 rounded"
                              style={{
                                backgroundColor: pos.side === 'YES' ? '#22c55e20' : '#ef444420',
                                color: pos.side === 'YES' ? '#22c55e' : '#ef4444',
                              }}
                            >
                              {pos.side}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#f1f5f9' }}>
                            {pos.contracts}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#94a3b8' }}>
                            ${fmt(pos.avg_price)}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#f1f5f9' }}>
                            ${fmt(pos.current_price)}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#94a3b8' }}>
                            ${fmt(pos.cost_basis)}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#f1f5f9' }}>
                            ${fmt(pos.current_value)}
                          </td>
                          <td className="px-4 py-3 font-mono font-semibold" style={{ color: pnlColor(pos.unrealized_pnl) }}>
                            {fmtDollar(pos.unrealized_pnl)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Settlements table ─────────────────────────────────────────────── */}
          {tab === 'settlements' && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              {data.settlements.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm" style={{ color: '#64748b' }}>No recent settlements</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e1e2e' }}>
                        {['Market', 'Result', 'Source', 'Cost', 'Revenue', 'Profit', 'Date'].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                            style={{ color: '#64748b' }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.settlements.map((s, i) => (
                        <tr
                          key={`${s.ticker}-${i}`}
                          style={{ borderBottom: '1px solid #1e1e2e' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1a1a28')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium" style={{ color: '#f1f5f9', maxWidth: 260 }}>
                              {s.title || s.ticker}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs font-mono" style={{ color: '#64748b' }}>
                                {s.ticker}
                              </span>
                              {s.category && s.category !== 'Other' && (
                                <span
                                  className="text-xs px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: '#1e1e2e', color: '#94a3b8' }}
                                >
                                  {s.category}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="text-xs font-semibold px-2 py-1 rounded"
                              style={{
                                backgroundColor: s.won ? '#22c55e20' : '#ef444420',
                                color: s.won ? '#22c55e' : '#ef4444',
                              }}
                            >
                              {s.won ? 'WIN' : 'LOSS'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="text-xs font-medium px-2 py-0.5 rounded"
                              style={{
                                backgroundColor: `${sourceColor(s.source)}20`,
                                color: sourceColor(s.source),
                              }}
                            >
                              {sourceLabel(s.source)}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#94a3b8' }}>
                            ${fmt(s.cost)}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#94a3b8' }}>
                            ${fmt(s.revenue)}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold" style={{ color: pnlColor(s.profit) }}>
                            {fmtDollar(s.profit)}
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: '#64748b' }}>
                            {fmtDate(s.settled_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Breakdown tab ─────────────────────────────────────────────────── */}
          {tab === 'breakdown' && (
            <div className="space-y-6">

              {/* By Category */}
              <div
                className="rounded-xl border p-5"
                style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
              >
                <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: '#64748b' }}>
                  P&amp;L by Category
                </h2>
                {data.by_category.length === 0 ? (
                  <p className="text-sm" style={{ color: '#475569' }}>No settled trades yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.by_category.map((cat) => (
                      <div
                        key={cat.category}
                        className="rounded-xl border p-4"
                        style={{ backgroundColor: '#0d0d17', borderColor: '#1e1e2e' }}
                      >
                        <div className="text-sm font-semibold mb-3" style={{ color: '#e2e8f0' }}>
                          {cat.category}
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>Net P&amp;L</span>
                            <span className="font-mono font-bold" style={{ color: pnlColor(cat.pnl) }}>
                              {fmtDollar(cat.pnl)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>ROI</span>
                            <span
                              className="font-mono"
                              style={{ color: pnlColor(cat.roi_pct) }}
                            >
                              {sign(cat.roi_pct)}{fmtPct(Math.abs(cat.roi_pct))}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>Win Rate</span>
                            <span className="font-mono" style={{ color: '#f1f5f9' }}>
                              {fmtPct(cat.win_rate * 100)} ({cat.wins}W/{cat.losses}L)
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>Invested</span>
                            <span className="font-mono" style={{ color: '#94a3b8' }}>
                              ${fmt(cat.invested)}
                            </span>
                          </div>
                        </div>
                        {/* Mini P&L bar */}
                        <div className="mt-3">
                          <div
                            className="h-1.5 rounded-full overflow-hidden"
                            style={{ backgroundColor: '#1e1e2e' }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(Math.abs(cat.roi_pct), 100)}%`,
                                backgroundColor: cat.pnl >= 0 ? '#6366f1' : '#ef4444',
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bot vs Manual */}
              <div
                className="rounded-xl border p-5"
                style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
              >
                <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: '#64748b' }}>
                  Bot vs Manual
                </h2>
                {data.by_source.length === 0 ? (
                  <p className="text-sm" style={{ color: '#475569' }}>No settled trades yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.by_source.map((src) => (
                      <div
                        key={src.source}
                        className="rounded-xl border p-4"
                        style={{ backgroundColor: '#0d0d17', borderColor: '#1e1e2e' }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: `${sourceColor(src.source)}20`,
                              color: sourceColor(src.source),
                            }}
                          >
                            {sourceLabel(src.source)}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>Net P&amp;L</span>
                            <span className="font-mono font-bold" style={{ color: pnlColor(src.pnl) }}>
                              {fmtDollar(src.pnl)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>ROI</span>
                            <span
                              className="font-mono"
                              style={{ color: pnlColor(src.roi_pct) }}
                            >
                              {sign(src.roi_pct)}{fmtPct(Math.abs(src.roi_pct))}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>Win Rate</span>
                            <span className="font-mono" style={{ color: '#f1f5f9' }}>
                              {fmtPct(src.win_rate * 100)} ({src.wins}W/{src.losses}L)
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span style={{ color: '#64748b' }}>Invested</span>
                            <span className="font-mono" style={{ color: '#94a3b8' }}>
                              ${fmt(src.invested)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3">
                          <div
                            className="h-1.5 rounded-full overflow-hidden"
                            style={{ backgroundColor: '#1e1e2e' }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(Math.abs(src.roi_pct), 100)}%`,
                                backgroundColor: src.pnl >= 0 ? sourceColor(src.source) : '#ef4444',
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
