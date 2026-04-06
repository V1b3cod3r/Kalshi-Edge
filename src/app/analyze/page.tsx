'use client'

import { useState, useEffect } from 'react'
import AnalysisResult from '@/components/AnalysisResult'
import { ToastNotification } from '@/components/SessionPanel'

interface Toast {
  message: string
  type: 'success' | 'error'
}

const CATEGORIES = [
  'Economics/Finance',
  'Politics & Elections',
  'Sports',
  'Other/General',
]

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="rounded-xl border p-5 shimmer"
          style={{ borderColor: '#1e1e2e', height: i === 0 ? '120px' : '80px' }}
        />
      ))}
    </div>
  )
}

export default function AnalyzePage() {
  const [title, setTitle] = useState('')
  const [yesPrice, setYesPrice] = useState('')
  const [noPrice, setNoPrice] = useState('')
  const [resolutionDate, setResolutionDate] = useState('')
  const [resolutionCriteria, setResolutionCriteria] = useState('')
  const [category, setCategory] = useState('')
  const [corrGroup, setCorrGroup] = useState('')
  const [volume, setVolume] = useState('')

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [bankroll, setBankroll] = useState(10000)

  useEffect(() => {
    // Load session for bankroll display
    fetch('/api/session')
      .then((r) => r.json())
      .then((d) => {
        if (d.session?.current_bankroll) {
          setBankroll(d.session.current_bankroll)
        }
      })
      .catch(() => {})
  }, [])

  // Auto-calculate NO price from YES price
  const handleYesPriceChange = (val: string) => {
    setYesPrice(val)
    const n = parseFloat(val)
    if (!isNaN(n) && n >= 0 && n <= 1) {
      setNoPrice((1 - n).toFixed(2))
    } else if (!isNaN(n) && n >= 0 && n <= 100) {
      setNoPrice(((100 - n) / 100).toFixed(2))
    }
  }

  const handleNoPriceChange = (val: string) => {
    setNoPrice(val)
    const n = parseFloat(val)
    if (!isNaN(n) && n >= 0 && n <= 1) {
      setYesPrice((1 - n).toFixed(2))
    }
  }

  const normalizePrice = (val: string): number => {
    const n = parseFloat(val)
    if (isNaN(n)) return 0.5
    if (n > 1) return n / 100
    return n
  }

  const handleAnalyze = async () => {
    if (!title.trim()) {
      setToast({ message: 'Market title is required', type: 'error' })
      return
    }
    if (!yesPrice) {
      setToast({ message: 'YES price is required', type: 'error' })
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const yesPriceNorm = normalizePrice(yesPrice)
      const noPriceNorm = noPrice ? normalizePrice(noPrice) : 1 - yesPriceNorm

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: {
            title: title.trim(),
            yes_price: yesPriceNorm,
            no_price: noPriceNorm,
            resolution_date: resolutionDate || undefined,
            resolution_criteria: resolutionCriteria || undefined,
            category: category || undefined,
            corr_group: corrGroup || undefined,
            volume_24h: volume ? parseFloat(volume) : undefined,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed')
      }

      setResult(data.result)
    } catch (err: any) {
      setToast({ message: err.message || 'Analysis failed', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    backgroundColor: '#0d0d17',
    borderColor: '#2a2a3e',
    color: '#f1f5f9',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '8px',
    padding: '8px 12px',
    width: '100%',
    fontSize: '14px',
    outline: 'none',
  } as React.CSSProperties

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: '500',
    color: '#94a3b8',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  }

  const yesPriceNorm = normalizePrice(yesPrice)

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
          Market Analyzer
        </h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Deep AI analysis of a single Kalshi prediction market
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Panel — Input */}
        <div
          className="rounded-xl border p-6 space-y-5"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
            Market Details
          </h2>

          {/* Title */}
          <div>
            <label style={labelStyle}>Market Title *</label>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={2}
              placeholder='e.g., "Will the Fed cut rates at the May 2026 FOMC meeting?"'
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Prices */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={labelStyle}>YES Price *</label>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: '#64748b' }}
                >
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={yesPrice}
                  onChange={(e) => handleYesPriceChange(e.target.value)}
                  placeholder="0.00"
                  style={{ ...inputStyle, paddingLeft: '24px' }}
                />
              </div>
              {yesPrice && (
                <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                  = {Math.round(yesPriceNorm * 100)}% implied
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>NO Price</label>
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: '#64748b' }}
                >
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={noPrice}
                  onChange={(e) => handleNoPriceChange(e.target.value)}
                  placeholder="0.00"
                  style={{ ...inputStyle, paddingLeft: '24px' }}
                />
              </div>
            </div>
          </div>

          {/* Resolution Date + Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={labelStyle}>Resolution Date</label>
              <input
                type="date"
                value={resolutionDate}
                onChange={(e) => setResolutionDate(e.target.value)}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="" style={{ backgroundColor: '#12121a' }}>Select category...</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat} style={{ backgroundColor: '#12121a' }}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Resolution Criteria */}
          <div>
            <label style={labelStyle}>Resolution Criteria</label>
            <textarea
              value={resolutionCriteria}
              onChange={(e) => setResolutionCriteria(e.target.value)}
              rows={3}
              placeholder="How does this market resolve? Copy from Kalshi..."
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Corr Group + Volume */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={labelStyle}>Correlation Group</label>
              <input
                type="text"
                value={corrGroup}
                onChange={(e) => setCorrGroup(e.target.value)}
                placeholder="e.g., fed-2026"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Volume 24h ($)</label>
              <input
                type="number"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="Optional"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Analyze Button */}
          <button
            onClick={handleAnalyze}
            disabled={loading || !title.trim() || !yesPrice}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
            style={{
              backgroundColor: loading || !title.trim() || !yesPrice ? '#2a2a3e' : '#6366f1',
              color: loading || !title.trim() || !yesPrice ? '#64748b' : '#fff',
              cursor: loading || !title.trim() || !yesPrice ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? (
              <>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
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
                Analyzing...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Analyze Market
              </>
            )}
          </button>
        </div>

        {/* Right Panel — Results */}
        <div>
          {loading ? (
            <div
              className="rounded-xl border p-6"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                <span className="text-sm" style={{ color: '#94a3b8' }}>
                  Claude is analyzing this market...
                </span>
              </div>
              <LoadingSkeleton />
            </div>
          ) : result ? (
            <AnalysisResult
              markdown={result}
              title={title}
              yesPrice={yesPriceNorm}
              noPrice={noPrice ? normalizePrice(noPrice) : 1 - yesPriceNorm}
              bankroll={bankroll}
            />
          ) : (
            <div
              className="rounded-xl border p-12 text-center h-full flex flex-col items-center justify-center"
              style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e', minHeight: '300px' }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ backgroundColor: '#1e1e2e' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </div>
              <h3 className="text-base font-semibold mb-2" style={{ color: '#f1f5f9' }}>
                Ready to Analyze
              </h3>
              <p className="text-sm max-w-xs" style={{ color: '#64748b' }}>
                Enter a market title and YES price, then click Analyze to get a full AI-powered trade recommendation.
              </p>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <ToastNotification toast={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
