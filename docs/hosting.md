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

Because the server is reconfigured for recreational modes between matches, **launching must re-assert
the `golden` config set's full `cs2_settings` before every boot** (`applyConfigSet`, via
`launchServer`). Map selection is always pinned to a single workshop map per match —
`workshop_collection` mode doesn't behave reliably on this server, so `applyConfigSet` throws if a
match's map isn't resolved yet rather than falling back to it. See
[`infra/matchzy/README.md`](../infra/matchzy/README.md) for the config-set seed layout and the
diff/apply tooling that keeps the `golden` set in sync with the live server.

## Server-state machine

Persisted on `match_server_state` — one row per match (`match_id` FK to `matches`, PK), created on
first provision; no row means `idle`. Kept off the core `matches` row since this is transient
per-match orchestration state (populated for the ~20 minutes a match is actually being provisioned/
played, meaningless once scored), not match data — see issue #288.

| Column | Meaning |
|---|---|
| `server_state` | `idle → provisioning → live → tearing_down → done` (or `failed`) |
| `dathost_server_id` | the DatHost server this match claimed (always the one shared id today) |
| `connect_string` | `ip:port` for the join/`connect` link, set when `live`, cleared on teardown |
| `server_started_at` | when provisioning began (drives the panel's progress estimate) |
| `teardown_at` | when a scheduled (non-immediate) teardown's grace period ends — set on entering `tearing_down`, cleared once the stop actually runs |

Orchestration lives in **`src/lib/dathost-lifecycle.ts`** over the typed client in
**`src/lib/dathost.ts`** (DatHost REST `/api/0.1`, HTTP Basic auth):

- **`provisionMatchServer`** — `findServerOccupant` guard → `provisioning` → `launchServer` (resolves
  the `golden` config set, PUTs it + the picked workshop map, reasserts its cfg files since they're
  `exec`'d at boot / go-live, `startServer`, `waitUntilReady`) → `loadMatch` (`matchzy_loadmatch_url`)
  → `live` + `connect_string`. Marks `failed` and rethrows on any error. A per-file cfg-push failure is
  logged, not fatal. `launchServer` is the same shared orchestration the admin console's Start and
  `/api/scrim/start` use (with a different `configSetKey`/`extraCvars`, no `loadMatch` after), so all
  three can't disagree on what "apply + push + boot" means (#315).
- **`teardownMatchServer`** — `stop` (never delete) → `done`, or, given `delayMs`, schedules the stop
  instead of running it inline (`tearing_down` + `teardown_at`, see Reconciliation below).
  `onlyIfOwnsServer` no-ops unless this match is the current occupant, so tearing down one match never
  stops another's server.
- **`getReconciledServerState`** — reconciles `tearing_down`/`live` against reality (see below).

### Reconciliation (#135)

`getReconciledServerState` (used by the match page's status route and the admin server console's
`getActiveServerMatch`) does two things on every read, not just a status check:

- **Executes a due scheduled teardown (`runDueTeardown`).** The automatic paths (`map_result`, score
  write) call `teardownMatchServer(..., { delayMs: AUTO_TEARDOWN_DELAY_MS })`, which only moves the
  row to `tearing_down` with `teardown_at` set — a grace period so players see the post-match
  scoreboard instead of an instant disconnect. The actual `stop` call runs here, the next time the
  state is read, once `teardown_at` has passed — a plain timestamp check with no DatHost round-trip
  until then, since this fires on every read (including the admin console's 2s poll for the whole
  grace period). Both the match page and the admin server console read this, so a due teardown fires
  on the next view of either — no separate cron needed, but also no guarantee either gets viewed; see
  Known limitations below.
- **Downgrades a stale `live`.** After a match ends the shared server auto-stops (`autostop`, 3-min
  idle) while the row can stay `live` if nothing scheduled a teardown — the panel would keep offering a
  dead connect link. When DatHost reports the server stopped, this flips `live → done`.

Both are **downgrade-only** (a running server is left alone — concurrent-occupancy is #134's problem,
not this one) and best-effort (a DatHost/DB error leaves the row at `tearing_down`/`live` for the next
read to retry; DatHost's own autostop is the ultimate backstop either way).

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

The demo is **pulled** from the DatHost game server's own file storage by the demo-ingest Action, not
pushed by MatchZy — MatchZy's push has no compression option and a large (~200MB+) demo can exceed
Cloudflare's inbound request-body cap, a platform limit outside our control. `map_result` (from
MatchZy's `matchzy_remote_log_url`) is a small JSON event with no such ceiling, so it drives the whole
pipeline instead:

```
MatchZy (map_result event) ──POST /api/ingest/matchzy-log──▶ R2 (mapResultKey)  [independent oracle]
                                                                              │
   background_jobs(demo_ingest): received → queued ──dispatch──▶ demo-ingest.yml (GitHub Action)
                                                                              │
       scripts/demo-ingest.ts: pull demo from DatHost (R2) + parse + quarantine + D5 predicate check
                                          │                              │
                       predicate passes, no manual override      predicate fails / manual override active
                            writeMatchScore()  status: confirmed        R2 (demoResultKey)  status: parsed | quarantined
                                                                              │
                                          in-match MatchDemoReviewBlock  ──admin Confirm──▶ PATCH /score  (confirmed)
                                                                              │  or Dismiss (dismissed)
   admin console (/admin, Activity)── every background job + warnings/quarantine flags, live ─────────┘
```

- `/api/ingest/matchzy-log` (machine-auth `x-matchzy-token`) is the `matchzy_remote_log_url` target.
  MatchZy POSTs every match event here. `map_result`'s payload is kept (at `mapResultKey`, the
  auto-commit cross-check) and it's also the pipeline's trigger: it validates no job is already in
  flight, records `received`, dispatches the Action, and **schedules the server's teardown** (the map
  ending means the match is over) — a grace period (`AUTO_TEARDOWN_DELAY_MS`), not an instant stop, so
  players see the post-match scoreboard rather than getting disconnected mid-celebration; see
  Reconciliation below for how the delayed stop actually runs. The Action never touches DatHost
  regardless of auto-commit or manual confirm. `going_live`, `round_end`, and `map_result` all upsert
  `live_match_score` (`liveScore.ts`) through the same generic path, shown on the match page
  (`MatchScoreHero`) and site-wide (`LiveMatchTicker`) while the demo doesn't exist in R2 yet —
  `pullDemoAndClearLiveScore` (`liveScore.ts`) clears the row the moment its `ensureDemoInR2`
  (`fetchFromDathost.ts`) pull confirms it does. Every other event type is acknowledged and dropped.
- The demo's remote path is deterministic: `infra/matchzy/cfg/MatchZy/config.cfg` sets
  `matchzy_demo_path MatchZy/`, and a real match's loaded config JSON carries a per-match
  `matchzy_demo_name_format` cvar (`buildMatchzyConfig`, `src/lib/matchzy.ts`) set to `demoBaseName()`'s
  output — a literal `{date}_{matchId}_{map}` (e.g. `2026-08-04_58_de-rooftop`) computed purely from the
  match's own DB row, with no MatchZy `{TOKEN}` left for the engine to fill in. So the demo always lands
  at `MatchZy/{demoBaseName}.dem` on the game server — no directory listing/discovery needed, and no
  reliance on MatchZy's own `{MAP}`/`{TIME}` substitution, which isn't observable ahead of the pull.
  `fetchDemoFromDathost` (below) calls the exact same `demoBaseName()` rather than recomputing the name
  itself, so the two sides can't independently drift apart.
  Since MatchZy's recording is a `tv_record` wrapper around GOTV (see
  [`cs2-stack-reference.md`](./cs2-stack-reference.md#gotv-vs-demo-recording--matchzys-recording-is-gotv-not-a-separate-system)),
  that path already exists — and is still growing — for the entire match, not just after it ends, so
  merely finding the file there doesn't mean the recording is finished. `fetchDemoFromDathost`
  (`src/lib/demo/fetchFromDathost.ts`) instead waits out however much of a 120s floor (GOTV's own
  post-`map_result` flush delay) is still outstanding since `map_result` actually fired for this match
  — `remainingFlushFloorMs()`, anchored to the `demo_ingest` job row's `created_at`
  (`getJobCreatedAt()`, `src/lib/background-jobs.ts`), set once at that row's first claim and never
  overwritten by a later retry or manual dispatch — before ever checking, then polls the file's size
  via DatHost's file-listing endpoint (`listFiles()`/`getFileSize()`, `src/lib/dathost.ts` — the
  direct-download route reports neither `Content-Length` nor `Content-Range` for a large/in-progress
  file, see [`cs2-stack-reference.md`](./cs2-stack-reference.md)'s DatHost API patterns) with
  exponential backoff until two consecutive checks agree it's stopped growing — only then does it
  download, gzip, and write it to R2 at the same deterministic `demoKey(matchId)` a browser upload
  would use, within an 8-minute overall ceiling. A dispatch that lands well after `map_result` (a
  manual reparse hours or days later) needs little or none of the floor left; one that lands soon after
  it — the real auto-dispatch flow, or a manual click that happens to land in that window — still gets
  up to the full wait, regardless of which triggered it. Both
  `demo-ingest.ts` and `replay-extract.ts` call it themselves, at the top of their own run, only if the
  demo isn't already in R2, so either one can be dispatched (or re-dispatched) independently. Since both
  are auto-dispatched together off the same `map_result` event and tend to detect the demo on the same
  DatHost poll cycle, `replay-extract.ts` checks `background_jobs` for a claimed `demo_ingest` row
  on a miss, only then (`demoIngestInFlight()`): if one exists, it treats `demo-ingest.ts` as the
  pull's owner and waits out the same grace window `demo-ingest.ts`'s own DatHost poll gets — polling
  R2 instead, much cheaper — before falling back to pulling independently. A manual "Regenerate"
  dispatch has no such row and pulls immediately, with no wasted wait.
- The Action mirrors the replay pipeline (`scripts/replay-extract.ts`): heavy parsing (and the demo
  pull itself) runs in CI, not in a Vercel request.

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

`AUTO_COMMIT_ENABLED` (a repo Actions variable) gates the write on an eligible verdict: unset (or
anything but `false`) calls the shared `writeMatchScore()` (`src/lib/matchScore.ts`) directly, marks
the job `confirmed`, and deletes the staged `demoResultKey` and `mapResultKey` artifacts — this is the
default. `false` is the **manual override**: the predicate is still evaluated and logged (`::notice::`)
but the result is always staged for manual confirm instead of written, for incident response (e.g.
investigating a parser issue) without needing a code change. An ineligible verdict — including a
disagreement between the demo score and `map_result`, or an already-confirmed match — always falls
back to the staged-result review, regardless of the flag.

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

`stage` moves through `received → queued → fetch → parse → confirmed` within that — `fetch` covers the
DatHost pull, `parse` the rest — for progress detail without a separate status. Auto-commit takes the
`running → confirmed` status edge directly (no `parsed` stop) — the D5 predicate check and the write
both happen inside the `running` status, after the `parse` stage.

## Scrims

**`/scrim`** — any signed-in player can pick a config set + map (the shared `LaunchOptionsPicker`,
`src/components/LaunchOptionsPicker.tsx`) and start the shared server for a casual, free-form game
outside the DGLS match model entirely: no roster, no veto, no `matches` row, no stats. It calls the
same `launchServer` orchestration (`dathost-lifecycle.ts`) the admin console's Start button uses via
`POST /api/scrim/start`, minus the admin-only override — starting is refused outright (409, no
override) if `getServerOccupancy` reports the server occupied, if a scrim is already running, or if
`findNearbyUnscoredMatch` (`dathost-lifecycle.ts`) finds a league match scheduled within
`SCHEDULE_COLLISION_WINDOW_MS` of right now that hasn't been scored yet (`isPlayedScore`) — a scrim
never bumps a real match, even one whose scheduled time has already passed. `POST /api/scrim/apply-
config` is the no-boot counterpart — reasserts the picked config set without starting the server,
using `applyConfigSetOnly` (`dathost-lifecycle.ts`, the admin console's Apply config set button uses
the same one) and the identical two refusals Start has (occupancy, nearby unscored match) — applying
a config set is exactly as disruptive as starting, so it's gated the same way, not just occupancy
alone.

A scrim never calls `loadMatch` — with no roster loaded, MatchZy stays in **Pug Mode** (teams
unlocked; players self-assign with `.ct`/`.t`/`.spec`, no locked roster like a real match). Right
after boot, `launchServer`'s `extraCvars` (built by `pugModeCvarLine`, `dathost-lifecycle.ts`) asserts
`matchzy_knife_enabled_default 0` (no knife round — sides are whatever players pick),
`matchzy_playout_enabled_default` from the launch-time "play out all rounds" toggle,
`mp_warmup_pausetimer 1`, and `matchzy_minimum_ready_required 0` unconditionally — the golden league
config's `matchzy_minimum_ready_required 4` assumes a full 2v2 roster, which doesn't hold with no
roster loaded, so it's overridden live rather than changed in the shared config set real matches also
use (`0` = ready requires everyone currently connected, not a fixed headcount). It also overrides
`matchzy_demo_name_format`/`matchzy_hostname_format` to a `{TIME}`-based (not `{MATCH_ID}`-based)
template: the golden config's `"{MATCH_ID}"` demo name is only unique because a real match's `matchid`
comes from the loaded match JSON, and a roster-less launch never loads one, so left alone every pug
session's demo would land at the same unresolved path — colliding with itself launch over launch, and
risking collision with a real match's `MatchZy/{matchId}.dem` if that empty token ever resolved to
something an actual match id could match. A separate "Friendly" toggle gates `FRIENDLY_CVARS`
(`mp_autokick 0`, `mp_drop_knife_enable 1`, `mp_forcecamera 0`, `mp_shoot_dropped_grenades true`) —
only asserted when checked, left at whatever the config set sets otherwise. `pugModeCvarLine` is
shared with the admin console's Start button (below), which offers the same two toggles — any launch
with no roster loaded behaves the same way regardless of who starts it.

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
player-list endpoint. Instead `getConnectedPlayers` (`server-players.ts`) reads the server's raw
console log (`getConsoleLines`, a rolling ~1000-line window) and derives the current roster from the
connect/disconnect/round events already in it — every one carries `"name<userid><steamid><team>"` —
via `parseConnectedPlayers`. Both `GET /api/scrim/status` and `GET /api/admin/server/status` call it,
so the admin console gets the same real name list (`ConnectedRoster`, `ServerStatusBits.tsx`) instead
of a bare count. This is best-effort: a player whose connect line has scrolled out of the 1000-line
window before any later event re-mentions them (e.g. a very long session with heavy chatter) won't
appear even though they're still connected.

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

**`/admin`** is the unified admin console (issue #262), linked from the Topbar (visible only when
`session.user.isAdmin`). Three zones on one page — a standalone Server panel (always visible,
regardless of which tab below it is open — the shared server isn't scoped to any one tab), an Activity
feed, and Manage:

- **Activity feed** (`AdminActivityFeed.tsx`) — every `background_jobs` row across all four pipelines
  (`demo_ingest`, `replay_extract`, `radar_build`, `ehog_recompute`; #145) merged with live `ops_errors`, tiered Errored /
  In Progress / Completed (defaulting to the first non-empty tier in that priority order). This is the
  notification channel: the surface for anything that would otherwise fail silently (Discord is
  deprioritized). Each row is badged by type with a color-coded status pill, stage/error, the Action
  log link, and — for staged demo jobs — parse warnings + quarantine flags (read from R2). Demo rows
  carry inline actions — **Confirm** (a cleanly parsed, score-derived result only), **Re-parse**,
  **Dismiss** — driven by the shared `useDemoIngestActions` hook (the same one the in-match
  `MatchDemoReviewBlock` uses, so they can't drift); replay/radar rows carry a **Retry** that
  re-dispatches their Action (`JobRetryButton`). Data comes from `getBackgroundJobs()`/`getOpsErrors()`;
  the list stays live via Realtime on `background_jobs`. The Completed tier clusters consecutive
  same-type/same-status runs (a bulk reparse reads as one line, not forty); Errored never clusters.
- **Server panel** (`ServerConsolePanel.tsx`, one bordered box) — the single shared server's current
  occupant (reconciled via `getActiveServerMatch`), and — on the occupying match — two controls:
  **Apply match settings** (re-push that match's MatchZy config via `matchzy_loadmatch_url`, restoring
  forced `map_sides` + demo-upload cvars after an "Apply config set" or panel edit clobbered them;
  sends the server back to warmup/knife-select) and **Teardown** (stop a server left live — the
  autostop-failed safety valve). Connection details (a one-click Steam join, the raw `connect` string +
  copy button) and the **connected roster** (`ConnectedRoster`, `ServerStatusBits.tsx` — a real name
  list via `getConnectedPlayers`, not a bare count; its heading tints amber for "casual use," someone
  connected outside a DGLS match) are the same shared components `/scrim` uses — no separate "idle"/
  player-count lines duplicating what the state pill and roster already say. Below that, in the same
  box, the shared `LaunchOptionsPicker` (config set + map + "Play out all rounds"/"Friendly" toggles —
  the same component `/scrim` uses) with **Start** and **Apply config set** side by side: Start
  launches via `launchServer` (same orchestration and toggles `/api/scrim/start` uses, so the two
  surfaces can't drift, #315); Apply config set pushes the picked set's `server`/`cs2_settings` + cfg
  files without starting (`applyConfigSetOnly`) — the same fields `dathost-golden-apply.ts --reassert`
  pushes, and the same call real-match provisioning makes via `launchServer`, so a manual apply here
  and an automatic one at the next match provision can never disagree on which fields get re-asserted.
  It does *not* load a match config, so run **Apply match settings** after it if a match is mid-setup.
  The **Compare to live config** block runs `diffConfigSet` read-only for the selected config set
  (settings + every cfg file, cvar-by-cvar), the same comparison the `dathost-golden-diff` CLI renders.
  Live via Realtime on `match_server_state`. Also hosts the **disk cleanup** controls (issue #132, see
  `infra/matchzy/README.md`) — enable/disable the `dathost-cleanup` workflow, set its interval, and a
  **Run now** button, all through `src/lib/gh-dispatch.ts`'s GitHub Actions helpers rather than
  `background_jobs` (there's no per-match/per-map target for this job).
- **Manage** — Match/Player/Season, reusing `MatchManager`/`PlayerManager`/`SeasonManager` behind a
  Match/Player/Season switch; unrelated to the job/hosting pipelines documented here.

An Activity-tab ops error for a `match`/`player`/`season` entity links straight into the matching
Manage tab, prefiltered to that subject — see `AdminConsole.tsx`.

`is_admin` is threaded into the session JWT (`authOptions.js`) and typed on `session.user.isAdmin`;
existing sessions are backfilled on their next request (no re-login needed). Every admin page still
re-checks `isPlayerAdmin` server-side — the Topbar link is visibility only, not the security boundary.

## Config sets

**Config sets** — a named `server` + `cs2_settings` baseline plus its own set of cfg files — are
Supabase rows (`config_sets`, `config_set_files`), not the fixed single-file registry this used to be.
`golden` (the production baseline every real match provisions with) is one row among however many
exist; new sets are added via `scripts/seed-config-set.ts` or (once built) the admin config-set CRUD
UI. `infra/matchzy/` (`golden-server-settings.json` + `cfg/`) is the seed input for `golden` and a
disaster-recovery snapshot — it is **not read live** by the app.

| Table | Columns | Meaning |
|---|---|---|
| `config_sets` | `id`, `key` (unique, e.g. `golden`), `label`, `server_settings` (jsonb), `cs2_settings` (jsonb) | one row per config set — the `server`/`cs2_settings` PUT baseline |
| `config_set_files` | `id`, `config_set_id` (FK), `remote_path` (DatHost file-manager path, e.g. `cfg/server.cfg`), `content` | a set's cfg files — zero to N per set, so different sets can track different files |

**`src/lib/dathost-config.ts`** is the single source for the config-set data model: `resolveConfigSet`
(one set's settings + cfg files, by key), `listConfigSets` (key/label pairs for UI pickers),
`pushCfgFiles` (pushes a resolved set's cfg files to the server — called by `applyConfigSetOnly` and by
`dathost-golden-apply.ts --reassert`), and `diffConfigSet` (the read-only drift comparison shared by
the admin console and `dathost-golden-diff.ts`). Because launching re-pushes a set's cfg files before
every boot, a cfg edited only in the DatHost panel is overwritten on the next launch.

**`applyConfigSetOnly`** (`dathost-lifecycle.ts`) is `resolveConfigSet` + the settings PUT + cfg-file
push, without booting — the no-start half of `launchServer`, shared by `/api/admin/server/apply-config`
and `/api/scrim/apply-config` so "reassert a config set" can't drift between the admin and scrim
surfaces either.

## Config generation

**`src/lib/matchzy.ts#buildMatchzyConfig`** emits the per-match MatchZy config (teams by steamid64,
`players_per_team: 2`, conditional `map_sides`, remote-log cvars, and the per-match
`matchzy_demo_name_format` cvar — see `demoBaseName()` above). It's the target of the machine-auth
`GET /api/matches/[id]/matchzy-config` route (the `matchzy_loadmatch_url`) and is reused by the
`scripts/gen-matchzy-config.ts` CLI. `matchzy_demo_path` (the deterministic `MatchZy/` directory the
demo pull relies on) lives in the `golden` config set's static `cfg/MatchZy/config.cfg`, alongside a
`matchzy_demo_name_format "{MATCH_ID}"` fallback that only matters if some future launch path forgets
to set its own override (a real match's per-match cvar here, or a scrim/pug's `pugModeCvarLine`).

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/matches/[id]/server/status` | session (admin/in-match) | reconciled server state for the panel |
| POST | `/api/matches/[id]/server/provision` | session | provision (202; boots in `after()`; 409 if busy) |
| POST | `/api/matches/[id]/server/apply-match-config` | session | re-push the match's loadmatch config (409 if busy) |
| POST | `/api/matches/[id]/server/teardown` | session | stop the server |
| GET | `/api/admin/server/config-diff` | admin | read-only config-set drift vs. live (`diffConfigSet`, `?configSet=` defaults to `golden`) |
| POST | `/api/admin/server/start` | admin | launch via `launchServer` — config set + map + playout/friendly toggles (409 if busy unless `override`) |
| POST | `/api/admin/server/apply-config` | admin | reassert a config set without starting (`applyConfigSetOnly`, 409 if busy unless `override`) |
| POST | `/api/admin/server/stop` | admin | raw stop, no match-state writes (409 if busy unless `override`) |
| GET | `/api/matches/[id]/matchzy-config` | machine (`X-MatchZy-Token`) | the `matchzy_loadmatch_url` target |
| POST | `/api/ingest/matchzy-log` | machine (`x-matchzy-token`) | remote-log event → `map_result` keeps the payload (auto-commit oracle) + record/dispatch/teardown; `going_live`/`round_end`/`map_result` upsert `live_match_score`; the rest is ignored |
| GET | `/api/matches/[id]/live-score` | public | initial read of `live_match_score`; `MatchScoreHero` subscribes to the table directly for updates |
| GET·DELETE | `/api/matches/[id]/demo/result` | session | read / dispose the staged `DemoIngestResult` |
| POST | `/api/matches/[id]/demo/dispatch` | session | re-parse the demo (manual counterpart to `matchzy-log`'s auto-dispatch) |
| POST | `/api/matches/[id]/replay/dispatch` | session | (re)trigger the replay Action |
| GET | `/api/scrim/status` | session | raw server state + active match + connected roster + blocking-match check + scrim ownership |
| POST | `/api/scrim/start` | session | claim the singleton scrim session + apply the picked config set at a picked map + start in Pug Mode (409 if occupied, a scrim's already running, or a nearby match is unscored) |
| POST | `/api/scrim/apply-config` | session | reassert the picked config set without starting (`applyConfigSetOnly`, 409 if occupied, no override) |
| POST | `/api/scrim/stop` | session | stop + release the scrim session (409 if a DGLS match holds the server, 403 if not the session's starter/an admin) |

## Environment

`DATHOST_EMAIL`, `DATHOST_PASSWORD`, `DATHOST_SERVER_ID`, `MATCHZY_CONFIG_SECRET`, `APP_BASE_URL`
(the origin the DatHost server fetches the config from, and — on the demo-ingest/replay-extract
Actions — the origin `writeMatchScore()`'s recompute trigger calls), `INGEST_REMOTE_LOG_SECRET` (the
`matchzy_remote_log_url` cvars are only emitted once this is set — this is what everything in this
doc, including the demo pull, hangs off). Hosting auto-triggers are env-gated on `DATHOST_SERVER_ID`,
so with it unset everything degrades to the manual flow. The disk-cleanup admin controls additionally
need `GITHUB_DISPATCH_TOKEN`/`GITHUB_REPO` (shared with every other Action dispatch) with the token's
"Variables" repository permission also granted, for the interval control.

The demo-ingest and replay-extract Actions need their own copies of `DATHOST_EMAIL`/
`DATHOST_PASSWORD`/`DATHOST_SERVER_ID` (to pull the demo), `APP_BASE_URL` (repo Actions **variable** —
it's public, unlike the rest of this list), and `RECOMPUTE_SECRET` (repo **secret**), since they run
outside Vercel and have no other way to reach the app's recompute endpoint. `AUTO_COMMIT_ENABLED` (repo
variable) gates trusted auto-commit (#138) — unset (or anything but `false`) writes an eligible
verdict directly; `false` is the manual override (evaluated + logged, still staged for manual
confirm).

## Key files

`src/lib/util.ts` (`isServerLive`/`isServerOff` — the shared on/booting-state checks every consumer of
a `DathostServer`, client or server, goes through instead of reading `.on`/`.booting` inline) ·
`src/lib/dathost.ts` (REST client — `applyConfigSet`, `runConsole`, `getConsoleLines`) ·
`src/lib/dathost-config.ts` (config-set data model — `resolveConfigSet`, `listConfigSets`,
`pushCfgFiles`, `diffConfigSet`) · `src/lib/dathost-lifecycle.ts` (`launchServer` + `applyConfigSetOnly`
+ `pugModeCvarLine` + `getReconciledServerState` + `getActiveServerMatch` + `findServerOccupant` +
`findNearbyUnscoredMatch`) · `src/lib/server-players.ts` (`getConnectedPlayers` — fetches + parses the
connected roster from the raw console log, no stored state; `parseConnectedPlayers` is the pure parse
step) · `src/lib/matchzy.ts` · `src/lib/schedule.ts` · `src/lib/matchScore.ts` (`writeMatchScore()` —
shared score-write + hooks, #138) · `src/lib/demo/mapResult.ts` (`map_result` parse/R2 read-write) ·
`src/components/MatchServerPanel.tsx` · `src/components/MatchDemoReviewBlock.tsx` ·
`src/components/useDemoIngestActions.ts` (shared confirm/dismiss/re-parse) ·
`src/components/IngestJobActions.tsx` · `src/components/JobActions.tsx` (generic retry + live refresh) ·
`src/components/ServerConsolePanel.tsx` · `src/components/LaunchOptionsPicker.tsx` (shared config-set +
map + playout/friendly toggle controls, used by both `ServerConsolePanel` and `ScrimPanel`) ·
`src/components/MapPicker.tsx` (shared map-select + custom-workshop-ID input) ·
`src/components/ServerStatusBits.tsx` (shared status pill, `ServerConnectionDetails` — join link +
connect string + copy button — and `ConnectedRoster`, all used by both `ServerConsolePanel` and
`ScrimPanel`) ·
`src/components/ScrimStatusContext.tsx` (single shared poll of `GET /api/scrim/status`, consumed by
both `ScrimPanel` and `ScrimNavStatus`) · `src/components/ScrimPanel.tsx` ·
`src/components/ScrimNavStatus.tsx` · `src/app/scrim/page.tsx` ·
`src/lib/scrim-session.ts` (the singleton `scrim_sessions` claim/release/reconcile) ·
`scripts/scrim-warnings.ts` + `.github/workflows/scrim-warnings.yml` (pre-match warning cron) ·
`src/components/SchedulingOverlapBanner.tsx` · `src/app/admin/page.tsx` ·
`src/components/AdminActivityFeed.tsx` · `scripts/demo-ingest.ts` · `scripts/gen-matchzy-config.ts` ·
`scripts/inspect-demo.ts` · `scripts/dathost-golden-diff.ts` · `scripts/dathost-golden-apply.ts`
(config-set diff/capture/reassert — see [`infra/matchzy/README.md`](../infra/matchzy/README.md)) ·
`scripts/seed-config-set.ts` (seed/add a config set from local files) ·
`scripts/dathost-cleanup.ts` (disk cleanup, issue #132) · `src/lib/gh-dispatch.ts` (workflow
dispatch + enable/disable/runs/variables helpers) · `infra/matchzy/` (config-set seed / DR snapshot) ·
`src/lib/demo/fetchFromDathost.ts` (the demo pull) · `src/lib/demo/liveScore.ts` (writes/reads the
`live_match_score` table, and `pullDemoAndClearLiveScore` which the demo's arrival in R2 clears it
through) · `src/components/MatchScoreHero.tsx` (per-match live score) +
`src/components/LiveMatchTicker.tsx` (site-wide live ticker), both Realtime subscriptions.

## Known limitations / friction

- **The teardown delay has no timer of its own — it's opportunistic, not scheduled.** A due teardown
  only actually stops the server the next time `getReconciledServerState` is read (a match page or
  admin server console view, or the latter's 2s poll); there's no cron forcing it. For a match nobody
  actively watches after it ends — plausibly the common case, not an edge case — nothing ever reads a
  due `teardown_at`, so in practice the server keeps running (still occupying the shared server, still
  `tearing_down`) until DatHost's own `autostop` (3-min idle) stops it independently; the *next*
  `live`-reconcile pass (triggered the same opportunistic way) then downgrades the row to `done`. So
  "teardown after `AUTO_TEARDOWN_DELAY_MS`" is really "teardown after whichever of two independent
  clocks — a viewer showing up, or DatHost's own autostop — fires first," which is why
  `autostop_minutes: 3` matters as more than a billing safety net: it's the real backstop for the
  unwatched case. A periodic background reconcile (a real timer, not view-triggered) was considered and
  intentionally skipped as more machinery than this warranted.
- **Concurrency guard has a tiny check-then-claim window** (above) — a fully atomic claim would need a
  Postgres advisory-lock RPC, judged not worth it for the rarity.
- **Nightly reset (#132)** is DatHost-panel config, not code: a daily `css_endmatch` scheduled command
  + `autostop_minutes: 3` as the idle/billing backstop. Disk cleanup is a separate, code-side piece
  of the same issue — see [`infra/matchzy/README.md`](../infra/matchzy/README.md) for
  `scripts/dathost-cleanup.ts`, which the DatHost panel's command scheduler can't do since it only
  reaches in-game RCON, not the file manager.
