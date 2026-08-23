'use client'

import { useState, useEffect } from 'react'
import { Prediction, CalibrationStats, MistakeType } from '@/lib/types'

type Filter = 'all' | 'pending' | 'resolved'

const MISTAKE_TYPE_LABELS: Record<MistakeType, string> = {
  overconfidence: 'Overconfidence',
  base_rate_neglect: 'Base rate neglect',
  anchoring: 'Anchoring',
  news_overreaction: 'News overreaction',
  thin_market: 'Thin market',
  timing_error: 'Timing error',
  other: 'Other',
}

function brierScore(predictions: Prediction[]): number | null {
  const resolved = predictions.filter((p) => p.outcome != null)
  if (resolved.length === 0) return null
  const sum = resolved.reduce((acc, p) => {
    const outcome = p.outcome === 'YES' ? 1 : 0
    return acc + (p.predicted_probability - outcome) ** 2
  }, 0)
  return sum / resolved.length
}

function calibrationBuckets(predictions: Prediction[]) {
  const resolved = predictions.filter((p) => p.outcome != null)
  const buckets: { label: string; predicted: number; actual: number; count: number }[] = []
  const ranges = [
    [0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5],
    [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01],
  ]
  for (const [lo, hi] of ranges) {
    const bucket = resolved.filter((p) => p.predicted_probability >= lo && p.predicted_probability < hi)
    if (bucket.length === 0) continue
    const avgPredicted = bucket.reduce((s, p) => s + p.predicted_probability, 0) / bucket.length
    const actualRate = bucket.filter((p) => p.outcome === 'YES').length / bucket.length
    buckets.push({
      label: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      predicted: avgPredicted,
      actual: actualRate,
      count: bucket.length,
    })
  }
  return buckets
}

function statsByCategory(predictions: Prediction[]) {
  const resolved = predictions.filter((p) => p.outcome != null)
  const cats: Record<string, { correct: number; total: number; edge: number }> = {}
  for (const p of resolved) {
    const cat = p.category || 'Other'
    if (!cats[cat]) cats[cat] = { correct: 0, total: 0, edge: 0 }
    cats[cat].total++
    cats[cat].edge += p.edge_pct
    const correct =
      (p.direction === 'YES' && p.outcome === 'YES') ||
      (p.direction === 'NO' && p.outcome === 'NO')
    if (correct) cats[cat].correct++
  }
  return Object.entries(cats).map(([cat, s]) => ({
    cat,
    accuracy: s.total > 0 ? (s.correct / s.total) * 100 : 0,
    avgEdge: s.total > 0 ? s.edge / s.total : 0,
    count: s.total,
  }))
}

