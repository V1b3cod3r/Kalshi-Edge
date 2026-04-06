'use client'

import { useState } from 'react'
import ScannerTable from '@/components/ScannerTable'
import { ToastNotification } from '@/components/SessionPanel'
import { MarketInput } from '@/lib/types'

interface Toast {
  message: string
  type: 'success' | 'error'
}

interface ParsedMarket extends MarketInput {
  rawLine: string
}

type ScanPhase = 'idle' | 'fetching' | 'scanning' | 'done'

const CATEGORIES = ['All', 'Economics/Finance', 'Politics & Elections', 'Sports', 'Other/General']
const MIN_VOLUME_OPTIONS = [
  { label: 'Any volume', value: 0 },
  { label: '$500+', value: 500 },
  { label: '$1K+', value: 1000 },
  { label: '$5K+', value: 5000 },
]

function parseMarketLine(line: string): ParsedMarket | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const priceMatch = trimmed.match(/(.+?)\s*(?:—|[-–])\s*YES\s*@\s*\$?([\d.]+)/i)
  if (priceMatch) {
    const title = priceMatch[1].trim()
    const yesPrice = parseFloat(priceMatch[2])
    const yesPriceNorm = yesPrice > 1 ? yesPrice / 100 : yesPrice
    return { title, yes_price: yesPriceNorm, no_price: 1 - yesPriceNorm, rawLine: trimmed }
  }

  const fullMatch = trimmed.match(/(.+?)\s+YES\s*@\s*\$?([\d.]+)\s*\/\s*NO\s*@\s*\$?([\d.]+)/i)
  if (fullMatch) {
    const title = fullMatch[1].trim()
    const yesPrice = parseFloat(fullMatch[2])
    const noPrice = parseFloat(fullMatch[3])
    return {
      title,
      yes_price: yesPrice > 1 ? yesPrice / 100 : yesPrice,
      no_price: noPrice > 1 ? noPrice / 100 : noPrice,
      rawLine: trimmed,
    }
  }

  if (trimmed.length > 5) {
    return { title: trimmed, yes_price: 0.5, no_price: 0.5, rawLine: trimmed }
  }

  return null
}

