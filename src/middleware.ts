import { NextRequest, NextResponse } from 'next/server'

// Basic Auth gate for the whole app. This is a single-user tool that holds
// live Kalshi trading credentials and exposes a REST API (PUT /api/settings,
// POST /api/autopilot/run, POST /api/trade) with no auth of its own —
// deployed publicly (see railway.toml) anyone with the URL could flip
// dry_run off, raise spend limits, or place real orders. Basic Auth requires
// zero client-side code changes: browsers cache the Authorization header
// per-origin after the first prompt, so every existing same-origin fetch()
// call keeps working unmodified.
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER
  const pass = process.env.BASIC_AUTH_PASS

  // Unconfigured = no gate, matching the pre-existing (open) behavior — so
  // local dev never breaks. Set both env vars before deploying anywhere
  // public.
  if (!user || !pass) return NextResponse.next()

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8')
    const sepIdx = decoded.indexOf(':')
    const suppliedUser = sepIdx === -1 ? decoded : decoded.slice(0, sepIdx)
    const suppliedPass = sepIdx === -1 ? '' : decoded.slice(sepIdx + 1)
    if (suppliedUser === user && suppliedPass === pass) {
      return NextResponse.next()
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="kalshi-edge"' },
  })
}

export const config = {
  // Everything except static assets and the unauthenticated health check
  // Railway's healthcheckPath (railway.toml) hits before any browser session exists.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
}
