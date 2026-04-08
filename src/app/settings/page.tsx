'use client'

import { useState, useEffect } from 'react'
import { AppSettings, SessionState, Position } from '@/lib/types'
import { ToastNotification } from '@/components/SessionPanel'

interface Toast {
  message: string
  type: 'success' | 'error'
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border p-6 mb-6"
      style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
    >
      <h2
        className="text-sm font-semibold uppercase tracking-wider mb-5"
        style={{ color: '#94a3b8' }}
      >
        {title}
      </h2>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Partial<AppSettings>>({})
  const [session, setSession] = useState<Partial<SessionState>>({})
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<Toast | null>(null)
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [showKalshiKey, setShowKalshiKey] = useState(false)
  const [anthropicKeyInput, setAnthropicKeyInput] = useState('')
  const [kalshiKeyInput, setKalshiKeyInput] = useState('')
  const [kalshiPrivateKeyInput, setKalshiPrivateKeyInput] = useState('')

  // Settings state
  const [minEdge, setMinEdge] = useState(3)
  const [maxPosition, setMaxPosition] = useState(5)
  const [maxCorrExposure, setMaxCorrExposure] = useState(15)
  const [kellyFraction, setKellyFraction] = useState<'low' | 'medium' | 'high'>('medium')

  // Session state
  const [bankroll, setBankroll] = useState(10000)
  const [startingBankroll, setStartingBankroll] = useState(10000)
  const [winRate, setWinRate] = useState(58)
  const [kellyMod, setKellyMod] = useState(1.0)
  const [maxPositions, setMaxPositions] = useState(5)

  // Position management
  const [positions, setPositions] = useState<Position[]>([])
  const [showAddPosition, setShowAddPosition] = useState(false)
  const [newPosition, setNewPosition] = useState<Partial<Position>>({
    direction: 'YES',
    category: '',
    corr_group: '',
  })

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    try {
      const [settingsRes, sessionRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/session'),
      ])
      const [settingsData, sessionData] = await Promise.all([
        settingsRes.json(),
        sessionRes.json(),
      ])

      const s = settingsData.settings || {}
      setSettings(s)
      setMinEdge(Math.round((s.min_edge_threshold || 0.03) * 100))
      setMaxPosition(Math.round((s.max_position_pct || 0.05) * 100))
      setMaxCorrExposure(Math.round((s.max_corr_exposure_pct || 0.15) * 100))
      setKellyFraction(s.default_kelly_fraction || 'medium')

