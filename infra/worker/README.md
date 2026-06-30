# `dans-gaming-league-series` ingest-demo Cloudflare Worker

Receives MatchZy's demo POST after a map ends and streams the `.dem` straight to R2 at
`<matchId>/game.dem`, then fire-and-forgets a notify to the Next app's `/api/ingest/notify`. This
exists because Vercel Functions cap request bodies at 4.5 MB and a Wingman GOTV demo is far larger;
a Worker streams to R2 with no body limit. Phase 2 of `../../dathost_handoff/DATHOST_PHASE0_PLAN.md`.

**Status: DEPLOYED** (2026-06-29) via Cloudflare Workers Builds.
- Live URL: `https://dans-gaming-league-series.zgreenhalge.workers.dev`
- Worker name: **`dans-gaming-league-series`** (Workers Builds forces the Worker name to the project
  name; `wrangler.toml` `name` is set to match).

## How it's deployed — Cloudflare Workers Builds (Git, no local wrangler)

The Worker auto-deploys from this repo on push. Cloudflare dashboard → Workers & Pages → the Worker →
Settings → Builds:

| Setting | Value |
|---|---|
| Repository | `zgreenhalge/dans-gaming-league-series` |
| Build branch | the branch to deploy from (`main` after merge) |
| Root directory | `infra/worker` |
| Build command | `npm install` |
| **Deploy command** | **`npx wrangler deploy`** — NOT `npx wrangler versions upload` (that only uploads a preview version and never reaches production traffic) |

Two gotchas that cost us a few builds:
- **A `package-lock.json` is required** in `infra/worker/` — Workers Builds runs `npm ci`. Regenerate
  with `npm install --package-lock-only` if deps change.
- **`wrangler.toml` `name` must equal the Workers Builds project name** (`dans-gaming-league-series`),
  or the CI overrides it and warns.

## Secrets (set manually in the dashboard — never in the repo)

Worker → Settings → Variables and Secrets, type **Secret**:

| Secret | Pairs with |
|---|---|
| `UPLOAD_SECRET` | MatchZy sends it as `X-MatchZy-Token`; equals Vercel `INGEST_UPLOAD_SECRET` |
| `NOTIFY_SECRET` | equals the Next app's `INGEST_NOTIFY_SECRET` |

The R2 binding (`DEMOS` → `dgls-match-demos`) and `NOTIFY_URL` come from `wrangler.toml`.

## Vercel env (the matching half)

| Vercel env | Value |
|---|---|
| `INGEST_WORKER_URL` | `https://dans-gaming-league-series.zgreenhalge.workers.dev` |
| `INGEST_UPLOAD_SECRET` | same as the Worker's `UPLOAD_SECRET` |
| `INGEST_NOTIFY_SECRET` | same as the Worker's `NOTIFY_SECRET` |

These flow into each provisioned match's MatchZy config (demo-upload cvars) via `buildMatchzyConfig`,
closing the Phase 4 (hosting) ↔ Phase 2 (capture) link.

## Smoke test

```bash
# Unauthorized → 401
curl -i -X POST https://dans-gaming-league-series.zgreenhalge.workers.dev -H 'MatchZy-MatchId: 999'
# Authorized tiny upload → 200 {"ok":true,...}; writes a junk 999/game.dem (delete it after)
curl -i -X POST https://dans-gaming-league-series.zgreenhalge.workers.dev \
  -H "X-MatchZy-Token: <UPLOAD_SECRET>" -H 'MatchZy-MatchId: 999' -H 'MatchZy-MapNumber: 0' \
  --data-binary 'not-a-real-demo'
```

## Contract notes
- Auth header is checked constant-time **before** the body is read.
- `MatchZy-MapNumber > 0` is rejected (202) — DGLS is BO1; a multi-map config would overwrite the key.
- The Worker only **writes** the demo to R2; the Next route only ever **reads** it. Same deterministic
  key as the browser presigned-PUT path → last-write-wins, no collision.
