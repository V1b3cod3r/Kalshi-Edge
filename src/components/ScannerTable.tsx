'use client'

import { useState } from 'react'
import { MarketInput } from '@/lib/types'

interface ScannerTableProps {
  markdown: string
  markets?: MarketInput[]
}

interface ScanRow {
  rank: number
  title: string
  dir: string
  myEst: string
  market: string
  edge: string
  score: string
  flags: string[]
}

type TradeState = 'idle' | 'confirm' | 'loading' | 'success' | 'error'

interface RowTradeState {
  state: TradeState
  contracts: number
  error?: string
  orderId?: string
  totalCost?: number
}

function parseScannerTable(markdown: string): ScanRow[] {
  const rows: ScanRow[] = []
  const tableMatch = markdown.match(/\|[\s\S]*?\|[\s\S]*?(?=\n\n|\n---|\n###|$)/m)
  if (!tableMatch) return rows

  const lines = tableMatch[0].split('\n').filter((l) => l.trim().startsWith('|'))
  const dataLines = lines.filter((l) => !l.includes('---') && !l.toLowerCase().includes('rank'))

  for (const line of dataLines) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length < 7) continue
    const [rankStr, title, dir, myEst, market, edge, score, flagsRaw] = cells
    const rank = parseInt(rankStr)
    if (isNaN(rank)) continue
    const flags = (flagsRaw || '').match(/\[[\w]+\]/g) || []
    rows.push({
      rank,
      title: title || '',
      dir: dir || '',
      myEst: myEst || '',
      market: market || '',
      edge: edge || '',
      score: score || '',
      flags: flags.map((f) => f.replace(/[\[\]]/g, '')),
    })
  }
  return rows
}

function matchMarket(rowTitle: string, markets: MarketInput[]): MarketInput | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const rt = norm(rowTitle)
  // Exact or contains match
  return (
    markets.find((m) => norm(m.title) === rt) ||
    markets.find((m) => norm(m.title).includes(rt)) ||
    markets.find((m) => rt.includes(norm(m.title).slice(0, 40)))
  )
}

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
    <span
      className="text-xs font-medium px-1.5 py-0.5 rounded"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {flag}
    </span>
  )
}

