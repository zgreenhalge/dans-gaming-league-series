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
  match is the current occupant, so tearing down one match never stops another's server.
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
- The Worker's notify POST (`infra/worker/src/index.ts`) retries a few times with backoff and logs
  every failed attempt — it runs in the background (`ctx.waitUntil`) so it never delays the response
  to MatchZy. If every retry fails (the R2 write already succeeded regardless), the demo sits in R2
  with no `background_jobs` row. `GET /api/matches/[id]/demo/result` checks for exactly that on a
  single match, on demand, when its own page is viewed — gated to matches with veto complete but no
  score yet (`isAwaitingScoreAfterVeto`, mirroring `isVetoComplete` from `src/lib/veto.ts`), the only
  window a demo could legitimately exist unprocessed; there's no bucket-wide scan anywhere in this
  pipeline. When it finds one, `MatchDemoReviewBlock` offers a **Process demo** button that dispatches
  the same Action manually, without re-uploading.
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

## Scrims

**`/scrim`** — any signed-in player can pick a map and start the shared server for a casual, free-
form game outside the DGLS match model entirely: no roster, no veto, no `matches` row, no stats. It
reuses the same primitives the admin console's "Apply config set" + "Start" use
(`applyConfigSet`/`pushCfgFiles`/`startServer` in `dathost.ts`/`dathost-config.ts`) via
`POST /api/scrim/start`, minus the admin-only override — starting is refused outright (409, no
override) if `getServerOccupancy` reports the server occupied, if a scrim is already running, or if
`findNearbyUnscoredMatch` (`dathost-lifecycle.ts`) finds a league match scheduled within
`SCHEDULE_COLLISION_WINDOW_MS` of right now that hasn't been scored yet (`isPlayedScore`) — a scrim
never bumps a real match, even one whose scheduled time has already passed.

A scrim never calls `loadMatch` — with no roster loaded, MatchZy stays in **Pug Mode** (teams
unlocked; players self-assign with `.ct`/`.t`/`.spec`, no locked roster like a real match). Right
after boot, `/api/scrim/start` pushes one console line (`runConsole`) asserting
`matchzy_knife_enabled_default 0` (no knife round — sides are whatever players pick),
`matchzy_playout_enabled_default` from the start-time "play out all rounds" toggle,
`mp_warmup_pausetimer 1`, and `matchzy_minimum_ready_required 0` unconditionally — the golden league
config's `matchzy_minimum_ready_required 4` assumes a full 2v2 roster, which a scrim's
variable/non-standard player count doesn't have, so it's overridden live rather than changed in the
shared golden config real matches also use (`0` = ready requires everyone currently connected, not a
fixed headcount). A separate "Friendly" toggle gates `FRIENDLY_CVARS` (`mp_autokick 0`,
`mp_drop_knife_enable 1`, `mp_forcecamera 0`, `mp_shoot_dropped_grenades true`) — only asserted when
checked, left at whatever the golden league config sets otherwise.

Concurrency is tracked by `scrim_sessions`, a **singleton** table (`src/lib/scrim-session.ts`): its
primary key is pinned to a fixed value, so at most one row can ever exist, and `/api/scrim/start`
claims it with a plain `INSERT` — a primary-key collision on a second concurrent start fails
atomically (409) rather than racing on a check-then-act read. `POST /api/scrim/stop` is refused (403)
unless the requester is the player who started it or an admin, refused (409) if a real DGLS match
holds the server, and otherwise stoppable (e.g. no session row at all — the server on for some other
reason, like the admin console). `GET /api/scrim/status` surfaces `startedByName`/`canStop` so
`ScrimPanel` can show a "Scrim started by …" notice and hide the Stop button for anyone who isn't the
starter or an admin.

