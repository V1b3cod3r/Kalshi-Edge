'use client'

import { useState, useEffect } from 'react'
import { MacroView } from '@/lib/types'
import ViewCard from '@/components/ViewCard'
import ViewForm from '@/components/ViewForm'
import { ToastNotification } from '@/components/SessionPanel'

interface Toast {
  message: string
  type: 'success' | 'error'
}

export default function ViewsPage() {
  const [views, setViews] = useState<MacroView[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingView, setEditingView] = useState<MacroView | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    loadViews()
  }, [])

  const loadViews = async () => {
    try {
      const res = await fetch('/api/views')
      const data = await res.json()
      setViews(data.views || [])
    } catch {
      setToast({ message: 'Failed to load views', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
  }

  const handleSave = async (viewData: Omit<MacroView, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      if (editingView) {
        const res = await fetch(`/api/views/${editingView.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(viewData),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setViews((prev) => prev.map((v) => (v.id === editingView.id ? data.view : v)))
        showToast('View updated', 'success')
      } else {
        const res = await fetch('/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(viewData),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setViews((prev) => [...prev, data.view])
        showToast('View created', 'success')
      }
      setShowForm(false)
      setEditingView(null)
    } catch (err: any) {
      showToast(err.message || 'Failed to save view', 'error')
    }
  }

  const handleEdit = (view: MacroView) => {
    setEditingView(view)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      setTimeout(() => setDeleteConfirm(null), 3000)
      return
    }
    try {
      const res = await fetch(`/api/views/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setViews((prev) => prev.filter((v) => v.id !== id))
      setDeleteConfirm(null)
      showToast('View deleted', 'success')
    } catch {
      showToast('Failed to delete view', 'error')
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingView(null)
  }

  const convictionOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
  const sortedViews = [...views].sort(
    (a, b) => convictionOrder[a.conviction] - convictionOrder[b.conviction]
  )

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: '#f1f5f9' }}>
            Macro Views
          </h1>
          <p className="text-sm" style={{ color: '#64748b' }}>
            {views.length} active view{views.length !== 1 ? 's' : ''} shaping your trading thesis
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => {
              setEditingView(null)
              setShowForm(true)
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: '#6366f1', color: '#fff' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add View
          </button>
        )}
      </div>

      {/* Form Modal Overlay */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: '#00000080' }}>
          <div
            className="w-full max-w-lg rounded-2xl border p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold" style={{ color: '#f1f5f9' }}>
                {editingView ? 'Edit View' : 'New Macro View'}
              </h2>
              <button
                onClick={handleCancel}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: '#64748b' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1e1e2e' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                ×
              </button>
            </div>
            <ViewForm view={editingView} onSave={handleSave} onCancel={handleCancel} />
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl border p-5 h-48 shimmer"
              style={{ borderColor: '#1e1e2e' }}
            />
          ))}
        </div>
      ) : views.length === 0 ? (
        <div
          className="rounded-2xl border p-16 text-center"
          style={{ backgroundColor: '#12121a', borderColor: '#1e1e2e' }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#1e1e2e' }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: '#f1f5f9' }}>
            No macro views yet
          </h3>
          <p className="text-sm mb-6 max-w-sm mx-auto" style={{ color: '#64748b' }}>
            Macro views allow the AI to incorporate your market thesis when analyzing and sizing positions.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-2.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#6366f1', color: '#fff' }}
          >
            Add Your First View
          </button>
        </div>
      ) : (
        <div>
          {/* Conviction groups */}
          {(['HIGH', 'MEDIUM', 'LOW'] as const).map((conviction) => {
            const group = sortedViews.filter((v) => v.conviction === conviction)
            if (group.length === 0) return null
            const labelColors = {
              HIGH: '#22c55e',
              MEDIUM: '#eab308',
              LOW: '#64748b',
            }
            return (
              <div key={conviction} className="mb-8">
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="text-xs font-bold uppercase tracking-widest"
                    style={{ color: labelColors[conviction] }}
                  >
                    {conviction} Conviction
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: '#1e1e2e' }} />
                  <span className="text-xs" style={{ color: '#64748b' }}>
                    {group.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.map((view) => (
                    <div key={view.id} className="relative">
                      {deleteConfirm === view.id && (
                        <div
                          className="absolute inset-0 z-10 rounded-xl flex items-center justify-center"
                          style={{ backgroundColor: '#12121a', border: '1px solid #ef444440' }}
                        >
                          <div className="text-center p-4">
                            <p className="text-sm mb-3" style={{ color: '#f1f5f9' }}>
                              Delete this view?
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="flex-1 py-1.5 text-xs rounded border"
                                style={{ borderColor: '#2a2a3e', color: '#94a3b8' }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDelete(view.id)}
                                className="flex-1 py-1.5 text-xs rounded"
                                style={{ backgroundColor: '#ef4444', color: '#fff' }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      <ViewCard
                        view={view}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <ToastNotification
          toast={toast}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