function MarkdownSection({ content }: { content: string }) {
  const html = content
    .replace(/^#### (.+)$/gm, '<h4 style="color:#a5b4fc;font-size:0.875rem;font-weight:600;margin:1em 0 0.5em">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 style="color:#a5b4fc;font-size:1rem;font-weight:600;margin:1.2em 0 0.5em">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#f1f5f9;font-size:1.1rem;font-weight:700;margin:1.5em 0 0.5em;border-bottom:1px solid #1e1e2e;padding-bottom:0.5em">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f1f5f9">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#1e1e2e;padding:0.1em 0.4em;border-radius:4px;color:#a5b4fc;font-size:0.85em">$1</code>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li style="margin-bottom:0.3em;color:#e2e8f0">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>)+/gs, (m) => `<ul style="margin:0.5em 0 0.5em 1.5em">${m}</ul>`)
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #1e1e2e;margin:1em 0" />')
    .replace(/\n\n/g, '<br /><br />')

  return (
    <div
      style={{ color: '#e2e8f0', fontSize: '0.875rem', lineHeight: '1.7' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function BetCell({
  row,
  market,
}: {
  row: ScanRow
  market: MarketInput | undefined
}) {
  const [ts, setTs] = useState<RowTradeState>({ state: 'idle', contracts: 1 })

  if (!market?.id || (row.dir !== 'YES' && row.dir !== 'NO')) {
    return <span style={{ color: '#475569', fontSize: '11px' }}>—</span>
  }

  const side = row.dir.toLowerCase() as 'yes' | 'no'
  const priceDecimal = side === 'yes' ? market.yes_price : market.no_price
  const priceCents = Math.round(priceDecimal * 100)
  const cost = (ts.contracts * priceCents) / 100

  const placeTrade = async () => {
    setTs((p) => ({ ...p, state: 'loading' }))
    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: market.id,
          side,
          count: ts.contracts,
          price_cents: priceCents,
          title: market.title,
          category: market.category,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Trade failed')
      setTs({ state: 'success', contracts: ts.contracts, orderId: data.order?.order_id, totalCost: data.total_cost })
    } catch (err: any) {
      setTs((p) => ({ ...p, state: 'error', error: err.message }))
    }
  }

  if (ts.state === 'success') {
    return (
      <div style={{ fontSize: '11px', color: '#22c55e' }}>
        ✓ ${ts.totalCost?.toFixed(2)}
        <button
          onClick={() => setTs({ state: 'idle', contracts: 1 })}
          style={{ color: '#475569', marginLeft: '6px', fontSize: '10px' }}
        >
          reset
        </button>
      </div>
    )
  }

  if (ts.state === 'error') {
    return (
      <div style={{ fontSize: '11px', color: '#ef4444', maxWidth: '120px' }}>
        {ts.error?.slice(0, 60)}
        <button
          onClick={() => setTs({ state: 'idle', contracts: 1 })}
          style={{ color: '#475569', marginLeft: '6px', fontSize: '10px', display: 'block' }}
        >
          retry
        </button>
      </div>
    )
  }

  if (ts.state === 'confirm') {
    return (
      <div
        style={{
          backgroundColor: '#0a1a0d',
          border: '1px solid #22c55e40',
          borderRadius: '8px',
          padding: '8px',
          minWidth: '160px',
          fontSize: '12px',
        }}
      >
        <div style={{ color: '#94a3b8', marginBottom: '6px' }}>
          <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{market.id}</span>
          {' · '}
          <span style={{ color: row.dir === 'YES' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{row.dir}</span>
          {' · '}
          <span style={{ color: '#f1f5f9' }}>{priceCents}¢</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <label style={{ color: '#64748b', fontSize: '11px' }}>Qty</label>
          <input
            type="number"
            min={1}
            max={99}
            value={ts.contracts}
            onChange={(e) => setTs((p) => ({ ...p, contracts: Math.max(1, parseInt(e.target.value) || 1) }))}
            style={{
              width: '48px',
              backgroundColor: '#0d0d17',
              border: '1px solid #2a2a3e',
              borderRadius: '4px',
              color: '#f1f5f9',
              padding: '2px 6px',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <span style={{ color: '#22c55e', fontWeight: 600 }}>${cost.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={placeTrade}
            style={{
              backgroundColor: '#16a34a',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              flex: 1,
            }}
          >
            Confirm
          </button>
          <button
            onClick={() => setTs({ state: 'idle', contracts: 1 })}
            style={{
              backgroundColor: '#1e1e2e',
              color: '#94a3b8',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  if (ts.state === 'loading') {
    return <span style={{ color: '#94a3b8', fontSize: '11px' }}>Placing...</span>
  }

  // idle
  return (
    <button
      onClick={() => setTs((p) => ({ ...p, state: 'confirm' }))}
      style={{
        backgroundColor: row.dir === 'YES' ? '#22c55e20' : '#ef444420',
        color: row.dir === 'YES' ? '#22c55e' : '#ef4444',
        border: `1px solid ${row.dir === 'YES' ? '#22c55e40' : '#ef444440'}`,
        borderRadius: '6px',
        padding: '4px 10px',
        fontSize: '11px',
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      Bet {row.dir}
    </button>
  )
}

export default function ScannerTable({ markdown, markets = [] }: ScannerTableProps) {
  const [showFull, setShowFull] = useState(false)
  const rows = parseScannerTable(markdown)

  return (
    <div className="space-y-4">
      {/* Ranked Table */}
      {rows.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <div className="px-5 py-4 border-b" style={{ borderColor: '#1e1e2e' }}>
            <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
              Ranked Opportunities
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: '#0d0d17' }}>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Rank</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Market</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Dir</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>My Est.</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Market</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Edge</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Score</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Flags</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>Trade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const matched = matchMarket(row.title, markets)
                  return (
                    <tr
                      key={i}
                      style={{ borderBottom: '1px solid #1a1a28' }}
                    >
                      <td className="px-4 py-3" style={{ color: '#64748b' }}>#{row.rank}</td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <span
                          className="truncate block"
                          style={{ color: '#f1f5f9' }}
                          title={matched?.title || row.title}
                        >
                          {row.title}
                        </span>
                        {matched?.id && (
                          <span style={{ color: '#475569', fontSize: '10px', fontFamily: 'monospace' }}>
                            {matched.id}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-bold"
                          style={{ color: row.dir === 'YES' ? '#22c55e' : row.dir === 'NO' ? '#ef4444' : '#64748b' }}
                        >
                          {row.dir}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: '#a5b4fc' }}>{row.myEst}</td>
                      <td className="px-4 py-3 text-right" style={{ color: '#64748b' }}>{row.market}</td>
                      <td className="px-4 py-3 text-right">
                        <span
                          style={{
                            color: row.edge.startsWith('+') ? '#22c55e' : '#ef4444',
                            fontWeight: '600',
                          }}
                        >
                          {row.edge}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: '#f1f5f9', fontWeight: '600' }}>{row.score}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {row.flags.map((f) => (
                            <FlagBadge key={f} flag={f} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <BetCell row={row} market={matched} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Scan Results */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
      >
        <button
          onClick={() => setShowFull(!showFull)}
          className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors"
          style={{ color: '#94a3b8' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1a1a28' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
        >
          <span className="text-sm font-semibold uppercase tracking-wider">
            Full Scan Analysis
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
              <MarkdownSection content={markdown} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