export default function ScannerPage() {
  // Auto-scan state
  const [autoCategory, setAutoCategory] = useState('All')
  const [autoLimit, setAutoLimit] = useState(15)
  const [autoMinVolume, setAutoMinVolume] = useState(0)
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle')
  const [marketsFound, setMarketsFound] = useState(0)

  // Manual scan state
  const [textInput, setTextInput] = useState('')
  const [markets, setMarkets] = useState<ParsedMarket[]>([])
  const [manualLoading, setManualLoading] = useState(false)
  const [manualExpanded, setManualExpanded] = useState(false)

  // Shared
  const [result, setResult] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  // ── Auto-scan ──────────────────────────────────────────────────────────────

  const handleAutoScan = async () => {
    setResult(null)
    setScanPhase('fetching')
    setMarketsFound(0)

    try {
      // Phase 1: fetch markets from Kalshi first to show count
      const fetchParams = new URLSearchParams({
        limit: String(Math.min(autoLimit * 4, 100)),
        ...(autoCategory !== 'All' ? { category: autoCategory } : {}),
      })
      const fetchRes = await fetch(`/api/kalshi/markets?${fetchParams}`)
      const fetchData = await fetchRes.json()
      if (!fetchRes.ok) throw new Error(fetchData.error || 'Failed to fetch markets from Kalshi')

      const rawMarkets: any[] = fetchData.markets || []

      // Client-side filter to show accurate count before Claude runs
      const filtered = rawMarkets.filter((m: any) => {
        // Only filter on volume — let the server handle price normalization
        const vol = Number(m.volume_24h ?? m.volume ?? 0)
        return vol >= autoMinVolume
      })

      const toScan = filtered.slice(0, autoLimit)
      setMarketsFound(toScan.length)

      if (toScan.length === 0) {
        throw new Error('No markets matched your filters. Try reducing the minimum volume.')
      }

      // Phase 2: run full auto-scan (fetch + normalize + Claude in one call)
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

      setResult(scanData.result)
      setScanPhase('done')
    } catch (err: any) {
      setToast({ message: err.message || 'Auto-scan failed', type: 'error' })
      setScanPhase('idle')
    }
  }

  // ── Manual scan ────────────────────────────────────────────────────────────

  const handleParseInput = () => {
    const lines = textInput.split('\n')
    const parsed: ParsedMarket[] = []
    for (const line of lines) {
      const m = parseMarketLine(line)
      if (m) parsed.push(m)
    }
    if (parsed.length === 0) {
      setToast({ message: 'No valid markets found in input', type: 'error' })
      return
    }
    setMarkets((prev) => {
      const existing = new Set(prev.map((m) => m.title))
      return [...prev, ...parsed.filter((m) => !existing.has(m.title))]
    })
    setTextInput('')
  }

  const removeMarket = (index: number) => setMarkets((prev) => prev.filter((_, i) => i !== index))

  const handleManualScan = async () => {
    if (markets.length === 0) {
      setToast({ message: 'Add at least one market to scan', type: 'error' })
      return
    }
    setManualLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/scanner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markets: markets.map(({ rawLine: _r, ...m }) => m) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      setResult(data.result)
    } catch (err: any) {
      setToast({ message: err.message || 'Scan failed', type: 'error' })
    } finally {
      setManualLoading(false)
    }
  }

  const isScanning = scanPhase === 'fetching' || scanPhase === 'scanning'

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
          Market Scanner
        </h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Auto-fetch live Kalshi markets and rank them by AI-estimated edge
        </p>
      </div>

      <div className="space-y-6">

        {/* ── AUTO-SCAN PANEL ───────────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <div className="flex items-center gap-2 mb-5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: '#6366f120' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
              Auto-Scan Live Markets
            </h2>
          </div>

          {/* Filters */}
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
                  backgroundColor: '#0d0d17',
                  border: '1px solid #2a2a3e',
                  borderRadius: '8px',
                  color: '#f1f5f9',
                  padding: '8px 12px',
                  width: '100%',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer',
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
                type="range"
                min={5}
                max={25}
                step={5}
                value={autoLimit}
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
                    className="flex-1 py-2 text-xs rounded-lg font-medium transition-all"
                    style={{
                      backgroundColor: autoMinVolume === opt.value ? '#6366f1' : '#1e1e2e',
                      color: autoMinVolume === opt.value ? '#fff' : '#64748b',
                      cursor: isScanning ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {opt.label === 'Any volume' ? 'Any' : opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Status message */}
          {isScanning && (
            <div
              className="mb-4 p-3 rounded-lg flex items-center gap-3"
              style={{ backgroundColor: '#1a1a35', border: '1px solid #6366f130' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin flex-shrink-0">
                <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
              <span className="text-sm" style={{ color: '#a5b4fc' }}>
                {scanPhase === 'fetching'
                  ? 'Fetching live markets from Kalshi...'
                  : `Analyzing ${marketsFound} markets with Claude — this takes ~30 seconds...`}
              </span>
            </div>
          )}

          {/* Scan button */}
          <button
            onClick={handleAutoScan}
            disabled={isScanning}
            className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
            style={{
              backgroundColor: isScanning ? '#2a2a3e' : '#6366f1',
              color: isScanning ? '#64748b' : '#fff',
              cursor: isScanning ? 'not-allowed' : 'pointer',
            }}
          >
            {isScanning ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                  <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
                {scanPhase === 'fetching' ? 'Fetching markets...' : `Scanning ${marketsFound} markets...`}
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

        {/* ── RESULTS ───────────────────────────────────────────────────────── */}
        {(result || isScanning) && (
          <div>
            {isScanning ? (
              <div
                className="rounded-xl border p-6"
                style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#6366f1' }} />
                  <span className="text-sm" style={{ color: '#94a3b8' }}>
                    {scanPhase === 'fetching'
                      ? 'Connecting to Kalshi...'
                      : `Claude is ranking ${marketsFound} markets...`}
                  </span>
                </div>
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="rounded-lg shimmer" style={{ height: '48px' }} />
                  ))}
                </div>
              </div>
            ) : result ? (
              <ScannerTable markdown={result} />
            ) : null}
          </div>
        )}

        {/* ── MANUAL ENTRY (collapsible) ────────────────────────────────────── */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <button
            onClick={() => setManualExpanded(!manualExpanded)}
            className="w-full px-5 py-4 flex items-center justify-between"
            style={{ color: '#94a3b8' }}
          >
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" />
              </svg>
              <span className="text-sm font-semibold uppercase tracking-wider">Manual Entry</span>
              <span className="text-xs" style={{ color: '#475569' }}>— paste your own markets</span>
            </div>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: manualExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {manualExpanded && (
            <div className="px-5 pb-5 border-t" style={{ borderColor: '#1e1e2e' }}>
              <div className="pt-4 space-y-4">
                <div>
                  <p className="text-xs mb-2" style={{ color: '#64748b' }}>
                    One market per line: <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1e1e2e', color: '#a5b4fc' }}>Title — YES @ $0.XX</code>
                  </p>
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={5}
                    placeholder={'Will the Fed cut rates at May 2026 FOMC? — YES @ $0.28\nWill CPI exceed 3.5% in April 2026? — YES @ $0.38'}
                    style={{
                      backgroundColor: '#0d0d17', border: '1px solid #2a2a3e', borderRadius: '8px',
                      color: '#f1f5f9', padding: '10px 12px', width: '100%', fontSize: '13px',
                      resize: 'vertical', outline: 'none', fontFamily: 'monospace',
                    }}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleParseInput}
                      disabled={!textInput.trim()}
                      className="px-4 py-2 text-sm rounded-lg font-medium"
                      style={{
                        backgroundColor: !textInput.trim() ? '#1e1e2e' : '#6366f120',
                        color: !textInput.trim() ? '#64748b' : '#a5b4fc',
                        border: '1px solid',
                        borderColor: !textInput.trim() ? '#2a2a3e' : '#6366f140',
                      }}
                    >
                      Add to List
                    </button>
                    {markets.length > 0 && (
                      <button onClick={() => setMarkets([])} className="px-4 py-2 text-sm rounded-lg" style={{ color: '#64748b', border: '1px solid #2a2a3e' }}>
                        Clear ({markets.length})
                      </button>
                    )}
                  </div>
                </div>

                {markets.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {markets.map((m, i) => (
                      <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ backgroundColor: '#0d0d17' }}>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" style={{ color: '#f1f5f9' }}>{m.title}</div>
                          <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>YES @ ${m.yes_price.toFixed(2)} ({Math.round(m.yes_price * 100)}%)</div>
                        </div>
                        <button onClick={() => removeMarket(i)} style={{ color: '#64748b' }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                {markets.length > 0 && (
                  <button
                    onClick={handleManualScan}
                    disabled={manualLoading}
                    className="w-full py-3 rounded-xl text-sm font-semibold"
                    style={{ backgroundColor: manualLoading ? '#2a2a3e' : '#6366f1', color: manualLoading ? '#64748b' : '#fff' }}
                  >
                    {manualLoading ? 'Scanning...' : `Scan ${markets.length} Market${markets.length !== 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {toast && <ToastNotification toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
