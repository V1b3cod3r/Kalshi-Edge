# Kalshi-Edge

Personal projects related to markets, trading, and information edges.

## Contents

| Path                | What it is                                                     |
| ------------------- | -------------------------------------------------------------- |
| `prompt.md`         | System prompt for a Kalshi trading agent.                      |
| `news-briefing/`    | Daily news briefing app (WSJ + FT + Economist) curated by Claude. See [`news-briefing/README.md`](./news-briefing/README.md). |

## Conventions

- Each self-contained project lives in its own top-level folder with its own `README.md`, `package.json` (or equivalent), and `.env.example`.
- The repo-level `.gitignore` covers Node, Next.js, env files, and editor cruft. Per-project ignores can be added inside each folder if needed.
- Secrets never get committed. Use `.env.local` (gitignored) locally and platform secret stores (e.g. Vercel env vars) in production.
