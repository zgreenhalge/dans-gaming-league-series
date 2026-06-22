# Match Replay & Events

The 2D match replay and core-events list (issue #121). Every uploaded CS2 demo is turned into a
**`replay.json`** payload that drives two products, both surfaced as sub-tabs under the match page's
**Recap** tab (`MatchRecapTab.tsx`): an **Events** list (kills, plants, defuses, round ends) and a
**2D Replay** rendered in-browser by **`<ReplayPlayer>`** on a canvas. An optional mp4 is produced on
demand. This is a sibling pipeline to
[`demo-ingestion.md`](./demo-ingestion.md): that path parses **stats** (which need human review before
they write scores); this path parses **positions/events** (which need no review, so it runs fully
async in GitHub Actions).

## Why GitHub Actions, not Vercel

Full-tick parsing (`parseTicks` over every wanted tick) and any future render/encode work are too
heavy for a Vercel function on the request path, and real in-engine footage (HLAE/GPU) can't run on
free/serverless infra. So all heavy compute runs in **GitHub Actions** and the result lands in R2 at a
deterministic key; Vercel only **dispatches** jobs and **reads** the finished payload.

### Three actors

- **App (Vercel)** — serves the Recap tab (Events list + replay player), the admin radar-calibration UI, and *dispatches*
  the GitHub jobs. No ffmpeg, no server canvas on the request path.
- **GitHub Actions** — all heavy compute (parse, render, radar extraction). See "Background jobs".
- **Client `<ReplayPlayer>`** — a canvas component that loads `replay.json` and plays it back
  interactively. The renderer.

## The `replay.json` contract

Locked as a typed schema in **`src/lib/replay/types.ts`** (`ReplayPayload`). Lock the shape there
before changing the extract code, the Action, the player, or the mp4 Action — they all contract
against it. `REPLAY_SCHEMA_VERSION` is bumped on incompatible changes; the player refuses payloads it
doesn't understand.

Shape (see the types file for the authoritative, commented definition):

```
ReplayPayload {
  version, matchId, map, tickRate, frameRate,
  players: [{ id, name, faction, steamId }],
  rounds: [{
    round, startTick, endTick,
    sideByFaction: { SHIRTS: 'CT'|'T', SKINS: 'CT'|'T' },
    frames:   [{ tick, players: [{ id, x, y, yaw, hp, alive, weapon }], bomb }],  // ~16 fps
    events:   [{ tick, type: 'kill'|'plant'|'defuse'|'round_end', … }],
    grenades: [{ type, throwerId, trajectory: [{tick,x,y,z}], detonateTick }],
    shots:    [{ tick, shooterId }],              // every weapon_fire → a tracer ray
    blinds:   [{ tick, playerId, duration }],     // player_blind → flash whiteout
    hurts:    [{ tick, playerId }],               // player_hurt → red damage blink
    bombCarrier: [{ tick, carrierId }],           // seed + pickups/drops (null = dropped)
  }]
}
```

`events[]` powers BOTH the Events tab and the in-player timeline — one file, two products. Wingman has
few players, so payloads are small (a few MB worst case, gzipped).

### Extract code

**`src/lib/replay/extract.ts`** → `buildReplay()`. Runtime-agnostic: the **same** module runs in-app
and in the Action via `tsx`, so there is no logic drift. It reuses the stats path's primitives —
`parseEvent`, `parseTicks`, `parseGrenades`, the roster resolver, and `buildMatchContext` (round
structure + CT/T-by-faction + tick rate). `src/lib/replay/inputs.ts` (`getReplayInputs()`) resolves
the roster/sides/target-rounds/map from the DB and is shared by the dispatch path and the Action
script, mirroring the roster assembly in `POST /api/matches/[id]/demo/parse`.

> **Round numbering gotcha:** `round_end` events carry `total_rounds_played` as the round that *just
> ended* (1-based), while mid-round events (`player_death`, `bomb_planted`, `bomb_defused`) carry
> rounds *completed so far*, so their round number is `total_rounds_played + 1`. The extract honors
> this split (same as the stats collectors).

**Freeze-time trim + post-round:** each round opens with ~15s of freeze/buy time where everyone
stands in spawn — dead air for a replay. The extract begins each round's frames only
`PRE_LIVE_SECONDS` (≈1s) before `round_freeze_end`, skipping the rest. This both tightens playback and
shrinks the payload. If a demo has no `round_freeze_end` events the full freeze time is kept (with a
warning). At the other end, frames continue `POST_ROUND_SECONDS` (≈7s) **past** `round_end` to show
the post-round, capped at the next `round_start` so they never bleed into the following round's
(trimmed) freeze. `ReplayRound.endTick` stays the `round_end` tick — events reference it — while
`frames`/`roundTickRange()` cover the extended window; grenades are bucketed over the extended range
too, so a smoke thrown at round end still blooms into the post-round.

**Tracers & grenade effects:** `shots[]` (one per `weapon_fire`, just `tick` + `shooterId`) drives a
faint tracer ray for **every bullet**. The event carries no impact point *and* its position/yaw props
are unreliable, so `shotTracersAt()` casts the ray from the shooter's **interpolated frame position**
along their current yaw at render time (skipping a shooter who isn't in-frame/alive) — no dependence on
fragile event props. Kills keep their own brighter attacker→victim tracer. Grenade detonations linger
and are sized per type in `GRENADE_EFFECT` (`playback.ts`): smoke blooms wide for ~18s,
molotov/incendiary burn ~7s with the incendiary covering a larger area, decoy lasts ~15s as a dot that
*pulses* (it pops gunshots intermittently — `activeGrenadesAt` gates its `fade` with a duty cycle), and
he/flash are brief point pops. `draw.ts` renders the smoke/fire AoE disc in world units via
`projector.scaleLength()`, gives HE/flash/decoy **distinct glyphs** (burst / ring+core / pulsing
ring-dot) so they read apart, and paints the planted bomb as a **C4 icon** (body + blinking light), not
a dot. `detonateTick` is the tick the projectile reaches its **resting** position (not the last emitted
tick), so a smoke/fire blooms where and when it lands instead of late.

**Player status effects:** `blinds[]` (`player_blind`, with `blind_duration`) and `hurts[]`
(`player_hurt`) drive per-player overlays computed by `flashAt()` / `hurtAt()` and merged onto each
`ViewPlayer` in `viewStateAt` (alive players only). A flash whites the dot out fully and fades back to
team color over the blind duration; damage blinks it red over `HURT_BLINK_SECONDS` — fire ticks
re-trigger the blink for a steady burn. `draw.ts` paints these as fading alpha overlays on the dot
(red under, whiteout on top), so no CSS color parsing/blending is needed.

### Known Phase-1 limitations

- **Bomb is tracked without reading the C4 entity.** `frame.bomb` stays `null` (per-tick C4 entity
  position isn't exposed by the parser). Instead `round.bombCarrier` holds carrier change-points:
  a round-start **seed** (who holds `weapon_c4` in `inventory` at the first rendered tick — one cheap
  `parseTicks` over just the per-round start ticks, not every tick) plus `bomb_pickup`/`bomb_dropped`
  changes. `bombStateAt()` resolves it — carried bombs ride the carrier's interpolated position, a
  dropped bomb sits where the carrier was at the drop tick, and a `plant` event takes priority once
  the bomb is down. Dropped position is therefore the drop-spot approximation (the carrier's location),
  not the physics-settled entity — accurate in essentially every real case.
- **Parser field names are validated by a real run.** Position/weapon prop names (`X`, `Y`, `yaw`,
  `health`, `is_alive`, `active_weapon_name`), grenade fields, and `player_blind`'s `blind_duration`
  are read defensively (`pick()` tries several candidate keys). The first real Action run against an
  uploaded demo is the validation step — `buildReplay()` returns `notices` (surfaced as `::notice`)
  with the **captured counts** (`N shots, M blinds, K hurts, …`) and `warnings` (surfaced as
  `::warning`) including an explicit one per array that comes back empty, so a drifted field name
  (which makes a fail-soft collector silently return nothing) is visible without opening the demo.
  `shots` deliberately avoids event position/yaw props (it stores only `tick` + `shooterId`) precisely
  because those were unreliable, and filters `weapon_fire` to firearms only (`isBulletWeapon`) so
  grenade throws and knife swings don't draw tracers.

## Client renderer (Phase 2)

The 2D Replay sub-tab is `<ReplayPlayer>` (`src/components/ReplayPlayer.tsx`), a canvas component
loaded lazily with `ssr: false` (its payload fetch + RAF loop are browser-only). It fetches the full
payload from **`GET /api/matches/[id]/replay/payload`** — which streams the gzipped `replay.json`
straight from R2 with `Content-Encoding: gzip` — only when the user opens the sub-tab, so the
multi-MB payload never bloats the server-rendered match page (the Events tab keeps using the
stripped `getReplayEventsView` projection).

The render is split into **three pure, runtime-agnostic modules** so the browser player and the
Phase-4 mp4 Action share one code path with **no draw drift**:

| Module | Responsibility |
|---|---|
| `src/lib/replay/project.ts` | world (x,y) → canvas px. `autoFitProjector` (fit the payload's bounding box; default) and `calibratedProjector` (a map's radar triplet; Phase 3) behind one `Projector` interface. `projectorFor()` picks. |
| `src/lib/replay/playback.ts` | `viewStateAt(round, tick, tickRate)` — interpolates positions between downsampled frames (shortest-path yaw lerp), reconstructs planted-bomb state from plant/defuse events, and resolves active grenades / tracers / kill-feed by tick window. No clock. |
| `src/lib/replay/draw.ts` | `drawScene()` — paints one moment onto a structural `Ctx2D` (the Canvas2D subset used), taking colors from a passed `ReplayTheme` (the player reads CSS vars; the mp4 Action hardcodes them). No DOM, no React. |

`<ReplayPlayer>` is the thin shell: a DPR-aware canvas sized by `ResizeObserver`, a RAF clock that
advances `tick` (auto-advancing across rounds), and the controls (play/pause, 0.5–4× speed, round
jump, scrubber). The scrubber is uncontrolled and synced imperatively each frame to avoid a
per-frame React re-render. It also accepts an optional `jump={{ round, n }}` prop: clicking a round
header in the Recap tab's **Events** timeline (`MatchRecapTab`) switches to the 2D Replay sub-tab and
jumps the player to that round (the `n` nonce lets a repeat click on the same round re-fire). The pure modules are unit-tested in `src/lib/replay/replay.test.ts`
(`npm test`).

## Background jobs (GitHub Actions)

Three workflows, all triggered via `repository_dispatch` (from the app) or `workflow_dispatch`
(manual). Conventions: pin actions to commit SHAs; minimal `permissions:`; secrets in GH Actions
secrets (R2 creds + Supabase service key + URL); `timeout-minutes` bound; idempotent (deterministic R2
keys, re-dispatch overwrites); run the same `src/lib/replay/*` code via `tsx`.

| Action | Trigger | Output | Status |
|---|---|---|---|
| **A — `replay-extract`** | auto, after demo upload/parse | `replay.json` **and** compact `heatmap.json` → R2 `<matchId>/…` | **built** (`.github/workflows/replay-extract.yml` + `scripts/replay-extract.ts`) |
| **B — `radar-build`** | per map (Actions UI / dispatch) | radar PNG → R2 `maps/<id>/radar.png` + `maps` row calibration | **built** (`radar-build.yml` + `scripts/radar-build.ts`); first real run validates the SteamCMD/Source2Viewer invocations |

> The mp4 render Action (originally Phase 4) was **dropped in favor of the map Heatmap
> tab**. Heatmaps need no separate Action — the extract Action emits the `heatmap.json`
> artifact (`buildHeatmapPoints()`), and the map page aggregates those small files.

### Observability

Each job declares an **ordered list of named stages**, reported two ways: collapsible GitHub logs
(`::group::`/`::notice::`/`::warning::`/`::error::`) AND `background_jobs.stage` (so the app shows
`stage X of N` + a "view logs" deep-link via `gh_run_url` without anyone opening Actions). A failure
records `status=failed`, the failing stage, and the message — no silent hangs.

`replay-extract` stages: `validate → download-demo → decompress → parse-ticks → parse-events →
parse-grenades → assemble → gzip → upload → heatmap → done`. (`buildReplay()` does the three parse
stages plus `assemble` in one library pass; they're surfaced as ordered stages around that call for
progress. `heatmap` builds + uploads the `heatmap.json` points artifact.)

`radar-build` stages: `validate-workshop-id → steamcmd-download → extract-vpk → decode-vtex →
compute-calibration → upload-radar → upsert-map → done`. The deterministic parsing
(`parseOverview()`, `workshopIdFromUrl()` in `radar.ts`) is unit-tested; the SteamCMD/Source2Viewer
orchestration is best-effort and isolated — a choke leaves the map uncalibrated (auto-fit fallback),
never blocking playback.

### No duplicate in-flight jobs

Defense-in-depth: (1) the UI disables the trigger while status is `queued`/`running`; (2) the
**dispatch endpoint** no-ops if a `queued`/`running` job already exists for `(job_type, match_id)` —
the real guard against double-clicks / multiple admins; (3) GH `concurrency` cancels an older run as a
backstop.

## DB changes

> The user maintains schema directly in the Supabase dashboard — these are **column/table adds to
> apply there**, not migrations. RLS stays **off** (consistent with the rest of the site); Actions
> write via the service-role key, the app reads server-side. Outputs live at deterministic R2 keys, so
> there are **no URL columns** — derive the key from the match/map id.

**`matches` — add two status enums** (denormalized cache for cheap match-page reads; mirrors the
existing `round_history`/`screenshot_url_*` precedent):

| Column | Type | Purpose |
|---|---|---|
| `replay_status` | text | `none\|queued\|running\|ready\|failed` — gates the Recap tab's Events/Replay sub-tabs |
| `mp4_status` | text | same lifecycle — gates the download control (Phase 4) |

**`maps` — add calibration columns** (Phase 3; workshop link already present):

| Column | Type | Purpose |
|---|---|---|
| `radar_image_url` | text | R2 path to the extracted top-down radar PNG |
| `radar_pos_x`, `radar_pos_y` | real | world→image origin offset |
| `radar_scale` | real | world units per pixel |
| `radar_source` | text | `'vpk'` \| `'auto'` \| `'manual'` |

**`background_jobs` — new table** (latest-run state only, NOT a log):

| Column | Type | Notes |
|---|---|---|
| `id` | bigint pk | |
| `job_type` | text | `replay_extract\|replay_mp4\|radar_build` |
| `match_id` | fk → matches, null | target (extract/mp4) |
| `map_id` | fk → maps, null | target (radar_build) |
| `status` | text | `queued\|running\|succeeded\|failed\|canceled` |
| `stage` | text | current named stage |
| `error_message` | text | on failure |
| `gh_run_id` / `gh_run_url` | bigint / text | deep-link to the run |
| `requested_by` | fk → players, null | who clicked (mp4) |
| `created_at`/`started_at`/`finished_at`/`updated_at` | timestamptz | |

**Retention is bounded by design — no cleanup job.** One row per `(job_type, match_id)` (and
`(job_type, map_id)` for radar), **upserted** on each dispatch — it holds only the latest run's state.
Add a **unique index on `(job_type, match_id)`** (the extract script upserts with
`onConflict: 'job_type,match_id'`). This bounds the table to ~`matches×2 + maps` rows forever and *is*
the dedup guard. GitHub retains full run history/logs (~90d) as the audit trail.

## R2 keys

| Key | Object |
|---|---|
| `<matchId>/game.dem` | uploaded demo (`demoKey()`) |
| `<matchId>/replay.json` | gzipped replay payload (`replayKey()`) |
| `<matchId>/heatmap.json` | gzipped compact heatmap points (`heatmapKey()`) |
| `maps/<mapId>/radar.png` | extracted top-down radar (`radarKey()`) |

Both `getR2Object()`/`putR2Object()` helpers live in `src/lib/r2.ts`.

## Required secrets / env

The Action needs these as **GitHub Actions secrets** (same values as the app's env): `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`,
`CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`. The app additionally needs a
**least-privilege token with `actions:write`** (fine-grained PAT or GitHub App) to dispatch the
workflow — see the dispatch endpoint.

## Phases

1. **`replay.json` schema (locked) + `replay-extract` Action + Events tab.** — **built.**
2. **`<ReplayPlayer>` (client), calibration-free auto-fit + overlays + controls.** — **built**
   (`project.ts` / `playback.ts` / `draw.ts` + the payload route; see "Client renderer").
3. **`radar-build` Action + calibration read path** — **built.** The Action extracts the radar +
   triplet from the workshop VPK; the player loads it via `GET /api/maps/[slug]/calibration` +
   `…/radar` and switches `projectorFor()` to the calibrated branch (auto-fit fallback when
   uncalibrated). The whole map pool was calibrated by running `radar-build` from the Actions UI. The
   originally-planned in-site admin trigger + manual calibration/correction UI were **not pursued** —
   the auto extraction proved accurate enough across every map, so they're unnecessary.
4. ~~On-demand `replay-mp4` Action~~ — **dropped** in favor of the **map Heatmap tab** — **built.**
   Kill/death/grenade locations on `/maps/[slug]`, respecting the season filter (shared with the rest
   of the page) + a CT/T side toggle + per-layer toggles, plotted via the shared `project.ts` (real
   radar when calibrated, else auto-fit) over the `heatmap.json` artifacts. The aggregation is
   **lazy**: `MapHeatmap` (with the shared `useMapRadar` hook) fetches the points only when the
   Heatmap tab opens — it POSTs the map's match ids to `/api/maps/[slug]/heatmap`, which calls
   `getMapHeatmap()` to fan out one R2 GET per match. The map page no longer pays that fan-out on
   every render. `MapHeatmap` then renders the density additively on a canvas, with grenades drawn
   as their effect area. (Decoys are excluded from `heatmap.json` entirely — `buildHeatmapPoints()`
   skips them; they carry no signal worth plotting and the tab has no decoy layer.)

   > **Scaling note:** the per-match R2 fan-out is fine for current match counts but grows linearly.
   > A precomputed per-map rollup (or a streamed response) is tracked in issue #127 for when it matters.
