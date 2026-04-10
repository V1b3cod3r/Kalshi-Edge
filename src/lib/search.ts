/**
 * Web context fetcher for market analysis
 *
 * Sources:
 * - Google News RSS (free, no key) — recent headlines for any query
 * - Tavily AI Search (free tier: 1000/month) — deeper search with AI summary
 * - Polymarket (free public API) — cross-market price reference
 *
 * All sources are best-effort: failures are silent and never block analysis.
 */

export interface NewsItem {
  title: string
  snippet: string
  published: string
  source: string
}

export interface PolymarketRef {
  question: string
  yesPrice: number   // cents (1–99)
  noPrice: number
  volume: string     // e.g. "$240k"
}

export interface WebContext {
  query: string
  news: NewsItem[]
  tavilyAnswer?: string
  polymarket?: PolymarketRef[]
}

const TIMEOUT_MS = 8000

async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res.ok ? res : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Google News RSS ──────────────────────────────────────────────────────────

export async function searchGoogleNews(query: string, maxItems = 6): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  const res = await fetchWithTimeout(url)
  if (!res) return []

  const xml = await res.text()
  const items: NewsItem[] = []

  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []

  for (const item of itemMatches.slice(0, maxItems)) {
    // Title: either CDATA or plain
    const titleRaw =
      item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s)?.[1] ??
      item.match(/<title>(.*?)<\/title>/s)?.[1] ?? ''

    // Google News appends " - Source Name" at the end
    const dashIdx = titleRaw.lastIndexOf(' - ')
    const title = dashIdx > 0 ? titleRaw.slice(0, dashIdx).trim() : titleRaw.trim()
    const source = dashIdx > 0 ? titleRaw.slice(dashIdx + 3).trim() : ''

    const dateRaw = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? ''
    const published = dateRaw
      ? new Date(dateRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : ''

    const descRaw =
      item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ??
      item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ''
    // Strip HTML tags and decode basic entities
    const snippet = descRaw
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)

    if (title) items.push({ title, snippet, published, source })
  }

  return items
}

// ── Tavily AI Search ─────────────────────────────────────────────────────────

export async function searchTavily(
  query: string,
  apiKey: string,
  maxResults = 5,
): Promise<WebContext> {
  const res = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: true,
    }),
  })

  if (!res) return { query, news: [] }

  const data = await res.json().catch(() => null)
  if (!data) return { query, news: [] }

  const news: NewsItem[] = (data.results ?? []).map((r: any) => ({
    title: r.title ?? '',
    snippet: (r.content ?? '').slice(0, 300),
    published: r.published_date
      ? new Date(r.published_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '',
    source: (() => {
      try { return new URL(r.url).hostname.replace('www.', '') }
      catch { return '' }
    })(),
  })).filter((n: NewsItem) => n.title)

  return {
    query,
    news,
    tavilyAnswer: data.answer ?? undefined,
  }
}

// ── Polymarket cross-reference ───────────────────────────────────────────────

export async function searchPolymarket(query: string, maxResults = 2): Promise<PolymarketRef[]> {
  const url = `https://gamma-api.polymarket.com/markets?search=${encodeURIComponent(query)}&limit=5&active=true&closed=false`
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res) return []

  const data = await res.json().catch(() => null)
  if (!data) return []

  const markets: any[] = Array.isArray(data) ? data : (data.data ?? data.markets ?? [])
  const refs: PolymarketRef[] = []

  for (const m of markets) {
    if (!m.question || !m.outcomePrices) continue
    let prices: string[]
    try {
      prices = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices)
    } catch {
      continue
    }
    if (prices.length < 2) continue
    const yes = Math.round(parseFloat(prices[0]) * 100)
    const no = Math.round(parseFloat(prices[1]) * 100)
    if (yes <= 0 || yes >= 100) continue  // skip unpriced/resolved markets

    const volNum = Number(m.volume ?? 0)
    const volume = volNum >= 1000 ? `$${(volNum / 1000).toFixed(0)}k` : volNum > 0 ? `$${volNum.toFixed(0)}` : ''

    refs.push({ question: m.question, yesPrice: yes, noPrice: no, volume })
    if (refs.length >= maxResults) break
  }

  return refs
}