      const sess = sessionData.session || {}
      setSession(sess)
      setBankroll(sess.current_bankroll || 10000)
      setStartingBankroll(sess.starting_bankroll || 10000)
      setWinRate(Math.round((sess.recent_win_rate || 0.58) * 100))
      setKellyMod(sess.kelly_modifier || 1.0)
      setMaxPositions(sess.max_new_positions || 5)
      setPositions(sess.positions || [])
    } catch {
      setToast({ message: 'Failed to load settings', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const showToast = (msg: string, type: 'success' | 'error') => setToast({ message: msg, type })

  const saveSettings = async () => {
    try {
      const body: any = {
        min_edge_threshold: minEdge / 100,
        max_position_pct: maxPosition / 100,
        max_corr_exposure_pct: maxCorrExposure / 100,
        default_kelly_fraction: kellyFraction,
      }
      if (anthropicKeyInput) body.anthropic_api_key = anthropicKeyInput
      if (kalshiKeyInput) body.kalshi_api_key = kalshiKeyInput
      if (kalshiPrivateKeyInput.trim()) body.kalshi_private_key = kalshiPrivateKeyInput.trim()

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSettings(data.settings)
      setAnthropicKeyInput('')
      setKalshiKeyInput('')
      setKalshiPrivateKeyInput('')
      showToast('Settings saved', 'success')
    } catch (err: any) {
      showToast(err.message || 'Failed to save settings', 'error')
    }
  }

  const saveSession = async () => {
    try {
      const res = await fetch('/api/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_bankroll: bankroll,
          starting_bankroll: startingBankroll,
          recent_win_rate: winRate / 100,
          kelly_modifier: kellyMod,
          max_new_positions: maxPositions,
          positions,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast('Portfolio saved', 'success')
    } catch (err: any) {
      showToast(err.message || 'Failed to save portfolio', 'error')
    }
  }

  const addPosition = () => {
    if (!newPosition.market) return
    const pos: Position = {
      id: `pos-${Date.now()}`,
      market: newPosition.market || '',
      direction: newPosition.direction as 'YES' | 'NO',
      contracts: newPosition.contracts || 1,
      avg_price: newPosition.avg_price || 0.5,
      current_price: newPosition.current_price || newPosition.avg_price || 0.5,
      category: newPosition.category || '',
      corr_group: newPosition.corr_group || '',
    }
    setPositions((prev) => [...prev, pos])
    setNewPosition({ direction: 'YES', category: '', corr_group: '' })
    setShowAddPosition(false)
  }

  const removePosition = (id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id))
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: '#0d0d17',
    border: '1px solid #2a2a3e',
    borderRadius: '8px',
    color: '#f1f5f9',
    padding: '8px 12px',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: '500',
    color: '#94a3b8',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }

  if (loading) {
    return (
      <div className="p-8 max-w-3xl">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border p-6 mb-6 shimmer h-48" style={{ borderColor: '#1e1e2e' }} />
        ))}
      </div>
    )
  }

  const maskedAnthropicKey = (settings as AppSettings).anthropic_api_key || ''
  const maskedKalshiKey = (settings as AppSettings).kalshi_api_key || ''
  const kalshiPrivateKeySaved = (settings as AppSettings).kalshi_private_key === '[saved]'

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
          Settings
        </h1>
        <p className="text-sm" style={{ color: '#64748b' }}>
          Configure API keys, risk parameters, and portfolio state
        </p>
      </div>

      {/* API Keys */}
      <Section title="API Keys">
        <div className="space-y-5">
          {/* Anthropic */}
          <div>
            <label style={labelStyle}>
              Anthropic API Key
              <a
                href="https://console.anthropic.com/account/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 normal-case font-normal"
                style={{ color: '#6366f1', textDecoration: 'none', fontSize: '11px' }}
              >
                Get key →
              </a>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showAnthropicKey ? 'text' : 'password'}
                  value={anthropicKeyInput}
                  onChange={(e) => setAnthropicKeyInput(e.target.value)}
                  placeholder={maskedAnthropicKey || 'sk-ant-...'}
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                className="px-3 rounded-lg border text-xs"
                style={{ borderColor: '#2a2a3e', color: '#64748b', backgroundColor: '#0d0d17' }}
              >
                {showAnthropicKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {maskedAnthropicKey && (
              <p className="text-xs mt-1" style={{ color: '#22c55e' }}>
                ✓ Key saved: {maskedAnthropicKey}
              </p>
            )}
            {!maskedAnthropicKey && (
              <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                Required for AI analysis features
              </p>
            )}
          </div>

          {/* Kalshi Key ID */}
          <div>
            <label style={labelStyle}>
              Kalshi API Key ID
              <a
                href="https://kalshi.com/account/api"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 normal-case font-normal"
                style={{ color: '#6366f1', textDecoration: 'none', fontSize: '11px' }}
              >
                Kalshi API settings →
              </a>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKalshiKey ? 'text' : 'password'}
                  value={kalshiKeyInput}
                  onChange={(e) => setKalshiKeyInput(e.target.value)}
                  placeholder={maskedKalshiKey || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowKalshiKey(!showKalshiKey)}
                className="px-3 rounded-lg border text-xs"
                style={{ borderColor: '#2a2a3e', color: '#64748b', backgroundColor: '#0d0d17' }}
              >
                {showKalshiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {maskedKalshiKey && (
              <p className="text-xs mt-1" style={{ color: '#22c55e' }}>
                ✓ Key ID saved: {maskedKalshiKey}
              </p>
            )}
            {!maskedKalshiKey && (
              <p className="text-xs mt-1" style={{ color: '#64748b' }}>
                The UUID shown on your Kalshi API keys page
              </p>
            )}
          </div>

          {/* Kalshi Private Key */}
          <div>
            <label style={labelStyle}>
              Kalshi RSA Private Key
            </label>
            {kalshiPrivateKeySaved && !kalshiPrivateKeyInput.trim() ? (
              <div
                className="flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm"
                style={{ borderColor: '#2a2a3e', backgroundColor: '#0d0d17' }}
              >
                <span style={{ color: '#22c55e' }}>✓ Private key saved</span>
                <button
                  type="button"
                  onClick={() => setKalshiPrivateKeyInput(' ')}
                  className="text-xs"
                  style={{ color: '#64748b' }}
                >
                  Replace
                </button>
              </div>
            ) : (
              <textarea
                rows={6}
                value={kalshiPrivateKeyInput}
                onChange={(e) => setKalshiPrivateKeyInput(e.target.value)}
                placeholder={'-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----'}
                spellCheck={false}
                style={{
                  ...inputStyle,
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  resize: 'vertical',
                  lineHeight: '1.5',
                }}
              />
            )}
            <p className="text-xs mt-1" style={{ color: '#64748b' }}>
              RSA private key PEM downloaded when you created your Kalshi API key. Required for placing trades.
            </p>
          </div>

          <button
            onClick={saveSettings}
            className="w-full py-2.5 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#6366f1', color: '#fff' }}
          >
            Save API Keys & Settings
          </button>
        </div>
      </Section>

      {/* Risk Parameters */}
      <Section title="Risk Parameters">
        <div className="space-y-6">
          {/* Min Edge Threshold */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={{ ...labelStyle, marginBottom: 0 }}>
                Min Edge Threshold
              </label>
              <span className="text-sm font-semibold" style={{ color: '#f1f5f9' }}>
                {minEdge}%
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={minEdge}
              onChange={(e) => setMinEdge(parseInt(e.target.value))}
              className="w-full"
              style={{ accentColor: '#6366f1' }}
            />
            <p className="text-xs mt-1" style={{ color: '#64748b' }}>
              Minimum edge required before recommending a trade (default: 3%)
            </p>
          </div>

          {/* Max Position Size */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={{ ...labelStyle, marginBottom: 0 }}>
                Max Position Size
              </label>
              <span className="text-sm font-semibold" style={{ color: '#f1f5f9' }}>
                {maxPosition}%
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={maxPosition}
              onChange={(e) => setMaxPosition(parseInt(e.target.value))}
              className="w-full"
              style={{ accentColor: '#6366f1' }}
            />
            <p className="text-xs mt-1" style={{ color: '#64748b' }}>
              Maximum % of bankroll on a single position (default: 5%)
            </p>
          </div>

          {/* Max Correlated Exposure */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={{ ...labelStyle, marginBottom: 0 }}>
                Max Correlated Exposure
              </label>
              <span className="text-sm font-semibold" style={{ color: '#f1f5f9' }}>
                {maxCorrExposure}%
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="25"
              value={maxCorrExposure}
              onChange={(e) => setMaxCorrExposure(parseInt(e.target.value))}
              className="w-full"
              style={{ accentColor: '#6366f1' }}
            />
            <p className="text-xs mt-1" style={{ color: '#64748b' }}>
              Maximum % of bankroll in correlated positions (default: 15%)
            </p>
          </div>

          {/* Kelly Fraction */}
          <div>
            <label style={labelStyle}>Default Kelly Fraction</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'low' as const, label: 'Low (10%)', description: 'High uncertainty' },
                { value: 'medium' as const, label: 'Medium (25%)', description: 'Balanced' },
                { value: 'high' as const, label: 'High (50%)', description: 'High confidence' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setKellyFraction(opt.value)}
                  className="p-3 rounded-lg border text-left transition-all"
                  style={{
                    borderColor: kellyFraction === opt.value ? '#6366f1' : '#2a2a3e',
                    backgroundColor: kellyFraction === opt.value ? '#6366f115' : 'transparent',
                  }}
                >
                  <div className="text-sm font-medium" style={{ color: kellyFraction === opt.value ? '#a5b4fc' : '#f1f5f9' }}>
                    {opt.label}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                    {opt.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={saveSettings}
            className="w-full py-2.5 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#6366f1', color: '#fff' }}
          >
            Save Risk Parameters
          </button>
        </div>
      </Section>

      {/* Portfolio */}
      <Section title="Portfolio & Session">
        <div className="space-y-5">
          {/* Bankroll */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={labelStyle}>Current Bankroll ($)</label>
              <input
                type="number"
                value={bankroll}
                onChange={(e) => setBankroll(parseFloat(e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Starting Bankroll ($)</label>
              <input
                type="number"
                value={startingBankroll}
                onChange={(e) => setStartingBankroll(parseFloat(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Win Rate + Kelly Modifier */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={labelStyle}>Recent Win Rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={winRate}
                onChange={(e) => setWinRate(parseInt(e.target.value))}
                style={inputStyle}
              />
              {winRate < 50 && (
                <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
                  Below 50% — Kelly modifier auto-set to 0.75×
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>Kelly Modifier</label>
              <input
                type="number"
                min="0.1"
                max="2"
                step="0.05"
                value={kellyMod}
                onChange={(e) => setKellyMod(parseFloat(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Max New Positions */}
          <div>
            <label style={labelStyle}>Max New Positions Per Session</label>
            <input
              type="number"
              min="1"
              max="20"
              value={maxPositions}
              onChange={(e) => setMaxPositions(parseInt(e.target.value))}
              style={{ ...inputStyle, maxWidth: '160px' }}
            />
          </div>

          {/* Positions Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label style={{ ...labelStyle, marginBottom: 0 }}>Open Positions</label>
              <button
                onClick={() => setShowAddPosition(true)}
                className="text-xs px-3 py-1 rounded border"
                style={{ borderColor: '#2a2a3e', color: '#94a3b8' }}
              >
                + Add
              </button>
            </div>

            {positions.length === 0 ? (
              <div
                className="text-center py-6 rounded-lg"
                style={{ backgroundColor: '#0d0d17' }}
              >
                <p className="text-sm" style={{ color: '#64748b' }}>
                  No open positions
                </p>
              </div>
            ) : (
              <div
                className="rounded-lg border overflow-hidden"
                style={{ borderColor: '#2a2a3e' }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: '#0d0d17' }}>
                      <th className="px-3 py-2 text-left text-xs" style={{ color: '#64748b' }}>Market</th>
                      <th className="px-3 py-2 text-left text-xs" style={{ color: '#64748b' }}>Dir</th>
                      <th className="px-3 py-2 text-right text-xs" style={{ color: '#64748b' }}>Contracts</th>
                      <th className="px-3 py-2 text-right text-xs" style={{ color: '#64748b' }}>Avg Price</th>
                      <th className="px-3 py-2 text-right text-xs" style={{ color: '#64748b' }}>Corr Group</th>
                      <th className="px-3 py-2 text-xs" style={{ color: '#64748b' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.id} style={{ borderTop: '1px solid #1a1a28' }}>
                        <td className="px-3 py-2">
                          <span className="text-xs truncate max-w-[140px] block" style={{ color: '#f1f5f9' }}>
                            {p.market}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="text-xs font-bold"
                            style={{ color: p.direction === 'YES' ? '#22c55e' : '#ef4444' }}
                          >
                            {p.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs" style={{ color: '#e2e8f0' }}>
                          {p.contracts}
                        </td>
                        <td className="px-3 py-2 text-right text-xs" style={{ color: '#e2e8f0' }}>
                          ${p.avg_price.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs" style={{ color: '#64748b' }}>
                          {p.corr_group || '—'}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removePosition(p.id)}
                            className="text-xs"
                            style={{ color: '#64748b' }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b' }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add Position Form */}
            {showAddPosition && (
              <div
                className="mt-3 p-4 rounded-lg border space-y-3"
                style={{ backgroundColor: '#0d0d17', borderColor: '#2a2a3e' }}
              >
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
                  New Position
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label style={{ ...labelStyle, fontSize: '11px' }}>Market Title</label>
                    <input
                      type="text"
                      value={newPosition.market || ''}
                      onChange={(e) => setNewPosition({ ...newPosition, market: e.target.value })}
                      placeholder="Market name..."
                      style={{ ...inputStyle, fontSize: '13px', padding: '6px 10px' }}
                    />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: '11px' }}>Direction</label>
                    <select
                      value={newPosition.direction}
                      onChange={(e) => setNewPosition({ ...newPosition, direction: e.target.value as 'YES' | 'NO' })}
                      style={{ ...inputStyle, fontSize: '13px', padding: '6px 10px' }}
                    >
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: '11px' }}>Contracts</label>
                    <input
                      type="number"
                      min="1"
                      value={newPosition.contracts || ''}
                      onChange={(e) => setNewPosition({ ...newPosition, contracts: parseInt(e.target.value) })}
                      placeholder="1"
                      style={{ ...inputStyle, fontSize: '13px', padding: '6px 10px' }}
                    />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: '11px' }}>Avg Price ($)</label>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={newPosition.avg_price || ''}
                      onChange={(e) => setNewPosition({ ...newPosition, avg_price: parseFloat(e.target.value) })}
                      placeholder="0.50"
                      style={{ ...inputStyle, fontSize: '13px', padding: '6px 10px' }}
                    />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: '11px' }}>Corr Group</label>
                    <input
                      type="text"
                      value={newPosition.corr_group || ''}
                      onChange={(e) => setNewPosition({ ...newPosition, corr_group: e.target.value })}
                      placeholder="e.g., fed-2026"
                      style={{ ...inputStyle, fontSize: '13px', padding: '6px 10px' }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddPosition(false)}
                    className="flex-1 py-1.5 text-xs rounded border"
                    style={{ borderColor: '#2a2a3e', color: '#94a3b8' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addPosition}
                    className="flex-1 py-1.5 text-xs rounded font-medium"
                    style={{ backgroundColor: '#6366f1', color: '#fff' }}
                  >
                    Add Position
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={saveSession}
            className="w-full py-2.5 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#6366f1', color: '#fff' }}
          >
            Save Portfolio
          </button>
        </div>
      </Section>

      {toast && <ToastNotification toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
