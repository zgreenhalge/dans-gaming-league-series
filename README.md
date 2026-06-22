# Dan's Gaming League Series

A stat tracker for DGLS — a **CS2 Wingman league** played in the Individual Rotating Mixer format. Because teammates rotate randomly every week, standard win/loss records are misleading. This platform surfaces individual skill through rate-based metrics, primarily **ADR (Average Damage per Round)**.

## Documentation

Full reference docs live in [`docs/`](./docs/). Start with [`docs/README.md`](./docs/README.md) for the index. Highlights:

- [`docs/glossary.md`](./docs/glossary.md) — DGLS domain terms + a map of where each concept lives in the code (read this first)
- [`docs/patterns.md`](./docs/patterns.md) — cross-cutting conventions every change should follow
- [`docs/recipes.md`](./docs/recipes.md) — step-by-step patterns for common changes
- [`docs/architecture.md`](./docs/architecture.md) — routes, auth, mutation API, database schema, deployment
- [`docs/calculations.md`](./docs/calculations.md) — the formulas behind every stat and ranking
- [`docs/visual-conventions.md`](./docs/visual-conventions.md) — the shared hover/glow/accent CSS system
- [`docs/ehog.md`](./docs/ehog.md) — the EHOG player skill rating engine
- [`docs/demo-ingestion.md`](./docs/demo-ingestion.md) — the CS2 demo upload → parse → stats pipeline

## Tech Stack

- **Frontend:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Backend/Database:** Supabase (PostgreSQL, REST API, DB views)
- **Auth:** NextAuth.js with Steam OpenID
- **Deployment:** Vercel (frontend + a Python function for the EHOG recompute) + Supabase cloud (DB)

## Getting Started

```bash
npm install
npm run dev   # http://localhost:3000
```

Other useful commands:

```bash
npm run build   # production build (also type-checks)
npm run lint    # ESLint
```

**Development shortcut:** When `NODE_ENV=development`, two mock login buttons appear (`Dev: Zach` / `Dev: Dan`) that skip Steam auth entirely and sign you in as a known player. You do not need `STEAM_API_KEY` or `NEXTAUTH_URL` for local dev if you use these.

## Environment Variables

Create `.env.local` at the repo root:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser-safe, read-only in practice) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — used by server-side API routes only, never sent to the client |
| `NEXTAUTH_URL` | Full base URL, e.g. `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Secret for signing session tokens (any random string locally) |
| `STEAM_API_KEY` | Steam Web API key — fetches player avatars/nicknames |
| `CRON_SECRET` | Bearer token checked by the Vercel cron endpoint |
| `CLOUDFLARE_R2_ACCOUNT_ID` | Cloudflare R2 account ID (demo uploads) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Cloudflare R2 access key (demo uploads) |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key (demo uploads) |
| `CLOUDFLARE_R2_BUCKET_NAME` | Cloudflare R2 bucket for uploaded `.dem` files |
| `GITHUB_DISPATCH_TOKEN` | Fine-grained PAT (Actions: write) to dispatch the replay GitHub Actions jobs — see [`docs/replay.md`](./docs/replay.md) |
| `GITHUB_REPO` | `owner/name` of the repo whose Actions to dispatch (e.g. `zgreenhalge/dans-gaming-league-series`) |

For the route table, schema, API endpoints, and deployment details, see [`docs/architecture.md`](./docs/architecture.md). For the Python ingestion pipeline, see [`ingestion/README.md`](./ingestion/README.md).
