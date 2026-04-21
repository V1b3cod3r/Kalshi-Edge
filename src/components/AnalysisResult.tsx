'use client'

import { useState } from 'react'

type TradeState = 'idle' | 'confirm' | 'loading' | 'success' | 'error'

interface ParsedAnalysis {
  title: string
  pData: number | null
  pBlended: number | null
  pMarket: number | null
  edgeDirection: 'YES' | 'NO' | null
  edgeMagnitude: number | null
  direction: 'YES' | 'NO' | 'NO BET' | null
  recommendedSizePct: number | null
  finalSizePct: number | null
  kellyFull: number | null
  tradeClassification: 'DATA-DRIVEN' | 'BLENDED' | 'VIEW-DRIVEN' | null
  viewsApplied: string[]
  action: 'BET' | 'NO_BET'
  rawMarkdown: string
}

function parseAnalysis(markdown: string, title: string): ParsedAnalysis {
  const result: ParsedAnalysis = {
    title,
    pData: null,
    pBlended: null,
    pMarket: null,
    edgeDirection: null,
    edgeMagnitude: null,
    direction: null,
    recommendedSizePct: null,
    finalSizePct: null,
    kellyFull: null,
    tradeClassification: null,
    viewsApplied: [],
    action: 'NO_BET',
    rawMarkdown: markdown,
  }

  // Parse data-only estimate
  const pDataMatch = markdown.match(/My estimate\s*\(data only\)[:\s]+(\d+(?:\.\d+)?)%/i)
  if (pDataMatch) result.pData = parseFloat(pDataMatch[1])

  // Parse view-adjusted estimate
  const pBlendedMatch = markdown.match(/View[-\s]adjusted estimate[:\s]+(\d+(?:\.\d+)?)%/i)
  if (pBlendedMatch) result.pBlended = parseFloat(pBlendedMatch[1])

  // Parse market implied
  const pMarketMatch = markdown.match(/Implied by market[:\s]+(\d+(?:\.\d+)?)%/i)
  if (pMarketMatch) result.pMarket = parseFloat(pMarketMatch[1])

  // Parse edge
  const edgeMatch = markdown.match(/\*\*Edge\*\*[:\s]+([+\-])(\d+(?:\.\d+)?)%\s+on\s+(YES|NO)/i)
  if (edgeMatch) {
    result.edgeMagnitude = parseFloat(edgeMatch[2])
    result.edgeDirection = edgeMatch[3].toUpperCase() as 'YES' | 'NO'
  }

  // Parse direction
  const dirMatch = markdown.match(/\*\*Direction\*\*[:\s]+(YES|NO|NO BET)/i)
  if (dirMatch) {
    const dir = dirMatch[1].toUpperCase()
    result.direction = dir as 'YES' | 'NO' | 'NO BET'
    result.action = dir === 'NO BET' ? 'NO_BET' : 'BET'
  }

  // Parse Kelly f*
  const kellyMatch = markdown.match(/\*\*Kelly f\*\*[:\s]+(\d+(?:\.\d+)?)%/i)
  if (kellyMatch) result.kellyFull = parseFloat(kellyMatch[1])

  // Parse recommended size
  const recSizeMatch = markdown.match(/\*\*Recommended size\*\*[:\s]+(\d+(?:\.\d+)?)%/i)
  if (recSizeMatch) result.recommendedSizePct = parseFloat(recSizeMatch[1])

  // Parse final recommended size
  const finalSizeMatch = markdown.match(/\*\*Final recommended size\*\*[:\s]+(\d+(?:\.\d+)?)%/i)
  if (finalSizeMatch) result.finalSizePct = parseFloat(finalSizeMatch[1])

  // Parse trade classification
  const classMatch = markdown.match(/Trade classification[:\s]+(DATA-DRIVEN|BLENDED|VIEW-DRIVEN)/i)
  if (classMatch) result.tradeClassification = classMatch[1].toUpperCase() as any

  // Parse views applied
  const viewsMatch = markdown.match(/Views applied[:\s]+([^\n]+)/i)
  if (viewsMatch) {
    const viewsText = viewsMatch[1]
    if (!viewsText.toLowerCase().includes('none') && !viewsText.toLowerCase().includes('no active')) {
      const ids = viewsText.match(/view-[\w-]+/gi)
      if (ids) result.viewsApplied = ids
    }
  }

  return result
}