// ── Combined context fetcher ─────────────────────────────────────────────────

/**
 * Fetch web context for a single market.
 * Always runs Google News + Polymarket; runs Tavily only if apiKey provided.
 */
export async function getMarketWebContext(
  marketTitle: string,
  tavilyApiKey?: string,
): Promise<WebContext> {
  // Trim query to ~100 chars — news APIs work best with concise queries
  const query = marketTitle.replace(/^Will /, '').replace(/\?$/, '').trim().slice(0, 120)

  const [googleNews, tavilyResult, polymarket] = await Promise.all([
    searchGoogleNews(query, 6),
    tavilyApiKey ? searchTavily(query, tavilyApiKey, 5) : Promise.resolve({ query, news: [] as NewsItem[] }),
    searchPolymarket(query, 2),
  ])

  // Merge: Tavily first (higher quality), then Google News to fill remaining slots
  const seen = new Set<string>()
  const merged: NewsItem[] = []
  for (const item of [...tavilyResult.news, ...googleNews]) {
    const key = item.title.toLowerCase().slice(0, 60)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(item)
    }
    if (merged.length >= 8) break
  }

  return {
    query,
    news: merged,
    tavilyAnswer: (tavilyResult as WebContext).tavilyAnswer,
    polymarket: polymarket.length > 0 ? polymarket : undefined,
  }
}

/**
 * Fetch web context for a batch of markets, grouped by series to minimise API calls.
 * One search per unique series (using the first market's title as the query).
 */
export async function getWebContextForMarkets(
  markets: Array<{ id?: string; title: string }>,
  tavilyApiKey?: string,
): Promise<Map<string, WebContext>> {
  // Group by series prefix (e.g. KXCPI-25APR-T3 → KXCPI)
  const seriesMap = new Map<string, { representativeTitle: string; tickers: string[] }>()

  for (const m of markets) {
    const ticker = m.id ?? ''
    const series = ticker.split('-')[0] || ticker
    if (!seriesMap.has(series)) {
      seriesMap.set(series, { representativeTitle: m.title, tickers: [] })
    }
    seriesMap.get(series)!.tickers.push(ticker)
  }

  const results = new Map<string, WebContext>()

  await Promise.all(
    Array.from(seriesMap.entries()).map(async ([, { representativeTitle, tickers }]) => {
      const ctx = await getMarketWebContext(representativeTitle, tavilyApiKey)
      for (const ticker of tickers) {
        results.set(ticker, ctx)
      }
    })
  )

  return results
}

// ── Prompt formatter ─────────────────────────────────────────────────────────

export function formatWebContext(ctx: WebContext): string {
  if (ctx.news.length === 0 && !ctx.tavilyAnswer && !ctx.polymarket?.length) return ''

  const lines: string[] = [`Web context (query: "${ctx.query}"):`]

  if (ctx.tavilyAnswer) {
    lines.push(`  AI summary: ${ctx.tavilyAnswer}`)
  }

  if (ctx.polymarket && ctx.polymarket.length > 0) {
    lines.push(`  Polymarket (cross-market reference):`)
    for (const p of ctx.polymarket) {
      const vol = p.volume ? ` · vol ${p.volume}` : ''
      lines.push(`    • "${p.question}" — YES ${p.yesPrice}¢ / NO ${p.noPrice}¢${vol}`)
    }
  }

  for (const item of ctx.news) {
    const date = item.published ? `[${item.published}]` : ''
    const src = item.source ? `(${item.source})` : ''
    lines.push(`  • ${date} ${item.title} ${src}`.trim())
    if (item.snippet && item.snippet !== item.title) {
      lines.push(`    ${item.snippet}`)
    }
  }

  return lines.join('\n')
}
