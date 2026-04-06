'use client'

import { useState, useEffect } from 'react'
import { SessionState, Position } from '@/lib/types'

interface Toast {
  message: string
  type: 'success' | 'error'
}

function ToastNotification({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg border text-sm font-medium shadow-lg"
      style={{
        backgroundColor: toast.type === 'success' ? '#0d2210' : '#2d1010',
        borderColor: toast.type === 'success' ? '#22c55e40' : '#ef444440',
        color: toast.type === 'success' ? '#22c55e' : '#ef4444',
      }}
    >
      {toast.message}
    </div>
  )
}

export { ToastNotification }

interface SessionPanelProps {
  session: SessionState
  onUpdate: (updates: Partial<SessionState>) => Promise<void>
}

export default function SessionPanel({ session, onUpdate }: SessionPanelProps) {
  const [editing, setEditing] = useState(false)
  const [bankroll, setBankroll] = useState(String(session.current_bankroll))
  const [winRate, setWinRate] = useState(String(Math.round(session.recent_win_rate * 100)))
  const [kellyMod, setKellyMod] = useState(String(session.kelly_modifier))
  const [maxPos, setMaxPos] = useState(String(session.max_new_positions))

  const handleSave = async () => {
    await onUpdate({
      current_bankroll: parseFloat(bankroll),
      recent_win_rate: parseFloat(winRate) / 100,
      kelly_modifier: parseFloat(kellyMod),
      max_new_positions: parseInt(maxPos),
    })
    setEditing(false)
  }

  const inputStyle = {
    backgroundColor: '#0d0d17',
    borderColor: '#2a2a3e',
    color: '#f1f5f9',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '8px',
    padding: '6px 10px',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
  }

  return (
    <div>
      {editing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Current Bankroll ($)</label>
              <input
                type="number"
                value={bankroll}
                onChange={(e) => setBankroll(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Win Rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={winRate}
                onChange={(e) => setWinRate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Kelly Modifier</label>
              <input
                type="number"
                min="0.1"
                max="2"
                step="0.05"
                value={kellyMod}
                onChange={(e) => setKellyMod(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max New Positions</label>
              <input
                type="number"
                min="1"
                max="20"
                value={maxPos}
                onChange={(e) => setMaxPos(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="flex-1 py-2 text-sm rounded-lg border"
              style={{ borderColor: '#2a2a3e', color: '#94a3b8' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-2 text-sm rounded-lg font-medium"
              style={{ backgroundColor: '#6366f1', color: '#fff' }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#0d0d17' }}>
              <div className="text-xs mb-1" style={{ color: '#64748b' }}>Bankroll</div>
              <div className="text-lg font-bold" style={{ color: '#f1f5f9' }}>
                ${session.current_bankroll.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#0d0d17' }}>
              <div className="text-xs mb-1" style={{ color: '#64748b' }}>Win Rate</div>
              <div
                className="text-lg font-bold"
                style={{ color: session.recent_win_rate >= 0.5 ? '#22c55e' : '#ef4444' }}
              >
                {Math.round(session.recent_win_rate * 100)}%
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#0d0d17' }}>
              <div className="text-xs mb-1" style={{ color: '#64748b' }}>Kelly Modifier</div>
              <div className="text-lg font-bold" style={{ color: '#f1f5f9' }}>
                {session.kelly_modifier}×
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#0d0d17' }}>
              <div className="text-xs mb-1" style={{ color: '#64748b' }}>Max Positions</div>
              <div className="text-lg font-bold" style={{ color: '#f1f5f9' }}>
                {session.max_new_positions}
              </div>
            </div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="w-full py-2 text-sm rounded-lg border transition-colors"
            style={{ borderColor: '#2a2a3e', color: '#94a3b8' }}
          >
            Edit Session
          </button>
        </div>
      )}
    </div>
  )
}
