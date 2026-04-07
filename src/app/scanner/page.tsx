'use client'

import { useState } from 'react'
import { ToastNotification } from '@/components/SessionPanel'

interface Toast {
  message: string
  type: 'success' | 'error'
}

interface Opportunity {
  ticker: string
  title: string
  direction: 'YES' | 'NO'
  my_estimate_pct: number
  market_price_pct: number
  edge_pct: number
  score: number
  rationale: string
  key_risk: string
  flags: string[]
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  yes_price: number | null
  no_price: number | null
  volume_24h: number | null
  resolution_date: string | null
}

interface ScreenedOut {
  ticker: string
  title: string
  reason: string
}

type ScanPhase = 'idle' | 'fetching' | 'scanning' | 'done'
type TradeState = 'idle' | 'confirm' | 'loading' | 'success' | 'error'

const CATEGORIES = ['All', 'Economics/Finance', 'Politics & Elections', 'Sports', 'Other/General']
const MIN_VOLUME_OPTIONS = [
  { label: 'Any', value: 0 },
  { label: '$500+', value: 500 },
  { label: '$1K+', value: 1000 },
  { label: '$5K+', value: 5000 },
]

function FlagBadge({ flag }: { flag: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    URGENT: { bg: '#2d1010', color: '#ef4444' },
    VIEW: { bg: '#1a1030', color: '#a5b4fc' },
    AMBIGUOUS: { bg: '#2d2510', color: '#eab308' },
    THIN: { bg: '#1e1e2e', color: '#64748b' },
    CORR: { bg: '#1a2010', color: '#86efac' },
  }
  const s = styles[flag] || { bg: '#1e1e2e', color: '#94a3b8' }
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: s.bg, color: s.color }}>
      {flag}
    </span>
  )
}

