# DatHost + MatchZy hosting & auto-ingestion

How DGLS provisions a CS2 server per match, runs MatchZy on it, and flows the resulting GOTV demo
back into match stats automatically. This is the "hands-off" path; the manual upload → parse →
confirm flow ([`demo-ingestion.md`](./demo-ingestion.md)) always remains as the failsafe. For
general DatHost/MatchZy/CounterStrikeSharp knowledge — best practices, gotchas, external docs — not
specific to DGLS's own implementation, see [`cs2-stack-reference.md`](./cs2-stack-reference.md).

> The original design/rollout notes lived in a local `dathost_handoff/` scratch dir (gitignored).
> This doc is the tracked record — update it here, not there.

## The reuse model

DGLS reuses **one persistent DatHost server** for every match — teardown is `stop`, never `delete`.
A `stop`→`start` gives a fresh CS2 process each match (which fixed the Season-2 long-uptime
instability) with zero orphan-billing risk. The tradeoff: **no concurrent matches** — the single
server is a shared resource, which the concurrency guard and scheduling warning below make safe and
visible. (Overflow concurrency, if ever needed, is the documented `duplicate`/`delete` clone
fallback — not the per-match path.)

Because the server is reconfigured for recreational modes between matches, **provisioning must
re-assert the full golden `cs2_settings` before every launch** (`applyGoldenSettings`). Map
selection is always pinned to a single workshop map per match — `workshop_collection` mode doesn't
behave reliably on this server, so `applyGoldenSettings` throws if a match's map isn't resolved yet
rather than falling back to it. See [`infra/matchzy/README.md`](../infra/matchzy/README.md) for the
full golden-config layout and the diff/apply tooling that keeps it in sync with the live server.

## Server-state machine

Persisted on the `matches` row:

