import { NextResponse } from 'next/server'

// Unauthenticated liveness check — Railway's healthcheckPath (railway.toml)
// hits this before any Basic Auth credential could be supplied. Deliberately
// returns nothing but a 200; no settings, keys, or app state.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true })
}