export default function PredictionsPage() {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [autoResolveStatus, setAutoResolveStatus] = useState<string | null>(null)
  const [calStats, setCalStats] = useState<CalibrationStats | null>(null)

  const loadPredictions = () =>
    fetch('/api/predictions')
      .then((r) => r.json())
      .then((d) => setPredictions(d.predictions || []))

  const loadCalStats = () =>
    fetch('/api/calibration')
      .then((r) => r.json())
      .then((d) => setCalStats(d.stats ?? null))
      .catch(() => setCalStats(null))

  const runAutoResolve = async () => {
    setAutoResolveStatus('Checking Kalshi for resolved markets...')
    try {
      const res = await fetch('/api/predictions/auto-resolve', { method: 'POST' })
      const data = await res.json()
      if (data.resolved > 0) {
        await loadPredictions()
        loadCalStats()
        const wins = data.newly_resolved.filter((r: any) => r.was_correct).length
        const losses = data.newly_resolved.filter((r: any) => !r.was_correct).length
        const parts = []
        if (wins > 0) parts.push(`${wins} win${wins > 1 ? 's' : ''}`)
        if (losses > 0) parts.push(`${losses} loss${losses > 1 ? 'es' : ''}`)
        setAutoResolveStatus(`Auto-resolved ${data.resolved} market${data.resolved > 1 ? 's' : ''}: ${parts.join(', ')}`)
      } else {
        setAutoResolveStatus(null)
      }
    } catch {
      setAutoResolveStatus(null)
    }
  }

  useEffect(() => {
    loadPredictions().finally(() => setLoading(false))
    loadCalStats()
    // Auto-resolve on mount, then every 5 minutes
    runAutoResolve()
    const interval = setInterval(runAutoResolve, 5 * 60 * 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resolve = async (id: string, outcome: 'YES' | 'NO') => {
    setResolvingId(id)
    const res = await fetch(`/api/predictions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    })
    const data = await res.json()
    if (res.ok) {
      setPredictions((prev) => prev.map((p) => (p.id === id ? data.prediction : p)))
      loadCalStats()
    }
    setResolvingId(null)
  }

  const deletePred = async (id: string) => {
    await fetch(`/api/predictions/${id}`, { method: 'DELETE' })
    setPredictions((prev) => prev.filter((p) => p.id !== id))
  }

  const filtered = predictions.filter((p) => {
    if (filter === 'pending') return p.outcome == null
    if (filter === 'resolved') return p.outcome != null
    return true
  })

  const resolved = predictions.filter((p) => p.outcome != null)
  const correct = resolved.filter(
    (p) =>
      (p.direction === 'YES' && p.outcome === 'YES') ||
      (p.direction === 'NO' && p.outcome === 'NO')
  )
  const brier = brierScore(predictions)
  const buckets = calibrationBuckets(predictions)
  const catStats = statsByCategory(predictions)

  const cellStyle = { color: '#94a3b8', fontSize: '13px', padding: '10px 16px' }
  const headerStyle = { color: '#64748b', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', padding: '8px 16px' }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>Calibration Tracker</h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Track model predictions vs outcomes to measure edge and calibration
        </p>
        {autoResolveStatus && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: '#1e1e2e', color: '#94a3b8', border: '1px solid #2a2a3e' }}>
            <span style={{ color: '#6366f1' }}>●</span>
            {autoResolveStatus}
          </div>
        )}
      </div>

      {/* Realized ROI by claimed edge — THE go/no-go metric. Brier measures
          probabilistic calibration, which can improve while losing money;
          this answers "when we claimed X% edge, what did we actually earn per
          dollar risked?" Sits above the Brier box deliberately. */}
      {calStats?.by_edge_bucket && calStats.by_edge_bucket.some((b) => b.count > 0) && (
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
          <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
            Realized Return by Claimed Edge
          </div>
          <p className="text-xs mb-4" style={{ color: '#475569' }}>
            The go/no-go metric. If the higher-edge buckets don&apos;t earn more than the lower ones,
            the edge estimate isn&apos;t predictive — regardless of what the Brier score says.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: '#0d0d17' }}>
                  <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Claimed edge</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Predictions</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Resolved</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Hit rate</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Realized ROI</th>
                </tr>
              </thead>
              <tbody>
                {calStats.by_edge_bucket.map((b) => (
                  <tr key={b.bucket} style={{ borderTop: '1px solid #1a1a28' }}>
                    <td className="px-3 py-2 font-mono" style={{ color: '#f1f5f9' }}>{b.bucket}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>{b.count}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>{b.resolved}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>
                      {b.hit_rate != null ? `${Math.round(b.hit_rate * 100)}%` : '—'}
                    </td>
                    <td
                      className="px-3 py-2 text-right font-bold"
                      style={{ color: b.realized_roi_pct == null ? '#475569' : b.realized_roi_pct > 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {b.realized_roi_pct != null ? `${b.realized_roi_pct > 0 ? '+' : ''}${b.realized_roi_pct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {calStats.by_edge_bucket.every((b) => b.resolved === 0) && (
            <p className="text-xs mt-3" style={{ color: '#64748b' }}>
              No predictions have resolved yet — ROI fills in as markets settle.
            </p>
          )}
        </div>
      )}

      {/* Realized ROI by ORIGIN strategy — the strategy-registry go/no-go
          metric. "Which of my edges actually earns money" as a table, not a
          feeling. See docs/STRATEGY_EXPANSION_PLAN.md. */}
      {calStats?.by_strategy && calStats.by_strategy.some((s) => s.count > 0) && (
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
          <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
            Realized Return by Strategy
          </div>
          <p className="text-xs mb-4" style={{ color: '#475569' }}>
            Every trade is tagged with the strategy that found it. This is how you tell whether a strategy
            is actually earning before scaling it up — or should be turned off.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: '#0d0d17' }}>
                  <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Strategy</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Predictions</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Resolved</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Hit rate</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Brier</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Realized ROI</th>
                </tr>
              </thead>
              <tbody>
                {calStats.by_strategy.map((s) => (
                  <tr key={s.strategy} style={{ borderTop: '1px solid #1a1a28' }}>
                    <td className="px-3 py-2 font-mono" style={{ color: '#f1f5f9' }}>{s.strategy}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>{s.count}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>{s.resolved}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>
                      {s.hit_rate != null ? `${Math.round(s.hit_rate * 100)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>
                      {s.brier != null ? s.brier.toFixed(3) : '—'}
                    </td>
                    <td
                      className="px-3 py-2 text-right font-bold"
                      style={{ color: s.realized_roi_pct == null ? '#475569' : s.realized_roi_pct > 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {s.realized_roi_pct != null ? `${s.realized_roi_pct > 0 ? '+' : ''}${s.realized_roi_pct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {calStats.by_strategy.every((s) => s.resolved === 0) && (
            <p className="text-xs mt-3" style={{ color: '#64748b' }}>
              No predictions have resolved yet — ROI fills in as markets settle.
            </p>
          )}
        </div>
      )}

      {/* Losses grouped by WHY — every loss already gets a Claude post-mortem
          (see lessons.ts) tagged with a mistake_type, but until now nothing
          rolled those up. This answers "which failure mode actually
          recurs" without reading every lesson by hand. */}
      {calStats?.by_mistake_type && calStats.by_mistake_type.some((m) => m.count > 0) && (
        <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
          <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
            Losses by Root Cause
          </div>
          <p className="text-xs mb-4" style={{ color: '#475569' }}>
            Every loss gets an automated post-mortem tagged with why it happened. Sorted by frequency —
            the top row is the failure mode costing the most trades right now.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: '#0d0d17' }}>
                  <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Mistake type</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Losses</th>
                  <th className="px-3 py-2 text-right" style={{ color: '#64748b' }}>Avg claimed edge</th>
                  <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Top categories</th>
                  <th className="px-3 py-2 text-left" style={{ color: '#64748b' }}>Most recent takeaway</th>
                </tr>
              </thead>
              <tbody>
                {calStats.by_mistake_type.filter((m) => m.count > 0).map((m) => (
                  <tr key={m.mistake_type} style={{ borderTop: '1px solid #1a1a28' }}>
                    <td className="px-3 py-2 font-mono" style={{ color: '#f1f5f9' }}>
                      {MISTAKE_TYPE_LABELS[m.mistake_type] ?? m.mistake_type}
                    </td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: '#ef4444' }}>{m.count}</td>
                    <td className="px-3 py-2 text-right" style={{ color: '#94a3b8' }}>{m.avg_edge_claimed_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2" style={{ color: '#94a3b8' }}>{m.top_categories.join(', ') || '—'}</td>
                    <td className="px-3 py-2" style={{ color: '#64748b', maxWidth: '360px' }}>{m.latest_example ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Claude vs Market — the one number that answers "does this thing work" */}
      {calStats && (
        <div
          className="rounded-xl border p-6 mb-6"
          style={{
            backgroundColor: '#12121a',
            borderColor:
              calStats.resolved_predictions < 10
                ? '#1e1e2e'
                : calStats.market_brier != null && calStats.claude_brier < calStats.market_brier
                ? '#22c55e40'
                : '#ef444440',
          }}
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                Claude vs. Market
              </div>
              <div
                className="text-xl font-bold"
                style={{
                  color:
                    calStats.resolved_predictions < 10
                      ? '#94a3b8'
                      : calStats.market_brier != null && calStats.claude_brier < calStats.market_brier
                      ? '#22c55e'
                      : '#ef4444',
                }}
              >
                {calStats.resolved_predictions < 10
                  ? `Not enough data yet (${calStats.resolved_predictions}/10 resolved needed)`
                  : calStats.claude_vs_market}
              </div>
              <p className="text-xs mt-1" style={{ color: '#475569' }}>
                Brier score on resolved predictions — lower is better. This is the honest test:
                if Claude can&apos;t beat the market&apos;s own implied price, the edge isn&apos;t real yet.
              </p>
            </div>
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: '#a5b4fc' }}>
                  {calStats.claude_brier != null ? calStats.claude_brier.toFixed(3) : '—'}
                </div>
                <div className="text-xs" style={{ color: '#64748b' }}>Claude Brier</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: '#94a3b8' }}>
                  {calStats.market_brier != null ? calStats.market_brier.toFixed(3) : '—'}
                </div>
                <div className="text-xs" style={{ color: '#64748b' }}>Market Brier</div>
              </div>
            </div>
          </div>

          {/* By source: does deep analysis beat shallow scanning? */}
          {(calStats.by_source.scanner.count > 0 || calStats.by_source.analyze.count > 0) && (
            <div className="flex gap-6 mt-4 pt-4 border-t" style={{ borderColor: '#1e1e2e' }}>
              {(['scanner', 'analyze'] as const).map((src) => {
                const s = calStats.by_source[src]
                return (
                  <div key={src} className="flex-1">
                    <div className="text-xs uppercase tracking-wider mb-1" style={{ color: '#64748b' }}>
                      {src === 'scanner' ? 'Scanner (shallow)' : 'Analyze (deep)'}
                    </div>
                    <div className="text-sm" style={{ color: '#94a3b8' }}>
                      {s.count === 0
                        ? 'No resolved predictions'
                        : `${s.count} resolved · Brier ${s.brier?.toFixed(3) ?? '—'} · ${s.win_rate != null ? Math.round(s.win_rate * 100) + '% win rate' : '—'}`}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Predictions', value: predictions.length, sub: `${resolved.length} resolved` },
          {
            label: 'Direction Accuracy',
            value: resolved.length ? `${Math.round((correct.length / resolved.length) * 100)}%` : '—',
            sub: `${correct.length}/${resolved.length} correct`,
            color: resolved.length ? (correct.length / resolved.length >= 0.55 ? '#22c55e' : correct.length / resolved.length >= 0.45 ? '#eab308' : '#ef4444') : undefined,
          },
          {
            label: 'Brier Score',
            value: brier != null ? brier.toFixed(3) : '—',
            sub: brier != null ? (brier < 0.2 ? 'excellent' : brier < 0.25 ? 'good' : 'needs work') : 'need resolved bets',
            color: brier != null ? (brier < 0.2 ? '#22c55e' : brier < 0.25 ? '#eab308' : '#ef4444') : undefined,
          },
          {
            label: 'Avg Claimed Edge',
            value: predictions.length ? `${(predictions.reduce((s, p) => s + p.edge_pct, 0) / predictions.length).toFixed(1)}%` : '—',
            sub: 'across all predictions',
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="rounded-xl border p-5" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#64748b' }}>{label}</div>
            <div className="text-2xl font-bold mb-1" style={{ color: color ?? '#f1f5f9' }}>{value}</div>
            <div className="text-xs" style={{ color: '#475569' }}>{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Calibration chart */}
        {buckets.length > 0 && (
          <div className="lg:col-span-2 rounded-xl border p-5" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: '#94a3b8' }}>
              Calibration — Predicted vs Actual Win Rate
            </h3>
            <div className="space-y-2">
              {buckets.map((b) => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="text-xs w-16 text-right flex-shrink-0" style={{ color: '#64748b' }}>{b.label}</span>
                  <div className="flex-1 relative h-5 rounded" style={{ backgroundColor: '#1e1e2e' }}>
                    {/* Predicted bar */}
                    <div
                      className="absolute top-0 left-0 h-full rounded opacity-40"
                      style={{ width: `${b.predicted * 100}%`, backgroundColor: '#6366f1' }}
                    />
                    {/* Actual bar */}
                    <div
                      className="absolute top-0 left-0 h-full rounded"
                      style={{ width: `${b.actual * 100}%`, backgroundColor: b.actual >= b.predicted - 0.05 && b.actual <= b.predicted + 0.05 ? '#22c55e' : '#ef4444' }}
                    />
                  </div>
                  <span className="text-xs w-24 flex-shrink-0" style={{ color: '#94a3b8' }}>
                    {Math.round(b.actual * 100)}% actual
                    <span style={{ color: '#475569' }}> ({b.count})</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: '#475569' }}>
              <span><span className="inline-block w-3 h-2 rounded mr-1" style={{ backgroundColor: '#6366f1', opacity: 0.4 }} />Predicted</span>
              <span><span className="inline-block w-3 h-2 rounded mr-1" style={{ backgroundColor: '#22c55e' }} />Actual (on target)</span>
              <span><span className="inline-block w-3 h-2 rounded mr-1" style={{ backgroundColor: '#ef4444' }} />Actual (off target)</span>
            </div>
          </div>
        )}

        {/* Category breakdown */}
        {catStats.length > 0 && (
          <div className="rounded-xl border p-5" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: '#94a3b8' }}>By Category</h3>
            <div className="space-y-3">
              {catStats.sort((a, b) => b.count - a.count).map((s) => (
                <div key={s.cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: '#94a3b8' }}>{s.cat}</span>
                    <span style={{ color: s.accuracy >= 55 ? '#22c55e' : s.accuracy >= 45 ? '#eab308' : '#ef4444' }}>
                      {s.accuracy.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ backgroundColor: '#1e1e2e' }}>
                    <div className="h-full rounded-full" style={{ width: `${s.accuracy}%`, backgroundColor: s.accuracy >= 55 ? '#22c55e' : '#6366f1' }} />
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#475569' }}>{s.count} resolved · avg edge {s.avgEdge.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter + table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#1e1e2e' }}>
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>Prediction Log</h3>
          <div className="flex gap-1">
            {(['all', 'pending', 'resolved'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-3 py-1 text-xs rounded-lg capitalize"
                style={{
                  backgroundColor: filter === f ? '#6366f1' : '#1e1e2e',
                  color: filter === f ? '#fff' : '#64748b',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm" style={{ color: '#64748b' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm mb-1" style={{ color: '#64748b' }}>No predictions yet</p>
            <p className="text-xs" style={{ color: '#475569' }}>
              Predictions are recorded automatically when you run analyses or scans
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: '#0d0d17' }}>
                  <th style={headerStyle} className="text-left">Market</th>
                  <th style={headerStyle} className="text-left">Category</th>
                  <th style={headerStyle} className="text-right">Predicted</th>
                  <th style={headerStyle} className="text-right">Market</th>
                  <th style={headerStyle} className="text-right">Edge</th>
                  <th style={headerStyle} className="text-left">Dir</th>
                  <th style={headerStyle} className="text-left">Date</th>
                  <th style={headerStyle} className="text-left">Outcome</th>
                  <th style={headerStyle} className="text-left" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const isCorrect =
                    p.outcome != null &&
                    ((p.direction === 'YES' && p.outcome === 'YES') ||
                      (p.direction === 'NO' && p.outcome === 'NO'))

                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #1a1a28' }}>
                      <td style={{ ...cellStyle, maxWidth: '220px' }}>
                        <div className="truncate" style={{ color: '#f1f5f9' }} title={p.market_title}>
                          {p.market_title}
                        </div>
                        {p.ticker && (
                          <div className="text-xs font-mono" style={{ color: '#475569' }}>{p.ticker}</div>
                        )}
                      </td>
                      <td style={cellStyle}>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1e1e2e', color: '#94a3b8' }}>
                          {p.category.replace('Economics/Finance', 'Econ').replace('Politics & Elections', 'Politics')}
                        </span>
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right', color: '#a5b4fc', fontWeight: 600 }}>
                        {Math.round(p.predicted_probability * 100)}%
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right' }}>
                        {Math.round(p.market_price * 100)}%
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'right', color: '#22c55e', fontWeight: 600 }}>
                        +{p.edge_pct.toFixed(1)}%
                      </td>
                      <td style={{ ...cellStyle, color: p.direction === 'YES' ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                        {p.direction}
                      </td>
                      <td style={{ ...cellStyle, color: '#64748b', fontSize: '11px' }}>
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                      <td style={cellStyle}>
                        {p.outcome ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: isCorrect ? '#22c55e20' : '#ef444420',
                                color: isCorrect ? '#22c55e' : '#ef4444',
                              }}
                            >
                              {isCorrect ? '✓ WIN' : '✗ LOSS'} ({p.outcome})
                            </span>
                            {!isCorrect && p.lesson_id && (
                              <span
                                title="Lesson extracted — Claude analyzed this loss and added it to the learning memory"
                                style={{ fontSize: '13px', cursor: 'default' }}
                              >
                                🧠
                              </span>
                            )}
                          </div>
                        ) : resolvingId === p.id ? (
                          <span style={{ color: '#64748b', fontSize: '11px' }}>saving...</span>
                        ) : (
                          <div className="flex gap-1">
                            <button
                              onClick={() => resolve(p.id, 'YES')}
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ backgroundColor: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}
                            >
                              YES
                            </button>
                            <button
                              onClick={() => resolve(p.id, 'NO')}
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ backgroundColor: '#ef444420', color: '#ef4444', border: '1px solid #ef444440' }}
                            >
                              NO
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={cellStyle}>
                        <button
                          onClick={() => deletePred(p.id)}
                          style={{ color: '#334155', fontSize: '14px' }}
                          title="Delete"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