function OpportunityCard({ opp, bankroll }: { opp: Opportunity; bankroll: number }) {
  const [tradeState, setTradeState] = useState<TradeState>('idle')
  const [contracts, setContracts] = useState(1)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)

  const side = opp.direction.toLowerCase() as 'yes' | 'no'
  const priceDecimal = side === 'yes' ? (opp.yes_price ?? 0.5) : (opp.no_price ?? 0.5)
  const priceCents = Math.round(priceDecimal * 100)
  const totalCost = (contracts * priceCents) / 100

  const dirColor = opp.direction === 'YES' ? '#22c55e' : '#ef4444'
  const dirBg = opp.direction === 'YES' ? '#22c55e15' : '#ef444415'
  const edgeColor = opp.edge_pct >= 10 ? '#22c55e' : opp.edge_pct >= 5 ? '#eab308' : '#64748b'

  const confidenceColor = opp.confidence === 'HIGH' ? '#22c55e' : opp.confidence === 'MEDIUM' ? '#eab308' : '#64748b'

  const placeTrade = async () => {
    setTradeState('loading')
    setTradeError(null)
    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: opp.ticker,
          side,
          count: contracts,
          price_cents: priceCents,
          title: opp.title,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Trade failed')
      setOrderId(data.order?.order_id)
      setTradeState('success')
    } catch (err: any) {
      setTradeError(err.message || 'Trade execution failed')
      setTradeState('error')
    }
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: '#12121a', borderColor: opp.edge_pct >= 8 ? '#22c55e30' : '#1e1e2e' }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-bold px-2 py-0.5 rounded"
                style={{ backgroundColor: dirBg, color: dirColor }}
              >
                BET {opp.direction}
              </span>
              <span className="text-xs font-mono" style={{ color: '#475569' }}>{opp.ticker}</span>
              {opp.flags.map((f) => <FlagBadge key={f} flag={f} />)}
            </div>
            <h3 className="text-sm font-semibold leading-snug" style={{ color: '#f1f5f9' }}>
              {opp.title}
            </h3>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-2xl font-bold" style={{ color: edgeColor }}>+{opp.edge_pct}%</div>
            <div className="text-xs" style={{ color: '#64748b' }}>edge</div>
          </div>
        </div>

        {/* Probability bar */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
              <span>My estimate</span>
              <span style={{ color: '#a5b4fc', fontWeight: 600 }}>{opp.my_estimate_pct}%</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ backgroundColor: '#1e1e2e' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${opp.my_estimate_pct}%`, backgroundColor: '#6366f1' }}
              />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1" style={{ color: '#64748b' }}>
              <span>Market price</span>
              <span style={{ color: '#64748b', fontWeight: 600 }}>{opp.market_price_pct}%</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ backgroundColor: '#1e1e2e' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${opp.market_price_pct}%`, backgroundColor: '#334155' }}
              />
            </div>
          </div>
          <div className="text-right" style={{ minWidth: '60px' }}>
            <div className="text-xs" style={{ color: '#64748b' }}>Score</div>
            <div className="text-sm font-bold" style={{ color: '#f1f5f9' }}>{opp.score}</div>
          </div>
        </div>

        {/* Rationale */}
        <div
          className="rounded-lg p-3 mb-3"
          style={{ backgroundColor: '#0d0d17', border: '1px solid #1e1e2e' }}
        >
          <p className="text-xs leading-relaxed" style={{ color: '#cbd5e1' }}>{opp.rationale}</p>
          {opp.key_risk && (
            <p className="text-xs mt-2" style={{ color: '#64748b' }}>
              <span style={{ color: '#eab308' }}>Risk:</span> {opp.key_risk}
            </p>
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-4 text-xs" style={{ color: '#475569' }}>
          <span>
            Confidence: <span style={{ color: confidenceColor, fontWeight: 600 }}>{opp.confidence}</span>
          </span>
          {opp.volume_24h != null && (
            <span>Vol 24h: <span style={{ color: '#94a3b8' }}>${opp.volume_24h.toLocaleString()}</span></span>
          )}
          {opp.resolution_date && (
            <span>Expires: <span style={{ color: '#94a3b8' }}>{new Date(opp.resolution_date).toLocaleDateString()}</span></span>
          )}
        </div>
      </div>

      {/* Trade panel */}
      <div className="px-5 pb-5">
        {tradeState === 'success' ? (
          <div
            className="rounded-lg p-3 flex items-center justify-between"
            style={{ backgroundColor: '#0d1f12', border: '1px solid #22c55e40' }}
          >
            <div>
              <div className="text-sm font-semibold" style={{ color: '#22c55e' }}>Order placed</div>
              <div className="text-xs" style={{ color: '#64748b' }}>ID: {orderId} · {contracts} contracts · ${totalCost.toFixed(2)}</div>
            </div>
            <button
              onClick={() => { setTradeState('idle'); setContracts(1) }}
              style={{ color: '#475569', fontSize: '12px' }}
            >
              reset
            </button>
          </div>
        ) : tradeState === 'error' ? (
          <div
            className="rounded-lg p-3"
            style={{ backgroundColor: '#1f0d0d', border: '1px solid #ef444440' }}
          >
            <p className="text-xs" style={{ color: '#ef4444' }}>{tradeError}</p>
            <button
              onClick={() => setTradeState('idle')}
              className="text-xs mt-2"
              style={{ color: '#64748b' }}
            >
              Try again
            </button>
          </div>
        ) : tradeState === 'confirm' ? (
          <div
            className="rounded-lg p-4 space-y-3"
            style={{ backgroundColor: '#0a1a0d', border: '1px solid #22c55e40' }}
          >
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: '#94a3b8' }}>Ticker</span>
              <span className="font-mono font-semibold" style={{ color: '#f1f5f9' }}>{opp.ticker}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: '#94a3b8' }}>Direction</span>
              <span className="font-bold" style={{ color: dirColor }}>{opp.direction}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: '#94a3b8' }}>Limit price</span>
              <span style={{ color: '#f1f5f9' }}>{priceCents}¢ per contract</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: '#94a3b8' }}>Contracts</span>
              <input
                type="number"
                min={1}
                max={999}
                value={contracts}
                onChange={(e) => setContracts(Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: '64px',
                  backgroundColor: '#0d0d17',
                  border: '1px solid #2a2a3e',
                  borderRadius: '6px',
                  color: '#f1f5f9',
                  padding: '4px 8px',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <span className="text-sm font-semibold" style={{ color: '#22c55e' }}>
                = ${totalCost.toFixed(2)}
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={placeTrade}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: '#16a34a', color: '#fff', cursor: 'pointer' }}
              >
                Confirm & Place Order
              </button>
              <button
                onClick={() => setTradeState('idle')}
                className="px-4 py-2.5 rounded-xl text-sm"
                style={{ backgroundColor: '#1e1e2e', color: '#94a3b8', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : tradeState === 'loading' ? (
          <div className="flex items-center gap-2 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
              <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
            </svg>
            <span className="text-sm" style={{ color: '#94a3b8' }}>Placing order...</span>
          </div>
        ) : (
          // idle
          <button
            onClick={() => setTradeState('confirm')}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            style={{ backgroundColor: opp.direction === 'YES' ? '#22c55e' : '#ef4444', color: '#fff', cursor: 'pointer' }}
          >
            Bet {opp.direction} @ {priceCents}¢
          </button>
        )}
      </div>
    </div>
  )
}

