# `ingest-demo` Cloudflare Worker

Receives MatchZy's demo POST after a map ends and streams the `.dem` straight to R2 at
`<matchId>/game.dem`, then fire-and-forgets a notify to the Next app's `/api/ingest/notify`. This
exists because Vercel Functions cap request bodies at 4.5 MB and a Wingman GOTV demo is far larger;
a Worker streams to R2 with no body limit. Phase 2 of `../../dathost_handoff/DATHOST_PHASE0_PLAN.md`.

**Status: code-complete, NOT yet deployed.** Deploy is gated on Cloudflare/wrangler access (no
wrangler installed locally yet, R2-binding reachability unconfirmed — handoff §6). Until deployed,
the manual download → presigned-PUT upload path remains the fallback and fully covers the Phase-0
parser gate.

## One-time setup

```bash
npm i -g wrangler        # or use `npx wrangler ...`
wrangler login           # interactive — run via `! wrangler login` in the Claude session
```

Edit `wrangler.toml`:
- `bucket_name` → the value of `CLOUDFLARE_R2_BUCKET_NAME` (the existing demos bucket).
- `NOTIFY_URL` → `https://<prod-domain>/api/ingest/notify`.

Set the two secrets (not stored in the repo):
```bash
cd infra/worker
wrangler secret put UPLOAD_SECRET    # MatchZy sends this as the X-MatchZy-Token header
wrangler secret put NOTIFY_SECRET    # must equal the Next app's INGEST_NOTIFY_SECRET
```

On the Next/Vercel side, add `INGEST_NOTIFY_SECRET` (same value as the Worker's `NOTIFY_SECRET`).

## Deploy / verify

```bash
cd infra/worker
wrangler deploy
# smoke test (expect 401 without the secret):
curl -i -X POST https://ingest-demo.<subdomain>.workers.dev -H 'MatchZy-MatchId: 33'
# with a real demo + secret (writes to R2 — use a throwaway matchId):
curl -i -X POST https://ingest-demo.<subdomain>.workers.dev \
  -H "X-MatchZy-Token: $UPLOAD_SECRET" -H 'MatchZy-MatchId: 999' -H 'MatchZy-MapNumber: 0' \
  --data-binary @game.dem
```

## MatchZy per-match config

```
matchzy_demo_upload_url            https://ingest-demo.<subdomain>.workers.dev
matchzy_demo_upload_header_key     X-MatchZy-Token
matchzy_demo_upload_header_value   <UPLOAD_SECRET>
```
…and `matchid` = the DGLS `match_id` so the demo self-labels via `MatchZy-MatchId`.

## Contract notes
- Auth header is checked constant-time **before** the body is read.
- `MatchZy-MapNumber > 0` is rejected (202) — DGLS is BO1; a multi-map config would overwrite the key.
- The Worker only **writes** the demo to R2; the Next route only ever **reads** it. Same deterministic
  key as the browser presigned-PUT path → last-write-wins, no collision.
