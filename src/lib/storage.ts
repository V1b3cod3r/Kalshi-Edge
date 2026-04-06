import fs from 'fs'
import path from 'path'
import { MacroView, SessionState, AppSettings } from './types'

const DATA_DIR = path.join(process.cwd(), 'data')

const VIEWS_FILE = path.join(DATA_DIR, 'views.json')
const SESSION_FILE = path.join(DATA_DIR, 'session.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

const DEFAULT_SESSION: SessionState = {
  current_bankroll: 10000,
  starting_bankroll: 10000,
  positions: [],
  corr_groups: {},
  recent_win_rate: 0.58,
  kelly_modifier: 1.0,
  avoid_categories: [],
  max_new_positions: 5,
}

const DEFAULT_SETTINGS: AppSettings = {
  anthropic_api_key: '',
  kalshi_api_key: '',
  min_edge_threshold: 0.03,
  max_position_pct: 0.05,
  max_corr_exposure_pct: 0.15,
  default_kelly_fraction: 'medium',
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readJson<T>(filePath: string, defaultValue: T): T {
  ensureDataDir()
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2))
    return defaultValue
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return defaultValue
  }
}

function writeJson<T>(filePath: string, data: T): void {
  ensureDataDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// Views CRUD
export function getViews(): MacroView[] {
  return readJson<MacroView[]>(VIEWS_FILE, [])
}

export function saveViews(views: MacroView[]): void {
  writeJson(VIEWS_FILE, views)
}

export function getView(id: string): MacroView | null {
  const views = getViews()
  return views.find((v) => v.id === id) || null
}

export function createView(
  view: Omit<MacroView, 'id' | 'created_at' | 'updated_at'>
): MacroView {
  const views = getViews()
  const now = new Date().toISOString()
  const newView: MacroView = {
    ...view,
    id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: now,
    updated_at: now,
  }
  views.push(newView)
  saveViews(views)
  return newView
}

export function updateView(id: string, updates: Partial<MacroView>): MacroView {
  const views = getViews()
  const idx = views.findIndex((v) => v.id === id)
  if (idx === -1) throw new Error(`View ${id} not found`)
  const updated: MacroView = {
    ...views[idx],
    ...updates,
    id, // ensure id can't be changed
    updated_at: new Date().toISOString(),
  }
  views[idx] = updated
  saveViews(views)
  return updated
}

export function deleteView(id: string): void {
  const views = getViews()
  const filtered = views.filter((v) => v.id !== id)
  saveViews(filtered)
}

// Session
export function getSession(): SessionState {
  return readJson<SessionState>(SESSION_FILE, DEFAULT_SESSION)
}

export function saveSession(session: SessionState): void {
  writeJson(SESSION_FILE, session)
}

// Settings
export function getSettings(): AppSettings {
  return readJson<AppSettings>(SETTINGS_FILE, DEFAULT_SETTINGS)
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_FILE, settings)
}
