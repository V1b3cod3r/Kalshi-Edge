import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'kalshi-test-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const viewPayload = {
  thesis: 'Fed will cut rates',
  direction: 'DOVISH',
  conviction: 'HIGH' as const,
  timeframe: 'through 2025-12-31',
  affects_category: 'Economics/Finance',
  affects_keywords: ['fed', 'rate'],
  p_implied: 0.7,
  notes: 'Strong signal',
}

function makeRequest(method: string, url: string, body?: object): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/views', () => {
  it('returns empty views array initially', async () => {
    const { GET } = await import('@/app/api/views/route')

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.views).toEqual([])
  })
})

describe('POST /api/views', () => {
  it('creates a view and returns 201 with the new view', async () => {
    const { POST } = await import('@/app/api/views/route')

    const req = makeRequest('POST', 'http://localhost/api/views', viewPayload)
    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.view.thesis).toBe('Fed will cut rates')
    expect(data.view.id).toBeTruthy()
    expect(data.view.created_at).toBeTruthy()
  })

  it('persists view so GET returns it afterwards', async () => {
    const { POST, GET } = await import('@/app/api/views/route')

    const req = makeRequest('POST', 'http://localhost/api/views', viewPayload)
    await POST(req)

    const res = await GET()
    const data = await res.json()

    expect(data.views).toHaveLength(1)
    expect(data.views[0].thesis).toBe('Fed will cut rates')
  })
})

describe('GET /api/views/[id]', () => {
  it('returns a view by id', async () => {
    const { POST } = await import('@/app/api/views/route')
    const createRes = await POST(makeRequest('POST', 'http://localhost/api/views', viewPayload))
    const { view } = await createRes.json()

    vi.resetModules()
    const { GET } = await import('@/app/api/views/[id]/route')

    const req = makeRequest('GET', `http://localhost/api/views/${view.id}`)
    const res = await GET(req, { params: { id: view.id } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.view.id).toBe(view.id)
  })

  it('returns 404 for unknown id', async () => {
    const { GET } = await import('@/app/api/views/[id]/route')

    const req = makeRequest('GET', 'http://localhost/api/views/ghost-id')
    const res = await GET(req, { params: { id: 'ghost-id' } })

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/views/[id]', () => {
  it('updates a view field', async () => {
    const { POST } = await import('@/app/api/views/route')
    const createRes = await POST(makeRequest('POST', 'http://localhost/api/views', viewPayload))
    const { view } = await createRes.json()

    vi.resetModules()
    const { PUT } = await import('@/app/api/views/[id]/route')

    const req = makeRequest('PUT', `http://localhost/api/views/${view.id}`, {
      conviction: 'LOW',
      notes: 'revised',
    })
    const res = await PUT(req, { params: { id: view.id } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.view.conviction).toBe('LOW')
    expect(data.view.notes).toBe('revised')
    expect(data.view.thesis).toBe('Fed will cut rates') // unchanged
  })

  it('returns 404 for unknown id', async () => {
    const { PUT } = await import('@/app/api/views/[id]/route')

    const req = makeRequest('PUT', 'http://localhost/api/views/ghost', { notes: 'x' })
    const res = await PUT(req, { params: { id: 'ghost' } })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/views/[id]', () => {
  it('deletes a view and returns success', async () => {
    const { POST } = await import('@/app/api/views/route')
    const createRes = await POST(makeRequest('POST', 'http://localhost/api/views', viewPayload))
    const { view } = await createRes.json()

    vi.resetModules()
    const { DELETE } = await import('@/app/api/views/[id]/route')

    const req = makeRequest('DELETE', `http://localhost/api/views/${view.id}`)
    const res = await DELETE(req, { params: { id: view.id } })
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)

    // Verify it's gone
    vi.resetModules()
    const { GET } = await import('@/app/api/views/route')
    const listRes = await GET()
    const listData = await listRes.json()
    expect(listData.views).toHaveLength(0)
  })
})