function MarkdownRenderer({ content }: { content: string }) {
  // Basic markdown to HTML (for display in dark prose)
  const html = content
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li>$2</li>')
    .replace(/^---+$/gm, '<hr />')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hpliuoctrb])(.+)$/gm, '<p>$1</p>')

  return (
    <div
      className="prose-dark"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

interface AnalysisResultProps {
  markdown: string
  title: string
  ticker?: string
  yesPrice: number
  noPrice: number
  bankroll?: number
}

export default function AnalysisResult({
  markdown,
  title,
  ticker,
  yesPrice,
  noPrice,
  bankroll = 10000,
}: AnalysisResultProps) {
  const [showFull, setShowFull] = useState(false)
  const [tradeState, setTradeState] = useState<TradeState>('idle')
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [tradeResult, setTradeResult] = useState<any>(null)
  const parsed = parseAnalysis(markdown, title)

  const classificationColors = {
    'DATA-DRIVEN': { bg: '#0d1b2e', color: '#60a5fa', border: '#1e3a5f' },
    'BLENDED': { bg: '#1e0d2e', color: '#c084fc', border: '#3d1b5f' },
    'VIEW-DRIVEN': { bg: '#2e1a0d', color: '#fb923c', border: '#5f3a1e' },
  }

  const directionColor =
    parsed.direction === 'YES'
      ? '#22c55e'
      : parsed.direction === 'NO'
      ? '#ef4444'
      : '#64748b'

  const recommendedDollars = parsed.finalSizePct
    ? (parsed.finalSizePct / 100) * bankroll
    : parsed.recommendedSizePct
    ? (parsed.recommendedSizePct / 100) * bankroll
    : null

  const tradeDirection = parsed.direction === 'YES' || parsed.direction === 'NO' ? parsed.direction : null
  const pricePerContract = tradeDirection === 'YES' ? yesPrice : noPrice
  const contracts = recommendedDollars !== null && pricePerContract > 0
    ? Math.floor(recommendedDollars / pricePerContract)
    : 0
  const priceCents = Math.round(pricePerContract * 100)
  const canExecute = parsed.action === 'BET' && tradeDirection !== null && !!ticker && contracts >= 1

  const executeTrade = async () => {
    if (!ticker || !tradeDirection) return
    setTradeState('loading')
    setTradeError(null)
    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          side: tradeDirection.toLowerCase(),
          count: contracts,
          price_cents: priceCents,
          title,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Trade failed')
      setTradeResult(data)
      setTradeState('success')
      // Auto-record prediction for calibration tracking
      if (parsed.pBlended !== null || parsed.pData !== null) {
        const predictedProb = (parsed.pBlended ?? parsed.pData ?? 50) / 100
        const edge = parsed.edgeMagnitude ?? 0
        fetch('/api/predictions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            market_title: title,
            ticker,
            predicted_probability: predictedProb,
            direction: tradeDirection,
            market_price: pricePerContract,
            edge_pct: edge,
            source: 'analyze',
          }),
        }).catch(() => {/* silent */})
      }
    } catch (err: any) {
      setTradeError(err.message || 'Trade execution failed')
      setTradeState('error')
    }
  }

  return (
    <div className="space-y-4">
      {/* Trade Recommendation Card */}
      <div
        className="rounded-xl border p-5"
        style={{
          backgroundColor: '#12121a',
          borderColor: parsed.action === 'BET' ? '#22c55e30' : '#1e1e2e',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
            Trade Recommendation
          </h3>
          <span
            className="text-xs font-bold px-3 py-1 rounded-full"
            style={{
              backgroundColor: parsed.action === 'BET' ? '#22c55e20' : '#1e1e2e',
              color: parsed.action === 'BET' ? '#22c55e' : '#64748b',
            }}
          >
            {parsed.action === 'BET' ? 'BET' : 'NO BET'}
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div>
            <div
              className="text-4xl font-bold tracking-tight"
              style={{ color: directionColor }}
            >
              {parsed.direction || '—'}
            </div>
            <div className="text-xs mt-1" style={{ color: '#64748b' }}>
              Direction
            </div>
          </div>

          <div className="flex-1 grid grid-cols-3 gap-4">
            <div>
              <div className="text-lg font-semibold" style={{ color: '#f1f5f9' }}>
                {parsed.finalSizePct !== null
                  ? `${parsed.finalSizePct.toFixed(1)}%`
                  : parsed.recommendedSizePct !== null
                  ? `${parsed.recommendedSizePct.toFixed(1)}%`
                  : '—'}
              </div>
              <div className="text-xs" style={{ color: '#64748b' }}>
                Bankroll %
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold" style={{ color: '#f1f5f9' }}>
                {recommendedDollars !== null ? `$${recommendedDollars.toFixed(0)}` : '—'}
              </div>
              <div className="text-xs" style={{ color: '#64748b' }}>
                Position Size
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold" style={{ color: '#f1f5f9' }}>
                {parsed.kellyFull !== null ? `${parsed.kellyFull.toFixed(1)}%` : '—'}
              </div>
              <div className="text-xs" style={{ color: '#64748b' }}>
                Full Kelly
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Execute Trade Panel */}
      {parsed.action === 'BET' && tradeDirection && (
        <div
          className="rounded-xl border p-5"
          style={{
            backgroundColor: '#0d1f12',
            borderColor: tradeState === 'success' ? '#22c55e60' : tradeState === 'error' ? '#ef444460' : '#22c55e30',
          }}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: '#94a3b8' }}>
            Execute Trade
          </h3>

          {tradeState === 'success' && tradeResult ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-semibold" style={{ color: '#22c55e' }}>
                  Order placed successfully
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: '#94a3b8' }}>
                <div>Order ID: <span style={{ color: '#f1f5f9' }}>{tradeResult.order?.order_id}</span></div>
                <div>Status: <span style={{ color: '#22c55e' }}>{tradeResult.order?.status}</span></div>
                <div>Contracts: <span style={{ color: '#f1f5f9' }}>{tradeResult.position?.contracts}</span></div>
                <div>Total Cost: <span style={{ color: '#f1f5f9' }}>${tradeResult.total_cost?.toFixed(2)}</span></div>
              </div>
              <button
                onClick={() => setTradeState('idle')}
                className="text-xs"
                style={{ color: '#64748b' }}
              >
                Reset
              </button>
            </div>
          ) : tradeState === 'error' ? (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: '#ef4444' }}>{tradeError}</p>
              <button
                onClick={() => setTradeState('idle')}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ backgroundColor: '#1e1e2e', color: '#94a3b8' }}
              >
                Try again
              </button>
            </div>
          ) : tradeState === 'confirm' ? (
            <div className="space-y-4">
              <div
                className="rounded-lg p-4 space-y-2 text-sm"
                style={{ backgroundColor: '#0a1a0d', borderColor: '#1a3a1e', borderWidth: '1px', borderStyle: 'solid' }}
              >
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Ticker</span>
                  <span className="font-mono font-semibold" style={{ color: '#f1f5f9' }}>{ticker}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Direction</span>
                  <span className="font-semibold" style={{ color: directionColor }}>{tradeDirection}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Contracts</span>
                  <span style={{ color: '#f1f5f9' }}>{contracts}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: '#64748b' }}>Limit Price</span>
                  <span style={{ color: '#f1f5f9' }}>${pricePerContract.toFixed(2)} ({priceCents}¢)</span>
                </div>
                <div className="flex justify-between border-t pt-2" style={{ borderColor: '#1e3a20' }}>
                  <span className="font-semibold" style={{ color: '#94a3b8' }}>Total Cost</span>
                  <span className="font-bold" style={{ color: '#22c55e' }}>
                    ${(contracts * pricePerContract).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={executeTrade}
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
            <div className="flex items-center gap-3 py-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
              <span className="text-sm" style={{ color: '#94a3b8' }}>Placing order with Kalshi...</span>
            </div>
          ) : (
            // idle
            <div className="space-y-3">
              {!ticker ? (
                <p className="text-xs" style={{ color: '#64748b' }}>
                  Enter a Market Ticker above to enable trade execution.
                </p>
              ) : !canExecute ? (
                <p className="text-xs" style={{ color: '#64748b' }}>
                  {contracts < 1
                    ? `Position size too small for 1 contract at ${(pricePerContract * 100).toFixed(0)}¢.`
                    : 'Analysis must recommend a BET to execute.'}
                </p>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="text-sm" style={{ color: '#94a3b8' }}>
                    <span className="font-semibold" style={{ color: '#f1f5f9' }}>{contracts} contract{contracts !== 1 ? 's' : ''}</span>
                    {' '}· {tradeDirection} · {ticker} ·{' '}
                    <span style={{ color: '#22c55e' }}>${(contracts * pricePerContract).toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => setTradeState('confirm')}
                    className="px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ backgroundColor: '#22c55e', color: '#0a1a0d', cursor: 'pointer' }}
                  >
                    Execute Trade
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Probability Estimate */}
      {(parsed.pData !== null || parsed.pBlended !== null || parsed.pMarket !== null) && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: '#94a3b8' }}>
            Probability Estimates
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div
                className="text-2xl font-bold"
                style={{ color: '#a5b4fc' }}
              >
                {parsed.pData !== null ? `${parsed.pData.toFixed(0)}%` : '—'}
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                Data Only (p_data)
              </div>
            </div>
            <div>
              <div
                className="text-2xl font-bold"
                style={{ color: '#818cf8' }}
              >
                {parsed.pBlended !== null ? `${parsed.pBlended.toFixed(0)}%` : '—'}
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                View-Adjusted (p_blended)
              </div>
            </div>
            <div>
              <div
                className="text-2xl font-bold"
                style={{ color: '#64748b' }}
              >
                {parsed.pMarket !== null ? `${parsed.pMarket.toFixed(0)}%` : `${Math.round(yesPrice * 100)}%`}
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                Market Implied
              </div>
            </div>
          </div>

          {parsed.edgeMagnitude !== null && parsed.edgeDirection && (
            <div
              className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{
                backgroundColor: parsed.edgeDirection === 'YES' ? '#22c55e15' : '#ef444415',
              }}
            >
              <div
                className="text-sm font-bold"
                style={{ color: parsed.edgeDirection === 'YES' ? '#22c55e' : '#ef4444' }}
              >
                {parsed.edgeDirection === 'YES' ? '+' : '+'}
                {parsed.edgeMagnitude.toFixed(1)}% Edge on {parsed.edgeDirection}
              </div>
            </div>
          )}
        </div>
      )}

      {/* View Influence */}
      {(parsed.tradeClassification || parsed.viewsApplied.length > 0) && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '#94a3b8' }}>
            Macro View Influence
          </h3>
          <div className="flex items-center gap-3 flex-wrap">
            {parsed.tradeClassification && (
              <span
                className="text-xs font-bold px-3 py-1 rounded-full border"
                style={{
                  ...classificationColors[parsed.tradeClassification],
                  borderColor: classificationColors[parsed.tradeClassification].border,
                }}
              >
                {parsed.tradeClassification}
              </span>
            )}
            {parsed.viewsApplied.length > 0 ? (
              parsed.viewsApplied.map((v) => (
                <span
                  key={v}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: '#1e1e2e', color: '#a5b4fc' }}
                >
                  {v}
                </span>
              ))
            ) : (
              <span className="text-xs" style={{ color: '#64748b' }}>
                No views applied
              </span>
            )}
          </div>
        </div>
      )}

      {/* Full Analysis Toggle */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
      >
        <button
          onClick={() => setShowFull(!showFull)}
          className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors"
          style={{ color: '#94a3b8' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#1a1a28'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <span className="text-sm font-semibold uppercase tracking-wider">
            Full Analysis
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: showFull ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {showFull && (
          <div className="px-5 pb-5 border-t" style={{ borderColor: '#1e1e2e' }}>
            <div className="pt-4">
              <MarkdownRenderer content={markdown} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
