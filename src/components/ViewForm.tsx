'use client'

import { useState, useEffect } from 'react'
import { MacroView } from '@/lib/types'

interface ViewFormProps {
  view?: MacroView | null
  onSave: (data: Omit<MacroView, 'id' | 'created_at' | 'updated_at'>) => void
  onCancel: () => void
}

const CATEGORIES = [
  'Economics/Finance',
  'Politics & Elections',
  'Sports',
  'Other/General',
]

const CONVICTION_OPTIONS: { value: 'LOW' | 'MEDIUM' | 'HIGH'; label: string; color: string }[] = [
  { value: 'LOW', label: 'Low', color: '#64748b' },
  { value: 'MEDIUM', label: 'Medium', color: '#eab308' },
  { value: 'HIGH', label: 'High', color: '#22c55e' },
]

export default function ViewForm({ view, onSave, onCancel }: ViewFormProps) {
  const [thesis, setThesis] = useState('')
  const [direction, setDirection] = useState('')
  const [conviction, setConviction] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM')
  const [timeframeDate, setTimeframeDate] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [keywordsInput, setKeywordsInput] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [pImplied, setPImplied] = useState<string>('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (view) {
      setThesis(view.thesis)
      setDirection(view.direction)
      setConviction(view.conviction)
      const dateStr = view.timeframe.replace(/^through\s+/i, '')
      setTimeframeDate(dateStr)
      setCategory(view.affects_category)
      setKeywords(view.affects_keywords)
      setPImplied(view.p_implied !== null ? String(Math.round(view.p_implied * 100)) : '')
      setNotes(view.notes)
    }
  }, [view])

  const handleAddKeyword = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const kw = keywordsInput.trim().replace(/,+$/, '')
      if (kw && !keywords.includes(kw)) {
        setKeywords([...keywords, kw])
      }
      setKeywordsInput('')
    }
  }

  const handleKeywordsBlur = () => {
    const kw = keywordsInput.trim().replace(/,+$/, '')
    if (kw && !keywords.includes(kw)) {
      setKeywords([...keywords, kw])
    }
    setKeywordsInput('')
  }

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      thesis,
      direction,
      conviction,
      timeframe: `through ${timeframeDate}`,
      affects_category: category,
      affects_keywords: keywords,
      p_implied: pImplied ? parseFloat(pImplied) / 100 : null,
      notes,
    })
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
  }

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: '500',
    color: '#94a3b8',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Thesis */}
      <div>
        <label style={labelStyle}>Thesis</label>
        <textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          required
          rows={3}
          placeholder="Describe your macro view thesis..."
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      {/* Direction */}
      <div>
        <label style={labelStyle}>Direction / Label</label>
        <input
          type="text"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          required
          placeholder="e.g., hawkish-on-fed, bullish-economy"
          style={inputStyle}
        />
      </div>

      {/* Conviction */}
      <div>
        <label style={labelStyle}>Conviction</label>
        <div className="flex gap-3">
          {CONVICTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setConviction(opt.value)}
              className="flex-1 py-2 rounded-lg border text-sm font-medium transition-all"
              style={{
                borderColor: conviction === opt.value ? opt.color : '#2a2a3e',
                backgroundColor: conviction === opt.value ? `${opt.color}20` : 'transparent',
                color: conviction === opt.value ? opt.color : '#64748b',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeframe + Category */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>Valid Through</label>
          <input
            type="date"
            value={timeframeDate}
            onChange={(e) => setTimeframeDate(e.target.value)}
            required
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
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat} style={{ backgroundColor: '#12121a' }}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Keywords */}
      <div>
        <label style={labelStyle}>Keywords (affects)</label>
        <input
          type="text"
          value={keywordsInput}
          onChange={(e) => setKeywordsInput(e.target.value)}
          onKeyDown={handleAddKeyword}
          onBlur={handleKeywordsBlur}
          placeholder="Type keyword and press Enter..."
          style={inputStyle}
        />
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded"
                style={{ backgroundColor: '#1e1e2e', color: '#a5b4fc' }}
              >
                {kw}
                <button
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  className="ml-0.5 hover:opacity-70"
                  style={{ color: '#64748b' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* P Implied */}
      <div>
        <label style={labelStyle}>
          Implied Probability for YES (%) — Optional
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="100"
            value={pImplied || '50'}
            onChange={(e) => setPImplied(e.target.value)}
            className="flex-1"
            style={{ accentColor: '#6366f1' }}
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              value={pImplied}
              onChange={(e) => setPImplied(e.target.value)}
              placeholder="—"
              style={{ ...inputStyle, width: '70px', textAlign: 'center' }}
            />
            <span style={{ color: '#64748b', fontSize: '14px' }}>%</span>
          </div>
        </div>
        <p className="text-xs mt-1" style={{ color: '#64748b' }}>
          Leave blank if you haven't quantified the probability
        </p>
      </div>

      {/* Notes */}
      <div>
        <label style={labelStyle}>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Additional context or reasoning..."
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors"
          style={{ borderColor: '#2a2a3e', color: '#94a3b8', backgroundColor: 'transparent' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{ backgroundColor: '#6366f1', color: '#ffffff' }}
        >
          {view ? 'Update View' : 'Save View'}
        </button>
      </div>
    </form>
  )
}