Every path that stops the server — `/api/scrim/stop`, the raw admin console stop
(`/api/admin/server/stop`), and real-match teardown (`teardownMatchServer`) — goes through
`stopSharedServer` (`dathost-lifecycle.ts`, alongside the rest of "who occupies the shared server")
instead of the raw `stopServer`, so a scrim session is always cleared alongside whatever actually
stopped the box, no matter which of those triggered it. The one stop this can't observe is DatHost
stopping the server on its own (an idle timeout) — for that, `/api/scrim/start` and `GET /api/scrim/
status` both call `reconcileScrimSession` before anything else: if the session table says active but
the server's actually off, the row is cleared right there, so the singleton can never get permanently
stuck either from an unobserved stop or from a failed start.

Since a scrim otherwise has no roster data model, "who's connected" can't come from a DB row —
`players_online` on the DatHost server object is a bare count with no roster, and there's no dedicated
player-list endpoint. Instead `GET /api/scrim/status` reads the server's raw console log
(`getConsoleLines`, a rolling ~1000-line window) and derives the current roster from the
connect/disconnect/round events already in it — every one carries `"name<userid><steamid><team>"` —
via `parseConnectedPlayers` (`server-players.ts`). This is best-effort: a player whose connect line
has scrolled out of the 1000-line window before any later event re-mentions them (e.g. a very long
session with heavy chatter) won't appear even though they're still connected.

**The reused server's console log isn't reset by a stop/start** — a "connected" line from whatever
last used the box (a previous scrim, a real match, a leftover test) with no matching "disconnected"
line after it otherwise reads as a still-connected phantom player until a real connection happens to
reuse the same `userid` slot and overwrite it. `/api/scrim/start` echoes `SCRIM_BOOT_MARKER`
(`server-players.ts`) to the console right after boot, and `GET /api/scrim/status` discards every line
at or before the *last* occurrence of that marker (`linesSinceMarker`) before parsing the roster — so
only lines from the current boot are ever trusted.

**Pre-match warnings.** `scripts/scrim-warnings.ts`, run every 5 minutes by the `scrim-warnings`
GitHub Actions workflow (not a Vercel cron — this project's plan only allows daily crons), no-ops
unless a scrim session is active. When one is, and `findNearbyUnscoredMatch` finds a nearby unscored
league match, it `say`s an in-game warning once each time the time-until-match crosses the 15/10/5-
minute bands (tracked per-session via `scrim_sessions.warned_15/10/5`, one-shot per threshold) —
purely advisory, since a scrim never blocks a match from actually starting.

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
| GET | `/api/scrim/status` | session | raw server state + active match + connected roster + blocking-match check + scrim ownership |
| POST | `/api/scrim/start` | session | claim the singleton scrim session + apply golden config at a picked map + start in Pug Mode (409 if occupied, a scrim's already running, or a nearby match is unscored) |
| POST | `/api/scrim/stop` | session | stop + release the scrim session (409 if a DGLS match holds the server, 403 if not the session's starter/an admin) |

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

`src/lib/dathost.ts` (incl. `getConsoleLines`) · `src/lib/dathost-lifecycle.ts` (lifecycle +
`getReconciledServerState` + `getActiveServerMatch` + `findServerOccupant` + `findNearbyUnscoredMatch`)
· `src/lib/server-players.ts` (`parseConnectedPlayers` — derives the connected roster from the raw
console log, no stored state) · `src/lib/matchzy.ts` · `src/lib/schedule.ts` ·
`src/lib/matchScore.ts` (`writeMatchScore()` — shared score-write + hooks, #138) ·
`src/lib/demo/mapResult.ts` (`map_result` parse/R2 read-write) ·
`src/components/MatchServerPanel.tsx` · `src/components/MatchDemoReviewBlock.tsx` ·
`src/components/useDemoIngestActions.ts` (shared confirm/dismiss/re-parse) ·
`src/components/IngestJobActions.tsx` · `src/components/JobActions.tsx` (generic retry + live refresh) ·
`src/components/ServerConsolePanel.tsx` · `src/components/ServerStatusBits.tsx` (shared status pill +
copy-connect button) · `src/components/ScrimPanel.tsx` · `src/app/scrim/page.tsx` ·
`src/lib/scrim-session.ts` (the singleton `scrim_sessions` claim/release/reconcile) ·
`scripts/scrim-warnings.ts` + `.github/workflows/scrim-warnings.yml` (pre-match warning cron) ·
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
