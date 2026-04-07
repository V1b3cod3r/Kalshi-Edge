'use client'

import { useEffect, useState } from 'react'

interface Position {
  ticker: string
  market_title: string
  side: 'YES' | 'NO'
  quantity: number
  avg_price: number
  current_price: number
  unrealized_pnl: number
  realized_pnl: number
  total_pnl: number
  category: string
  notional: number
}

interface Settlement {
  ticker: string
  title: string
  revenue: number
  profit: number
  settled_at: string
}

interface Summary {
  total_unrealized_pnl: number
  total_realized_pnl: number
  total_notional: number
  position_count: number
}

interface PortfolioData {
  balance: number
  positions: Position[]
  settlements: Settlement[]
  summary: Summary
}

function fmt(n: number, decimals = 2) {
  return n.toFixed(decimals)
}

function pnlColor(v: number) {
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#64748b'
}

function pnlSign(v: number) {
  return v > 0 ? '+' : ''
}

function StatCard({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
    >
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
        {label}
      </div>
      <div className="text-2xl font-bold" style={{ color: valueColor || '#f1f5f9' }}>
        {value}
      </div>
      {sub && <div className="text-xs mt-1" style={{ color: '#64748b' }}>{sub}</div>}
    </div>
  )
}

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'positions' | 'settlements'>('positions')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const totalPnl = data ? data.summary.total_unrealized_pnl + data.summary.total_realized_pnl : 0
  const totalPnlColor = pnlColor(totalPnl)

  return (
    <div className="flex-1 p-8 space-y-8" style={{ backgroundColor: '#0a0a12', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#f1f5f9' }}>
            Portfolio
          </h1>
          <p className="text-sm mt-1" style={{ color: '#64748b' }}>
            Live positions &amp; P&amp;L from Kalshi
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={loading ? 'animate-spin' : ''}
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-3.09" />
          </svg>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{ backgroundColor: '#1a0808', borderColor: '#ef444430', color: '#ef4444' }}
        >
          {error.includes('API key') ? (
            <>API key not configured. Go to <a href="/settings" style={{ color: '#a5b4fc' }}>Settings</a> to add your Kalshi API key.</>
          ) : error}
        </div>
      )}

      {!loading && data && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Cash Balance"
              value={`$${fmt(data.balance)}`}
              sub="Available to trade"
            />
            <StatCard
              label="Open Positions"
              value={String(data.summary.position_count)}
              sub={`$${fmt(data.summary.total_notional)} notional`}
            />
            <StatCard
              label="Unrealized P&L"
              value={`${pnlSign(data.summary.total_unrealized_pnl)}$${fmt(Math.abs(data.summary.total_unrealized_pnl))}`}
              sub="Open positions"
              valueColor={pnlColor(data.summary.total_unrealized_pnl)}
            />
            <StatCard
              label="Realized P&L"
              value={`${pnlSign(data.summary.total_realized_pnl)}$${fmt(Math.abs(data.summary.total_realized_pnl))}`}
              sub="Recent settlements"
              valueColor={pnlColor(data.summary.total_realized_pnl)}
            />
          </div>

          {/* Total P&L banner */}
          {(data.summary.total_unrealized_pnl !== 0 || data.summary.total_realized_pnl !== 0) && (
            <div
              className="rounded-xl border p-4 flex items-center gap-4"
              style={{
                backgroundColor: totalPnl >= 0 ? '#0d1f12' : '#1a0808',
                borderColor: totalPnl >= 0 ? '#22c55e30' : '#ef444430',
              }}
            >
              <div className="text-3xl font-bold" style={{ color: totalPnlColor }}>
                {pnlSign(totalPnl)}${fmt(Math.abs(totalPnl))}
              </div>
              <div>
                <div className="text-sm font-semibold" style={{ color: '#f1f5f9' }}>
                  Total P&amp;L
                </div>
                <div className="text-xs" style={{ color: '#64748b' }}>
                  Unrealized + Recent Realized
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ backgroundColor: '#12121a' }}>
            {(['positions', 'settlements'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all"
                style={{
                  backgroundColor: tab === t ? '#6366f1' : 'transparent',
                  color: tab === t ? '#fff' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                {t === 'positions' ? `Positions (${data.positions.length})` : `Settlements (${data.settlements.length})`}
              </button>
            ))}
          </div>

          {/* Positions Table */}
          {tab === 'positions' && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              {data.positions.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="text-4xl mb-3">📭</div>
                  <p className="text-sm" style={{ color: '#64748b' }}>No open positions</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e1e2e' }}>
                        {['Market', 'Side', 'Qty', 'Avg Price', 'Curr Price', 'Notional', 'Unr. P&L', 'Rlz. P&L', 'Total P&L'].map((h) => (
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
                      {data.positions.map((pos) => (
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
                            <div className="text-xs mt-0.5 font-mono" style={{ color: '#64748b' }}>
                              {pos.ticker}
                              {pos.category && (
                                <span
                                  className="ml-2 px-1.5 py-0.5 rounded text-xs"
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
                            {pos.quantity}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#94a3b8' }}>
                            ${fmt(pos.avg_price)}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#f1f5f9' }}>
                            ${fmt(pos.current_price)}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#94a3b8' }}>
                            ${fmt(pos.notional)}
                          </td>
                          <td className="px-4 py-3 font-mono font-semibold" style={{ color: pnlColor(pos.unrealized_pnl) }}>
                            {pnlSign(pos.unrealized_pnl)}${fmt(Math.abs(pos.unrealized_pnl))}
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: pnlColor(pos.realized_pnl) }}>
                            {pnlSign(pos.realized_pnl)}${fmt(Math.abs(pos.realized_pnl))}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold" style={{ color: pnlColor(pos.total_pnl) }}>
                            {pnlSign(pos.total_pnl)}${fmt(Math.abs(pos.total_pnl))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Settlements Table */}
          {tab === 'settlements' && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              {data.settlements.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="text-sm" style={{ color: '#64748b' }}>No recent settlements</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e1e2e' }}>
                        {['Market', 'Revenue', 'Profit', 'Date'].map((h) => (
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
                            <div className="font-medium" style={{ color: '#f1f5f9' }}>
                              {s.title || s.ticker}
                            </div>
                            <div className="text-xs font-mono mt-0.5" style={{ color: '#64748b' }}>
                              {s.ticker}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono" style={{ color: '#94a3b8' }}>
                            ${fmt(s.revenue)}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold" style={{ color: pnlColor(s.profit) }}>
                            {pnlSign(s.profit)}${fmt(Math.abs(s.profit))}
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: '#64748b' }}>
                            {s.settled_at
                              ? new Date(s.settled_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Category Breakdown (if positions exist) */}
          {data.positions.length > 0 && (() => {
            const catMap: Record<string, { notional: number; pnl: number; count: number }> = {}
            for (const p of data.positions) {
              const cat = p.category || 'Uncategorized'
              if (!catMap[cat]) catMap[cat] = { notional: 0, pnl: 0, count: 0 }
              catMap[cat].notional += p.notional
              catMap[cat].pnl += p.total_pnl
              catMap[cat].count += 1
            }
            const entries = Object.entries(catMap).sort((a, b) => b[1].notional - a[1].notional)
            const maxNotional = Math.max(...entries.map(([, v]) => v.notional))

            return (
              <div
                className="rounded-xl border p-5"
                style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
              >
                <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: '#64748b' }}>
                  Exposure by Category
                </h2>
                <div className="space-y-4">
                  {entries.map(([cat, stats]) => (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <div className="flex items-center gap-2">
                          <span style={{ color: '#f1f5f9' }}>{cat}</span>
                          <span style={{ color: '#64748b' }}>({stats.count})</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span style={{ color: '#94a3b8' }}>${fmt(stats.notional)} notional</span>
                          <span
                            className="font-semibold"
                            style={{ color: pnlColor(stats.pnl), minWidth: 64, textAlign: 'right' }}
                          >
                            {pnlSign(stats.pnl)}${fmt(Math.abs(stats.pnl))} P&L
                          </span>
                        </div>
                      </div>
                      <div
                        className="h-2 rounded-full overflow-hidden"
                        style={{ backgroundColor: '#1e1e2e' }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(stats.notional / maxNotional) * 100}%`,
                            backgroundColor: stats.pnl >= 0 ? '#6366f1' : '#ef4444',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-24">
          <div className="text-center space-y-3">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6366f1"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-spin mx-auto"
            >
              <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
              <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
            </svg>
            <p className="text-sm" style={{ color: '#64748b' }}>Loading portfolio from Kalshi...</p>
          </div>
        </div>
      )}
    </div>
  )
}