export default function ScannerPage() {
  const [autoCategory, setAutoCategory] = useState('All')
  const [autoLimit, setAutoLimit] = useState(15)
  const [autoMinVolume, setAutoMinVolume] = useState(500)
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle')
  const [marketsFound, setMarketsFound] = useState(0)
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [screenedOut, setScreenedOut] = useState<ScreenedOut[]>([])
  const [sessionNotes, setSessionNotes] = useState('')
  const [showScreenedOut, setShowScreenedOut] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  const isScanning = scanPhase === 'fetching' || scanPhase === 'scanning'

  const handleAutoScan = async () => {
    setOpportunities([])
    setScreenedOut([])
    setSessionNotes('')
    setScanPhase('fetching')
    setMarketsFound(0)

    try {
      setScanPhase('scanning')
      const scanRes = await fetch('/api/auto-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: autoCategory !== 'All' ? autoCategory : undefined,
          limit: autoLimit,
          min_volume: autoMinVolume,
        }),
      })

      const scanData = await scanRes.json()
      if (!scanRes.ok) throw new Error(scanData.error || 'Scan failed')

      setMarketsFound(scanData.markets_scanned || 0)
      setOpportunities(scanData.opportunities || [])
      setScreenedOut(scanData.screened_out || [])
      setSessionNotes(scanData.session_notes || '')
      setScanPhase('done')
    } catch (err: any) {
      setToast({ message: err.message || 'Auto-scan failed', type: 'error' })
      setScanPhase('idle')
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>Market Scanner</h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Fetch live Kalshi markets, identify mispriced opportunities, and execute trades
        </p>
      </div>

      {/* Filters + Scan button */}
      <div
        className="rounded-xl border p-6 mb-6"
        style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          {/* Category */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
              Category
            </label>
            <select
              value={autoCategory}
              onChange={(e) => setAutoCategory(e.target.value)}
              disabled={isScanning}
              style={{
                backgroundColor: '#0d0d17', border: '1px solid #2a2a3e', borderRadius: '8px',
                color: '#f1f5f9', padding: '8px 12px', width: '100%', fontSize: '13px',
                outline: 'none', cursor: 'pointer',
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} style={{ backgroundColor: '#12121a' }}>{c}</option>
              ))}
            </select>
          </div>

          {/* Market count */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
              Markets to scan: <span style={{ color: '#a5b4fc' }}>{autoLimit}</span>
            </label>
            <input
              type="range" min={5} max={25} step={5} value={autoLimit}
              onChange={(e) => setAutoLimit(Number(e.target.value))}
              disabled={isScanning}
              className="w-full accent-indigo-500"
              style={{ cursor: isScanning ? 'not-allowed' : 'pointer' }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: '#475569' }}>
              <span>5</span><span>10</span><span>15</span><span>20</span><span>25</span>
            </div>
          </div>

          {/* Min volume */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>
              Min. Volume
            </label>
            <div className="flex gap-1">
              {MIN_VOLUME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setAutoMinVolume(opt.value)}
                  disabled={isScanning}
                  className="flex-1 py-2 text-xs rounded-lg font-medium"
                  style={{
                    backgroundColor: autoMinVolume === opt.value ? '#6366f1' : '#1e1e2e',
                    color: autoMinVolume === opt.value ? '#fff' : '#64748b',
                    cursor: isScanning ? 'not-allowed' : 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isScanning && (
          <div className="mb-4 p-3 rounded-lg flex items-center gap-3" style={{ backgroundColor: '#1a1a35', border: '1px solid #6366f130' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin flex-shrink-0">
              <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
            </svg>
            <span className="text-sm" style={{ color: '#a5b4fc' }}>
              {scanPhase === 'fetching'
                ? 'Fetching live markets from Kalshi...'
                : `Analyzing markets with Claude — this takes ~30 seconds...`}
            </span>
          </div>
        )}

        <button
          onClick={handleAutoScan}
          disabled={isScanning}
          className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
          style={{
            backgroundColor: isScanning ? '#2a2a3e' : '#6366f1',
            color: isScanning ? '#64748b' : '#fff',
            cursor: isScanning ? 'not-allowed' : 'pointer',
          }}
        >
          {isScanning ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
              Scanning...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              Scan Kalshi Now
            </>
          )}
        </button>
      </div>

      {/* Results */}
      {scanPhase === 'done' && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center justify-between text-sm" style={{ color: '#64748b' }}>
            <span>
              Scanned <span style={{ color: '#f1f5f9' }}>{marketsFound}</span> markets ·{' '}
              <span style={{ color: '#22c55e' }}>{opportunities.length}</span> opportunities found
            </span>
            {screenedOut.length > 0 && (
              <button
                onClick={() => setShowScreenedOut(!showScreenedOut)}
                style={{ color: '#475569', fontSize: '12px' }}
              >
                {showScreenedOut ? 'Hide' : 'Show'} {screenedOut.length} screened out
              </button>
            )}
          </div>

          {/* Opportunity cards */}
          {opportunities.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              <p className="text-sm" style={{ color: '#64748b' }}>
                No opportunities found — all {marketsFound} markets appear fairly priced or have insufficient edge.
              </p>
              <p className="text-xs mt-2" style={{ color: '#475569' }}>
                Try lowering the minimum volume filter or scanning a different category.
              </p>
            </div>
          ) : (
            opportunities.map((opp) => (
              <OpportunityCard key={opp.ticker} opp={opp} bankroll={10000} />
            ))
          )}

          {/* Session notes */}
          {sessionNotes && (
            <div className="rounded-lg p-3" style={{ backgroundColor: '#12121a', border: '1px solid #1e1e2e' }}>
              <p className="text-xs" style={{ color: '#64748b' }}>
                <span style={{ color: '#94a3b8' }}>Session notes: </span>{sessionNotes}
              </p>
            </div>
          )}

          {/* Screened out */}
          {showScreenedOut && screenedOut.length > 0 && (
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
              <div className="px-5 py-3 border-b" style={{ borderColor: '#1e1e2e' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
                  Screened Out — No Actionable Edge
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: '#1a1a28' }}>
                {screenedOut.map((m, i) => (
                  <div key={i} className="px-5 py-3 flex items-start gap-3">
                    <span className="text-xs font-mono flex-shrink-0 mt-0.5" style={{ color: '#475569' }}>{m.ticker}</span>
                    <div className="min-w-0">
                      <div className="text-xs truncate" style={{ color: '#94a3b8' }}>{m.title}</div>
                      <div className="text-xs mt-0.5" style={{ color: '#475569' }}>{m.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {isScanning && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border p-5 shimmer" style={{ height: '200px', borderColor: '#1e1e2e' }} />
          ))}
        </div>
      )}

      {toast && <ToastNotification toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
