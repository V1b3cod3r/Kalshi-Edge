# Briefing

A daily news briefing curated from WSJ, FT, and The Economist, summarized by Claude based on your interests.

- **Stack**: Next.js 15 (App Router) + Tailwind + TypeScript
- **Content**: Public RSS feeds (no scraping, no logins)
- **AI**: Anthropic Claude (Haiku 4.5 for both scoring and summaries by default)
- **Hosting**: Vercel free tier
- **Auth**: Single shared password
- **Cost**: ~$0.015 per fresh pull, ~$0.50/month at one daily briefing. Swap `SUMMARY_MODEL` in `src/lib/claude.ts` to `claude-sonnet-4-6` for richer prose at ~3x cost.

---

## How it works

1. **Fetch** RSS feeds from WSJ, FT, Economist (cached 30 min, free)
2. **Pre-filter** with keyword matching against your interests (free)
3. **Score** the top ~40 candidates with one Haiku 4.5 call (~$0.005)
4. **Summarize** the top 15 with one Haiku 4.5 call (~$0.010)
5. **Cache** the result for the day, keyed by date + interests hash, so refreshing costs nothing

Total: two LLM calls per fresh pull. The refresh button bypasses the cache; otherwise refreshes the same day are free.

---

## Local development

```bash
cd news-briefing
npm install
cp .env.example .env.local
# Edit .env.local — fill in ANTHROPIC_API_KEY, APP_PASSWORD, AUTH_SECRET
npm run dev
```

Open <http://localhost:3000>. Log in with `APP_PASSWORD`.

## Verifying RSS feeds

If a source isn't showing up, run the feed diagnostic to see exactly which URLs return content and which are blocked, dormant, or rejecting your User-Agent:

```bash
npm run test-feeds
```

This prints a table per feed: HTTP status, total items in the XML, items inside the recency window, and the age of the newest article. Drop dead URLs from `src/lib/sources.ts`.

Generate a strong `AUTH_SECRET` with:

```bash
openssl rand -hex 32
```

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. Go to <https://vercel.com/new> and import the repo.
3. Set the **Root Directory** to `news-briefing`.
4. Add three environment variables in Vercel:
   - `ANTHROPIC_API_KEY`
   - `APP_PASSWORD`
   - `AUTH_SECRET`
5. Deploy. Visit the URL Vercel gives you, log in, and the briefing renders on first visit.

---

## Project layout

```
news-briefing/
├── src/
│   ├── app/                  # Next.js App Router pages
│   │   ├── page.tsx          # Briefing (home)
│   │   ├── settings/page.tsx # Manage interests, sign out
│   │   ├── login/page.tsx    # Password gate
│   │   └── api/              # Briefing, login, logout endpoints
│   ├── components/           # ArticleCard, Header, SourceBadge, Skeleton
│   ├── lib/                  # rss, prefilter, claude, briefing, cache, auth
│   └── middleware.ts         # Cookie-based password gate
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

Configuration files (`next.config.ts`, `postcss.config.mjs`) live alongside.

---

## Editing your interests

Click the gear icon in the header. Interests are stored in your browser's `localStorage` and sent with each briefing request. Changing them invalidates the day's cache only for that interest set.

---

## Cost guardrails

- All RSS calls cache for 30 min via `next: { revalidate: 1800 }`.
- The full briefing pipeline is wrapped in `unstable_cache` keyed by date + interests hash.
- The Anthropic SDK retries 429s and 5xxs with backoff by default.
- The system prompts use `cache_control: { type: "ephemeral" }`, so re-running with the same prompts on the same day is mostly cache reads (~10% of full price).

If you want a hard cost cap, set a monthly budget alert in the Anthropic console.
