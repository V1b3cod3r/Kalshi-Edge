/**
 * Kalshi Edge — Dashboard
 *
 * AI-powered prediction market trading analysis tool.
 *
 * Setup:
 * 1. Run `npm install` to install dependencies
 * 2. Copy `.env.local.example` to `.env.local`
 * 3. Add your Anthropic and Kalshi API keys in Settings (/settings)
 * 4. The app stores data in /data/*.json (views, session, settings)
 */

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { SessionState, MacroView, AppSettings } from '@/lib/types'

function ConvictionBadge({ conviction }: { conviction: 'LOW' | 'MEDIUM' | 'HIGH' }) {
  const styles = {
    LOW: { bg: '#1e1e2e', color: '#64748b' },
    MEDIUM: { bg: '#2d2510', color: '#eab308' },
    HIGH: { bg: '#0d2210', color: '#22c55e' },
  }
  const s = styles[conviction]
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {conviction}
    </span>
  )
}

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState>({
    current_bankroll: 10000,
    starting_bankroll: 10000,
    positions: [],
    corr_groups: {},
    recent_win_rate: 0.58,
    kelly_modifier: 1.0,
    avoid_categories: [],
    max_new_positions: 5,
  })
  const [views, setViews] = useState<MacroView[]>([])
  const [settings, setSettings] = useState<Partial<AppSettings>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/session').then((r) => r.json()),
      fetch('/api/views').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ])
      .then(([sessionData, viewsData, settingsData]) => {
        if (sessionData.session) setSession(sessionData.session)
        if (viewsData.views) setViews(viewsData.views)
        if (settingsData.settings) setSettings(settingsData.settings)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [])

  const bankrollChange = session.current_bankroll - session.starting_bankroll
  const bankrollChangePct = ((bankrollChange / session.starting_bankroll) * 100).toFixed(1)
  const totalNotional = session.positions.reduce(
    (sum, p) => sum + p.contracts * p.current_price,
    0
  )
  const topViews = [...views]
    .sort((a, b) => {
      const order = { HIGH: 0, MEDIUM: 1, LOW: 2 }
      return order[a.conviction] - order[b.conviction]
    })
    .slice(0, 3)

  const hasApiKeys = settings.anthropic_api_key || settings.kalshi_api_key

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
          Dashboard
        </h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Load error */}
      {loadError && (
        <div
          className="mb-6 p-4 rounded-xl border flex items-center justify-between"
          style={{ backgroundColor: '#1f0d0d', borderColor: '#ef444430' }}
        >
          <span className="text-sm" style={{ color: '#ef4444' }}>
            Failed to load dashboard data. Check that the server is running.
          </span>
          <button
            onClick={() => window.location.reload()}
            className="text-sm px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: '#2d1010', color: '#ef4444' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* API Key Warning */}
      {!loading && !settings.anthropic_api_key && (
        <div
          className="mb-6 p-4 rounded-xl border flex items-center justify-between"
          style={{ backgroundColor: '#1a1505', borderColor: '#eab30830' }}
        >
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-sm" style={{ color: '#eab308' }}>
              API keys not configured. Analysis features require your Anthropic API key.
            </span>
          </div>
          <Link
            href="/settings"
            className="text-sm font-medium px-3 py-1.5 rounded-lg no-underline"
            style={{ backgroundColor: '#2d2510', color: '#eab308' }}
          >
            Configure →
          </Link>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Bankroll */}
        <div
          className="p-5 rounded-xl border"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>
              Bankroll
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
            ${session.current_bankroll.toLocaleString()}
          </div>
          <div
            className="text-xs font-medium"
            style={{ color: bankrollChange >= 0 ? '#22c55e' : '#ef4444' }}
          >
            {bankrollChange >= 0 ? '+' : ''}
            {bankrollChangePct}% from start
          </div>
        </div>

        {/* Portfolio */}
        <div
          className="p-5 rounded-xl border"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>
              Positions
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
            {session.positions.length}
          </div>
          <div className="text-xs" style={{ color: '#64748b' }}>
            ${totalNotional.toFixed(0)} notional at risk
          </div>
        </div>

        {/* Views */}
        <div
          className="p-5 rounded-xl border"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>
              Active Views
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
            {views.length}
          </div>
          <div className="text-xs" style={{ color: '#64748b' }}>
            {views.filter((v) => v.conviction === 'HIGH').length} high conviction
          </div>
        </div>

        {/* Performance */}
        <div
          className="p-5 rounded-xl border"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#64748b' }}>
              Win Rate
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
          </div>
          <div
            className="text-2xl font-bold mb-1"
            style={{ color: session.recent_win_rate >= 0.5 ? '#22c55e' : '#ef4444' }}
          >
            {Math.round(session.recent_win_rate * 100)}%
          </div>
          <div className="text-xs" style={{ color: '#64748b' }}>
            Kelly mod: {session.kelly_modifier}×
            {session.recent_win_rate < 0.5 && (
              <span style={{ color: '#ef4444' }}> (auto-reduced)</span>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Link
          href="/analyze"
          className="p-5 rounded-xl border flex items-center gap-4 no-underline group transition-all"
          style={{ backgroundColor: '#12121a', borderColor: '#6366f130' }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.borderColor = '#6366f1'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.borderColor = '#6366f130'
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#6366f120' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
          <div>
            <div className="font-semibold text-sm mb-0.5" style={{ color: '#f1f5f9' }}>
              Analyze Market
            </div>
            <div className="text-xs" style={{ color: '#64748b' }}>
              Deep analysis of a single Kalshi market
            </div>
          </div>
        </Link>

        <Link
          href="/scanner"
          className="p-5 rounded-xl border flex items-center gap-4 no-underline group transition-all"
          style={{ backgroundColor: '#12121a', borderColor: '#22c55e30' }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.borderColor = '#22c55e'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.borderColor = '#22c55e30'
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#22c55e20' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <div className="font-semibold text-sm mb-0.5" style={{ color: '#f1f5f9' }}>
              Scan Markets
            </div>
            <div className="text-xs" style={{ color: '#64748b' }}>
              Batch screen and rank multiple markets
            </div>
          </div>
        </Link>
      </div>

      {/* Active Views Preview */}
      <div
        className="rounded-xl border p-5"
        style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
            Top Views by Conviction
          </h2>
          <Link
            href="/views"
            className="text-xs no-underline transition-colors"
            style={{ color: '#6366f1' }}
          >
            View All →
          </Link>
        </div>

        {topViews.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm mb-3" style={{ color: '#64748b' }}>
              No macro views yet. Add your market thesis to get started.
            </p>
            <Link
              href="/views"
              className="text-sm font-medium px-4 py-2 rounded-lg no-underline"
              style={{ backgroundColor: '#6366f1', color: '#fff' }}
            >
              Add First View
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {topViews.map((view) => (
              <div
                key={view.id}
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{ backgroundColor: '#0d0d17' }}
              >
                <ConvictionBadge conviction={view.conviction} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug" style={{ color: '#e2e8f0' }}>
                    {view.thesis.length > 100 ? view.thesis.slice(0, 100) + '…' : view.thesis}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: '#64748b' }}>
                    <span>{view.affects_category}</span>
                    <span>·</span>
                    <span>{view.timeframe}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