| Column | Meaning |
|---|---|
| `server_state` | `idle → provisioning → live → tearing_down → done` (or `failed`) |
| `dathost_server_id` | the DatHost server this match claimed (always the one shared id today) |
| `connect_string` | `ip:port` for the join/`connect` link, set when `live`, cleared on teardown |
| `server_started_at` | when provisioning began (drives the panel's progress estimate) |

Orchestration lives in **`src/lib/dathost-lifecycle.ts`** over the typed client in
**`src/lib/dathost.ts`** (DatHost REST `/api/0.1`, HTTP Basic auth):

- **`provisionMatchServer`** — `findServerOccupant` guard → `provisioning` → `applyGoldenSettings`
  (golden `cs2_settings` + the picked workshop map) → `pushCfgFiles` (reassert the versioned
  `infra/matchzy/cfg/**` before boot, since cfg files are `exec`'d at boot / go-live) → `startServer`
  → `waitUntilReady` (`on && !booting` + connectable) → `loadMatch` (`matchzy_loadmatch_url`) → `live`
  + `connect_string`. Marks `failed` and rethrows on any error. A per-file cfg-push failure is logged,
  not fatal.
- **`teardownMatchServer`** — `stop` (never delete) → `done`. `onlyIfOwnsServer` no-ops unless this
  match is the current occupant, so tearing down one match never stops another's server. Every real
  teardown also flags a missing demo (#228, below).
- **`getReconciledServerState`** — reconciles a stale `live` against reality (see below).

### Reconciliation (#135)

After a match ends the shared server auto-stops (`autostop`, 10-min idle) while the row can stay
`live` — the panel would keep offering a dead connect link. `getReconciledServerState` (used by the
status route) downgrades `live → done` when DatHost reports the server stopped. It is **read-only
reconcile** (fires when the match page is viewed), **downgrade-only** (a running server is left
alone), and best-effort (a DatHost/DB error returns the DB value). The common path doesn't rely on
it: teardown fires eagerly on demo receipt and on score write.

### Concurrency guard (#134)

All matches share one server, and provisioning is automatic on veto completion, so two matches
finishing pick/ban close together would both grab it. `findServerOccupant` + `ServerBusyError` refuse
to provision when another match holds the server; the provision route returns a **409**
(`code: 'server_busy'`) and the panel shows a "busy, retry" message. The check is done before a match
claims the server (so a refusal never marks *it* failed). There is a tiny check-then-claim window
(two vetos completing within the same DB round-trip); accepted, since veto completions are seconds+
apart in practice and this turns a silent mid-game clobber into a clean refusal.

A **soft scheduling warning** (`src/lib/schedule.ts`) flags — on the match page and in the admin
match console (both render the shared `ScheduleEditor` over `useScheduleEditor`) — when two matches
are scheduled **strictly under an hour** apart (they'd contend for the one server); it links the
conflicting match and never blocks scheduling.

## Auto-ingestion pipeline

```
MatchZy (map ends) ──POST .dem──▶ Cloudflare Worker ──▶ R2 (demoKey)  +  POST /api/ingest/notify
MatchZy (map_result event)   ──POST /api/ingest/matchzy-log──▶ R2 (mapResultKey)  [independent oracle]
                                                                              │
   background_jobs(demo_ingest): received → queued ──dispatch──▶ demo-ingest.yml (GitHub Action)
                                                                              │
              scripts/demo-ingest.ts: parse + quarantine + D5 predicate check
                                          │                              │
                            predicate passes, AUTO_COMMIT_ENABLED  predicate fails / shadow mode
                            writeMatchScore()  status: confirmed        R2 (demoResultKey)  status: parsed | quarantined
                                                                              │
                                          in-match MatchDemoReviewBlock  ──admin Confirm──▶ PATCH /score  (confirmed)
                                                                              │  or Dismiss (dismissed)
   admin /admin/jobs              ── dashboard of every background job + warnings/quarantine flags ─┘
```

- The Worker writes the **same** deterministic `demoKey(matchId)` a browser upload would, so the two
  paths are last-write-wins with no collision.
- `/api/ingest/notify` (machine-auth `x-ingest-secret`) validates the match + roster + demo, records
  `received`, dispatches the Action, and **tears down the server** (demo landed = match over) — the
  Action never touches DatHost regardless of auto-commit or manual confirm.
- `/api/ingest/matchzy-log` (machine-auth `x-matchzy-token`) is the `matchzy_remote_log_url` target.
  MatchZy POSTs every match event here; only `map_result` is kept (at `mapResultKey`), everything else
  is acknowledged and dropped.
- The Action mirrors the replay pipeline (`scripts/replay-extract.ts`): heavy parsing runs in CI, not
  in a Vercel request.

### Trusted auto-commit (#138)

A clean, corroborated parse skips the human Confirm. `evaluateAutoCommit()`
(`src/lib/demo/autoCommit.ts`) is the **D5 predicate** — a pure decision over: the match has no
existing confirmed score (auto-commit never overwrites a played match — a disagreement always routes
to manual review, no matter how clean the new parse is), quarantine passes, zero parser warnings
(which also covers full roster resolution and a clean stored-vs-demo side agreement),
`skins_starting_side` was **stored** (not just demo-inferred — this always excludes the gauntlet
knife path, whose self-derived score, #137, never has a stored side), and the demo-derived score
matches MatchZy's own `map_result` event read from `mapResultKey` (`buildMatchzyConfig` fixes
team1 = SHIRTS / team2 = SKINS, so it's a direct equality, no side remapping). `scripts/demo-ingest.ts`
gathers the inputs, calls it after quarantine, and logs the verdict either way.

`AUTO_COMMIT_ENABLED` (a repo Actions variable) gates the write on an eligible verdict: unset runs in
**shadow mode** — the predicate is evaluated and logged (`::notice::`) but the result is always staged
for manual confirm; `true` calls the shared `writeMatchScore()` (`src/lib/matchScore.ts`) directly,
marks the job `confirmed`, and deletes the staged `demoResultKey` and `mapResultKey` artifacts. An
ineligible verdict — including a disagreement between the demo score and `map_result`, or an
already-confirmed match — always falls back to the staged-result review, regardless of the flag.

`writeMatchScore()` is the single write path for a match score (validation, `matches.final_score` +
`player_match_stats`, sabremetrics, rating recompute, gauntlet-propagate-or-season-completion, and
admin-gated steam-id learning) — the interactive `PATCH /api/matches/[id]/score` route and the
demo-ingest Action both call it, so the write behaves identically either way. It has no `next/server`
dependency: the route defers its recompute/completion/steam-id hooks (run concurrently, since none
gates another) past the response via its own `after()` (passed in as `opts.after`); the Action, which
has no request scope and exits once `main()` returns, awaits them directly instead.

Reparsing an already-**confirmed** match (e.g. to backfill a newly added sabremetric) never goes
through auto-commit — a score-unchanged reparse upserts sabremetrics directly (the shortcut above the
D5 check), and a score-*changed* reparse is exactly what the predicate's already-confirmed check
excludes, so it always falls through to the staged-result review instead, regardless of how cleanly
it parses.

### Job state (`background_jobs`, `job_type = 'demo_ingest'`)

Schema-free by design — status lives in the existing table, detail lives in the R2 artifact:

`received → queued → running → parsed | quarantined → confirmed | dismissed | failed`

Auto-commit takes the `running → confirmed` edge directly (no `parsed` stop) — the D5 predicate check
and the write both happen inside the `running` stage.

### Missing-demo detection (#228)

The Worker → notify → Action chain has no built-in alarm if MatchZy never POSTs the demo in the first
place (a config-set clobbering the demo-upload cvars, a MatchZy-side upload failure, a dead Worker) —
`/api/ingest/notify` records `received` as its first side effect, so a missing `demo_ingest` row means
the chain never started, and nothing else observes that silently. `teardownMatchServer` (any real
teardown — eager-on-notify, score-write, or the explicit operator stop) checks for exactly this: no
`demo_ingest` background job for the match, no score yet written, and the server has been up more than
five minutes (comfortably longer than any real match takes to reach this point, so it never fires
mid-match). It records an `ops_errors` row (`entity_type: 'match'`, `operation:
'demo_ingest_missing'`, surfaced on `/admin/ops-errors`) so an admin can pull the demo off the server
manually before the next match (or `dathost-cleanup`) overwrites it. The flag clears itself once a
score lands for the match, regardless of how it got there (auto-commit, staged confirm, or manual
entry).

## Admin surfaces

- **`/admin`** — hub, linked from the Topbar (visible only when `session.user.isAdmin`). Add a tool
  via the `TOOLS` array.
- **`/admin/jobs`** — dashboard over **all** `background_jobs` pipelines (`demo_ingest`,
  `replay_extract`, `radar_build`; #145), newest first, each row badged by type with a color-coded
  status pill, stage/error, the Action log link, and — for staged demo jobs — parse warnings +
  quarantine flags (read from R2). This is the notification channel: the surface for anything that
  would otherwise fail silently (Discord is deprioritized). Demo rows carry inline actions —
  **Confirm** (a cleanly parsed, score-derived result only), **Re-parse**, **Dismiss** — driven by
  the shared `useDemoIngestActions` hook (the same one the in-match `MatchDemoReviewBlock` uses, so
  they can't drift); replay/radar rows carry a **Retry** that re-dispatches their Action
  (`JobRetryButton`). Data comes from `getBackgroundJobs()`; the list stays live via Realtime on
  `background_jobs`.
- **`/admin/servers`** — server console: the single shared server's current occupant (reconciled via
  `getActiveServerMatch`), connect string, and — on the occupying match — two controls: **Apply match
  settings** (re-push that match's MatchZy config via `matchzy_loadmatch_url`, restoring forced
  `map_sides` + demo-upload cvars after an "Apply config set" or panel edit clobbered them; sends the
  server back to warmup/knife-select) and **Teardown** (stop a server left live — the autostop-failed
  safety valve). The **Config vs golden** block runs `diffGoldenConfig` read-only (settings + every
  cfg file, cvar-by-cvar), the same comparison the `dathost-golden-diff` CLI renders. **Apply config
  set** pushes a server-level `cs2_settings` baseline (map picker + config-set dropdown) — it does
  *not* load a match config, so run **Apply match settings** after it if a match is mid-setup. Live via
  Realtime on `matches`. Also hosts the **disk cleanup** controls (issue #132, see
  `infra/matchzy/README.md`) — enable/disable the `dathost-cleanup` workflow, set its interval, and a
  **Run now** button, all through `src/lib/gh-dispatch.ts`'s GitHub Actions helpers rather than
  `background_jobs` (there's no per-match/per-map target for this job).

`is_admin` is threaded into the session JWT (`authOptions.js`) and typed on `session.user.isAdmin`;
existing sessions are backfilled on their next request (no re-login needed). Every admin page still
re-checks `isPlayerAdmin` server-side — the Topbar link is visibility only, not the security boundary.

## Config generation

**`src/lib/matchzy.ts#buildMatchzyConfig`** emits the per-match MatchZy config (teams by steamid64,
`players_per_team: 2`, conditional `map_sides`, demo-upload + remote-log cvars). It's the target of
the machine-auth `GET /api/matches/[id]/matchzy-config` route (the `matchzy_loadmatch_url`) and is
reused by the `scripts/gen-matchzy-config.ts` CLI. Versioned golden settings + captured cfgs live in
`infra/matchzy/`; the Worker lives in `infra/worker/`.

**`src/lib/dathost-config.ts`** is the single source for the cfg-file dimension: the tracked
`CFG_FILES` list, `pushCfgFiles` (reasserts them to the server — called at provision and by
`dathost-golden-apply.ts --reassert`), and `diffGoldenConfig` (the read-only drift comparison shared
by the admin console and `dathost-golden-diff.ts`). Because provisioning re-pushes these before every
boot, the repo is the source of truth for cfg files — a cfg edited only in the DatHost panel is
overwritten on the next provision.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/matches/[id]/server/status` | session (admin/in-match) | reconciled server state for the panel |
| POST | `/api/matches/[id]/server/provision` | session | provision (202; boots in `after()`; 409 if busy) |
| POST | `/api/matches/[id]/server/apply-match-config` | session | re-push the match's loadmatch config (409 if busy) |
| POST | `/api/matches/[id]/server/teardown` | session | stop the server |
| GET | `/api/admin/server/config-diff` | admin | read-only golden-config drift (`diffGoldenConfig`) |
| GET | `/api/matches/[id]/matchzy-config` | machine (`X-MatchZy-Token`) | the `matchzy_loadmatch_url` target |
| POST | `/api/ingest/notify` | machine (`x-ingest-secret`) | demo landed → record + dispatch + teardown |
| POST | `/api/ingest/matchzy-log` | machine (`x-matchzy-token`) | remote-log event → keep `map_result` (auto-commit oracle), ignore the rest |
| GET·DELETE | `/api/matches/[id]/demo/result` | session | read / dispose the staged `DemoIngestResult` |
| POST | `/api/matches/[id]/demo/dispatch` | session | re-parse the demo in R2 (manual counterpart to notify) |
| POST | `/api/matches/[id]/replay/dispatch` | session | (re)trigger the replay Action |

## Environment

`DATHOST_EMAIL`, `DATHOST_PASSWORD`, `DATHOST_SERVER_ID`, `MATCHZY_CONFIG_SECRET`, `APP_BASE_URL`
(the origin the DatHost server fetches the config from, and — on the demo-ingest Action — the origin
`writeMatchScore()`'s recompute trigger calls), `INGEST_WORKER_URL`, `INGEST_UPLOAD_SECRET`,
`INGEST_NOTIFY_SECRET`, `INGEST_REMOTE_LOG_SECRET` (the `matchzy_remote_log_url` cvars are only
emitted once this is set). Hosting auto-triggers are env-gated on `DATHOST_SERVER_ID`, so with it
unset everything degrades to the manual flow. The disk-cleanup admin controls additionally need
`GITHUB_DISPATCH_TOKEN`/`GITHUB_REPO` (shared with every other Action dispatch) with the token's
"Variables" repository permission also granted, for the interval control.

The demo-ingest Action needs its own copies of `APP_BASE_URL` (repo Actions **variable** — it's
public, unlike the rest of this list) and `RECOMPUTE_SECRET` (repo **secret**), since it runs outside
Vercel and has no other way to reach the app's recompute endpoint. `AUTO_COMMIT_ENABLED` (repo
variable) gates trusted auto-commit (#138) — unset runs the predicate in shadow mode (evaluated +
logged, still staged for manual confirm); `true` goes live.

## Key files

`src/lib/dathost.ts` · `src/lib/dathost-lifecycle.ts` (lifecycle + `getReconciledServerState` +
`getActiveServerMatch` + `findServerOccupant`) · `src/lib/matchzy.ts` · `src/lib/schedule.ts` ·
`src/lib/matchScore.ts` (`writeMatchScore()` — shared score-write + hooks, #138) ·
`src/lib/demo/mapResult.ts` (`map_result` parse/R2 read-write) ·
`src/components/MatchServerPanel.tsx` · `src/components/MatchDemoReviewBlock.tsx` ·
`src/components/useDemoIngestActions.ts` (shared confirm/dismiss/re-parse) ·
`src/components/IngestJobActions.tsx` · `src/components/JobActions.tsx` (generic retry + live refresh) ·
`src/components/ServerConsolePanel.tsx` ·
`src/components/SchedulingOverlapBanner.tsx` · `src/app/admin/jobs/page.tsx` ·
`src/app/admin/servers/page.tsx` · `scripts/demo-ingest.ts` · `scripts/gen-matchzy-config.ts` ·
`scripts/inspect-demo.ts` · `scripts/dathost-golden-diff.ts` · `scripts/dathost-golden-apply.ts`
(golden-config diff/capture/reassert — see [`infra/matchzy/README.md`](../infra/matchzy/README.md))
· `scripts/dathost-cleanup.ts` (disk cleanup, issue #132) · `src/lib/gh-dispatch.ts` (workflow
dispatch + enable/disable/runs/variables helpers) · `infra/matchzy/` · `infra/worker/`.

## Known limitations / friction

- **Reconcile is read-only.** If a match page is never viewed and no demo/score arrives, the row can
  stay `live` after autostop. Teardown-on-receipt + score-write teardown cover the real paths; a
  periodic reconcile was intentionally skipped.
- **Concurrency guard has a tiny check-then-claim window** (above) — a fully atomic claim would need a
  Postgres advisory-lock RPC, judged not worth it for the rarity.
- **Nightly reset (#132)** is DatHost-panel config, not code: a daily `css_endmatch` scheduled command
  + `autostop_minutes: 10` as the idle/billing backstop. Disk cleanup is a separate, code-side piece
  of the same issue — see [`infra/matchzy/README.md`](../infra/matchzy/README.md) for
  `scripts/dathost-cleanup.ts`, which the DatHost panel's command scheduler can't do since it only
  reaches in-game RCON, not the file manager.
