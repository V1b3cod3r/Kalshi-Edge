'use client'

import { MacroView } from '@/lib/types'

interface ViewCardProps {
  view: MacroView
  onEdit: (view: MacroView) => void
  onDelete: (id: string) => void
}

function ConvictionBadge({ conviction }: { conviction: 'LOW' | 'MEDIUM' | 'HIGH' }) {
  const styles = {
    LOW: { bg: '#1e1e2e', color: '#64748b', border: '#2a2a3e' },
    MEDIUM: { bg: '#2d2510', color: '#eab308', border: '#3d3215' },
    HIGH: { bg: '#0d2210', color: '#22c55e', border: '#163420' },
  }
  const s = styles[conviction]
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full border"
      style={{ backgroundColor: s.bg, color: s.color, borderColor: s.border }}
    >
      {conviction}
    </span>
  )
}

export default function ViewCard({ view, onEdit, onDelete }: ViewCardProps) {
  const timeframeDate = view.timeframe.replace('through ', '').replace('Through ', '')

  return (
    <div
      className="rounded-xl p-5 border flex flex-col gap-3 hover:border-opacity-80 transition-all"
      style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: '#f1f5f9' }}>
            {view.thesis}
          </p>
        </div>
        <ConvictionBadge conviction={view.conviction} />
      </div>

      {/* Direction + Category */}
      <div className="flex items-center gap-2 text-xs" style={{ color: '#94a3b8' }}>
        <span
          className="px-2 py-0.5 rounded"
          style={{ backgroundColor: '#1a1a28', color: '#a5b4fc' }}
        >
          {view.direction}
        </span>
        <span style={{ color: '#64748b' }}>·</span>
        <span>{view.affects_category}</span>
      </div>

      {/* Keywords */}
      {view.affects_keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {view.affects_keywords.slice(0, 5).map((kw) => (
            <span
              key={kw}
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: '#1e1e2e', color: '#64748b' }}
            >
              {kw}
            </span>
          ))}
          {view.affects_keywords.length > 5 && (
            <span className="text-xs" style={{ color: '#64748b' }}>
              +{view.affects_keywords.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 mt-auto">
        <div className="flex items-center gap-3 text-xs" style={{ color: '#64748b' }}>
          <span>Through {timeframeDate}</span>
          {view.p_implied !== null && (
            <>
              <span>·</span>
              <span style={{ color: '#a5b4fc' }}>
                p_implied: {Math.round(view.p_implied * 100)}%
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(view)}
            className="text-xs px-2.5 py-1 rounded border transition-colors"
            style={{ borderColor: '#2a2a3e', color: '#94a3b8', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#6366f1'
              e.currentTarget.style.color = '#a5b4fc'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#2a2a3e'
              e.currentTarget.style.color = '#94a3b8'
            }}
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(view.id)}
            className="text-xs px-2.5 py-1 rounded border transition-colors"
            style={{ borderColor: '#2a2a3e', color: '#94a3b8', backgroundColor: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#ef4444'
              e.currentTarget.style.color = '#ef4444'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#2a2a3e'
              e.currentTarget.style.color = '#94a3b8'
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
