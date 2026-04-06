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

function parseMarketLine(line: string): ParsedMarket | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // Format: "Market title — YES @ $0.28" or "Market title YES @ $0.28"
  const priceMatch = trimmed.match(/(.+?)\s*(?:—|[-–])\s*YES\s*@\s*\$?([\d.]+)/i)
  if (priceMatch) {
    const title = priceMatch[1].trim()
    const yesPrice = parseFloat(priceMatch[2])
    const yesPriceNorm = yesPrice > 1 ? yesPrice / 100 : yesPrice
    return {
      title,
      yes_price: yesPriceNorm,
      no_price: 1 - yesPriceNorm,
      rawLine: trimmed,
    }
  }

  // Format: "Market title YES @ $0.28 / NO @ $0.72"
  const fullMatch = trimmed.match(/(.+?)\s+YES\s*@\s*\$?([\d.]+)\s*\/\s*NO\s*@\s*\$?([\d.]+)/i)
  if (fullMatch) {
    const title = fullMatch[1].trim()
    const yesPrice = parseFloat(fullMatch[2])
    const noPrice = parseFloat(fullMatch[3])
    const yesPriceNorm = yesPrice > 1 ? yesPrice / 100 : yesPrice
    const noPriceNorm = noPrice > 1 ? noPrice / 100 : noPrice
    return {
      title,
      yes_price: yesPriceNorm,
      no_price: noPriceNorm,
      rawLine: trimmed,
    }
  }

  // Plain market title — use 50/50 as default
  if (trimmed.length > 5) {
    return {
      title: trimmed,
      yes_price: 0.5,
      no_price: 0.5,
      rawLine: trimmed,
    }
  }

  return null
}

function KalshiImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void
  onImport: (markets: ParsedMarket[]) => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/kalshi/markets?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data.markets || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (ticker: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  const handleImport = () => {
    const markets = results
      .filter((m) => selected.has(m.ticker))
      .map((m) => {
        const yesPrice = m.yes_ask ? m.yes_ask / 100 : m.last_price ? m.last_price / 100 : 0.5
        return {
          id: m.ticker,
          title: m.title || m.ticker,
          yes_price: yesPrice,
          no_price: 1 - yesPrice,
          category: m.category || '',
          resolution_date: m.close_time ? m.close_time.split('T')[0] : '',
          volume_24h: m.volume_24h,
          rawLine: `${m.title || m.ticker} — YES @ $${yesPrice.toFixed(2)}`,
        } as ParsedMarket
      })
    onImport(markets)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: '#00000090' }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#1e1e2e' }}>
          <h2 className="text-base font-semibold" style={{ color: '#f1f5f9' }}>
            Import from Kalshi
          </h2>
          <button onClick={onClose} className="text-lg" style={{ color: '#64748b' }}>
            ×
          </button>
        </div>

        <div className="p-6">
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search markets by keyword..."
              className="flex-1 text-sm"
              style={{
                backgroundColor: '#0d0d17',
                borderColor: '#2a2a3e',
                color: '#f1f5f9',
                border: '1px solid #2a2a3e',
                borderRadius: '8px',
                padding: '8px 12px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#6366f1', color: '#fff' }}
            >
              {loading ? '...' : 'Search'}
            </button>
          </div>

          {error && (
            <div
              className="mb-4 p-3 rounded-lg text-sm"
              style={{ backgroundColor: '#2d1010', color: '#ef4444' }}
            >
              {error}
            </div>
          )}

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {results.length === 0 && !loading && (
              <p className="text-sm text-center py-6" style={{ color: '#64748b' }}>
                {error ? 'Check your Kalshi API key in Settings' : 'Search for markets to import'}
              </p>
            )}
            {results.map((m) => {
              const ticker = m.ticker
              const isSelected = selected.has(ticker)
              const yesPrice = m.yes_ask ? m.yes_ask / 100 : m.last_price ? m.last_price / 100 : null

              return (
                <div
                  key={ticker}
                  onClick={() => toggleSelect(ticker)}
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    backgroundColor: isSelected ? '#1a1a35' : '#0d0d17',
                    border: `1px solid ${isSelected ? '#6366f1' : '#1e1e2e'}`,
                  }}
                >
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: isSelected ? '#6366f1' : 'transparent',
                      border: `2px solid ${isSelected ? '#6366f1' : '#2a2a3e'}`,
                    }}
                  >
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: '#f1f5f9' }}>
                      {m.title || ticker}
                    </div>
                    <div className="text-xs" style={{ color: '#64748b' }}>
                      {ticker}
                      {yesPrice !== null && ` · YES @ $${yesPrice.toFixed(2)}`}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {selected.size > 0 && (
            <button
              onClick={handleImport}
              className="mt-4 w-full py-2.5 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: '#6366f1', color: '#fff' }}
            >
              Import {selected.size} Market{selected.size !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ScannerPage() {
  const [textInput, setTextInput] = useState('')
  const [markets, setMarkets] = useState<ParsedMarket[]>([])
  const [showImport, setShowImport] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

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

  const handleImportFromKalshi = (imported: ParsedMarket[]) => {
    setMarkets((prev) => {
      const existing = new Set(prev.map((m) => m.title))
      return [...prev, ...imported.filter((m) => !existing.has(m.title))]
    })
  }

  const removeMarket = (index: number) => {
    setMarkets((prev) => prev.filter((_, i) => i !== index))
  }

  const handleScan = async () => {
    if (markets.length === 0) {
      setToast({ message: 'Add at least one market to scan', type: 'error' })
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const res = await fetch('/api/scanner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markets: markets.map(({ rawLine: _r, ...m }) => m),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      setResult(data.result)
    } catch (err: any) {
      setToast({ message: err.message || 'Scan failed', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const EXAMPLE_MARKETS = `Will the Fed cut rates at the May 2026 FOMC? — YES @ $0.28
Will CPI exceed 3.5% in April 2026? — YES @ $0.38
Will Republicans pass reconciliation by July 2026? — YES @ $0.55`

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
          Market Scanner
        </h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Batch screen and rank multiple markets for trading opportunities
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — Input */}
        <div className="space-y-4">
          {/* Text Input */}
          <div
            className="rounded-xl border p-5"
            style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: '#94a3b8' }}>
              Paste Markets
            </h2>
            <p className="text-xs mb-3" style={{ color: '#64748b' }}>
              One market per line. Format: <code
                className="px-1.5 py-0.5 rounded"
                style={{ backgroundColor: '#1e1e2e', color: '#a5b4fc' }}
              >Title — YES @ $0.XX</code>
            </p>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              rows={6}
              placeholder={EXAMPLE_MARKETS}
              style={{
                backgroundColor: '#0d0d17',
                border: '1px solid #2a2a3e',
                borderRadius: '8px',
                color: '#f1f5f9',
                padding: '10px 12px',
                width: '100%',
                fontSize: '13px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'monospace',
              }}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleParseInput}
                disabled={!textInput.trim()}
                className="flex-1 py-2 text-sm rounded-lg font-medium transition-colors"
                style={{
                  backgroundColor: !textInput.trim() ? '#1e1e2e' : '#6366f120',
                  color: !textInput.trim() ? '#64748b' : '#a5b4fc',
                  border: '1px solid',
                  borderColor: !textInput.trim() ? '#2a2a3e' : '#6366f140',
                }}
              >
                Add to List
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex-1 py-2 text-sm rounded-lg font-medium border transition-colors"
                style={{ borderColor: '#2a2a3e', color: '#94a3b8', backgroundColor: 'transparent' }}
              >
                Import from Kalshi
              </button>
            </div>
          </div>

          {/* Market List */}
          {markets.length > 0 && (
            <div
              className="rounded-xl border p-5"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
                  Markets to Scan ({markets.length})
                </h2>
                <button
                  onClick={() => setMarkets([])}
                  className="text-xs"
                  style={{ color: '#64748b' }}
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {markets.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-2.5 rounded-lg"
                    style={{ backgroundColor: '#0d0d17' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: '#f1f5f9' }}>
                        {m.title}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                        YES @ ${m.yes_price.toFixed(2)} ({Math.round(m.yes_price * 100)}%)
                      </div>
                    </div>
                    <button
                      onClick={() => removeMarket(i)}
                      className="w-6 h-6 flex items-center justify-center rounded flex-shrink-0 transition-colors"
                      style={{ color: '#64748b' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={handleScan}
                disabled={loading || markets.length === 0}
                className="mt-4 w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                style={{
                  backgroundColor: loading ? '#2a2a3e' : '#6366f1',
                  color: loading ? '#64748b' : '#fff',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                      <line x1="12" y1="2" x2="12" y2="6" />
                      <line x1="12" y1="18" x2="12" y2="22" />
                      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                      <line x1="2" y1="12" x2="6" y2="12" />
                      <line x1="18" y1="12" x2="22" y2="12" />
                      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                    </svg>
                    Scanning {markets.length} markets...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    Scan {markets.length} Market{markets.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          )}

          {markets.length === 0 && (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              <p className="text-sm" style={{ color: '#64748b' }}>
                Paste market titles above or import from Kalshi to get started
              </p>
            </div>
          )}
        </div>

        {/* Right — Results */}
        <div>
          {loading ? (
            <div
              className="rounded-xl border p-6"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-sm" style={{ color: '#94a3b8' }}>
                  Scanning {markets.length} markets...
                </span>
              </div>
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="rounded-lg shimmer"
                    style={{ height: '56px', borderRadius: '8px' }}
                  />
                ))}
              </div>
            </div>
          ) : result ? (
            <ScannerTable markdown={result} />
          ) : (
            <div
              className="rounded-xl border p-12 text-center flex flex-col items-center justify-center"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e', minHeight: '300px' }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ backgroundColor: '#1e1e2e' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <h3 className="text-base font-semibold mb-2" style={{ color: '#f1f5f9' }}>
                Scanner Ready
              </h3>
              <p className="text-sm max-w-xs" style={{ color: '#64748b' }}>
                Add markets to the list and click Scan to rank opportunities by edge and confidence.
              </p>
            </div>
          )}
        </div>
      </div>

      {showImport && (
        <KalshiImportModal
          onClose={() => setShowImport(false)}
          onImport={handleImportFromKalshi}
        />
      )}

      {toast && (
        <ToastNotification toast={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
