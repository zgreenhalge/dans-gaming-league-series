# Match Replay & Events

The 2D match replay and core-events list (issue #121). Every uploaded CS2 demo is turned into a
**`replay.json`** payload that drives two products, both surfaced as sub-tabs under the match page's
**Recap** tab (`MatchRecapTab.tsx`): an **Events** list (kills, plants, defuses, round ends) and a
**2D Replay** rendered in-browser by **`<ReplayPlayer>`** on a canvas, plus a map-level **Heatmap**
tab (see below) built from the same artifacts. This is a sibling pipeline to
[`demo-ingestion.md`](./demo-ingestion.md): that path parses **stats** (which need human review before
they write scores); this path parses **positions/events** (which need no review, so it runs fully
async in GitHub Actions). Both pipelines parse demos through the same library — see
[`demo-parsing-reference.md`](./demo-parsing-reference.md) for external/community knowledge about it
and the CS2 demo format.

## Why GitHub Actions, not Vercel

Full-tick parsing (`parseTicks` over every wanted tick) and any future render/encode work are too
heavy for a Vercel function on the request path, and real in-engine footage (HLAE/GPU) can't run on
free/serverless infra. So all heavy compute runs in **GitHub Actions** and the result lands in R2 at a
deterministic key; Vercel only **dispatches** jobs and **reads** the finished payload.

### Three actors

- **App (Vercel)** — serves the Recap tab (Events list + replay player) and the map Heatmap tab, and
  *dispatches* the GitHub jobs. No ffmpeg, no server canvas on the request path.
- **GitHub Actions** — all heavy compute (parse, render, radar extraction). See "Background jobs".
- **Client `<ReplayPlayer>`** — a canvas component that loads `replay.json` and plays it back
  interactively. The renderer.

## The `replay.json` contract

Locked as a typed schema in **`src/lib/replay/types.ts`** (`ReplayPayload`). Lock the shape there
before changing the extract code, the Action, or the player — they all contract against it. `REPLAY_SCHEMA_VERSION` is bumped on incompatible changes; the player refuses payloads it
doesn't understand.

Shape (see the types file for the authoritative, commented definition):

```
ReplayPayload {
  version, matchId, map, tickRate, frameRate,
  players: [{ id, name, faction, steamId }],
  rounds: [{
    round, startTick, endTick, isKnifeRound?,
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
> ended* (1-based), while mid-round events (`bomb_planted`, `bomb_defused`) carry rounds *completed so
> far*, so their round number is `total_rounds_played + 1`. The extract honors this split (same as the
> stats collectors). **Kills are the exception:** a `player_death` can land in the post-round window
> *after* `round_end` has already bumped the counter, so the `+1` math would misfile it into the next
> round (where its tick precedes the live frames and the kill feed never shows it). Kills are therefore
> bucketed by **tick** into the round whose playback window (incl. the post-round span) covers them.

**Knife round (gauntlet/knife matches only):** regular-season matches pre-decide sides via the
map-ban/pick draft, so any knife round the server still plays is vestigial and stays excluded from the
replay, same as it's excluded from the score (see `docs/demo-ingestion.md#match-start-skipping-warmup-and-stray-knife-rounds`).
Gauntlet/knife matches have no pre-decided side — the knife round is what decides it — so
`buildReplay()` is called with `includeKnifeRound: true` for them (`inputs.isGauntlet`, resolved by
`getReplayInputs()`) and the knife round is pulled back in as its own leading `ReplayRound` with
`isKnifeRound: true`. It doesn't count toward the score: its `round_end` event carries
`winnerFaction: null` (only the raw `winnerSide` is known — which faction that side belongs to isn't
decided yet) and it isn't in `context.rounds`, the source `buildRoundSides()`/side-split/score math
reads from. Its `sideByFaction` is **borrowed from round 1** purely so player dots keep a consistent
team color through the knife round rather than a meaningless default — it is not the round's real
side. The client (`ReplayPlayer.tsx`, `MatchRecapTab.tsx`) labels it "Knife Round" instead of a round
number.

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
he/flash are brief point pops. `draw.ts` renders the AoE in world units via `projector.scaleLength()`,
drawing smoke as a **soft cloud** (`drawSmokeCloud` — a dense core ringed by translucent puffs that
slowly rotate with the tick, `SMOKE_SPIN_RATE`) and
molotov/incendiary as **flickering fire** (`drawFire` — warm tongues whose size/alpha pulse with the
tick) so the two don't read as the same flat disc. HE/flash/decoy get **distinct glyphs** (burst /
ring+core / pulsing ring-dot). The planted bomb is a **C4 icon** (body + blinking light), not a dot;
when the round ends by `bomb` (the C4 detonates at the plant site on the `round_end` tick), `bombStateAt`
drops the icon and `bombExplosionAt` surfaces a brief **blast** (`drawExplosion` — expanding shock ring +
fireball) over the post-round window — both derived from the existing plant/round_end events, no schema
change. `detonateTick` is the tick the projectile reaches its **resting** position (not the last emitted
tick), so a smoke/fire blooms where and when it lands instead of late. In the kill feed, fire kills
(engine weapon `inferno`) are relabeled to the actual `molotov`/`incendiary` by matching the attacker's
most recent fire grenade (`killWeaponLabel`).

**Player status effects:** `blinds[]` (`player_blind`, with `blind_duration`) and `hurts[]`
(`player_hurt`) drive per-player overlays computed by `flashAt()` / `hurtAt()` and merged onto each
`ViewPlayer` in `viewStateAt` (alive players only). A flash whites the dot out fully and fades back to
team color over the blind duration; damage blinks it red over `HURT_BLINK_SECONDS` — fire ticks
re-trigger the blink for a steady burn. `draw.ts` paints these as fading alpha overlays on the dot
(red under, whiteout on top), so no CSS color parsing/blending is needed. The living player's dot also
encodes **remaining HP**: the team-colour fill rises from the bottom of the dot with `hp/100`
(`fillHpSegment`), leaving the missing chunk dimmed, so a hurt player reads as a partly-drained dot.

### Known limitations

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

## Client renderer

The 2D Replay sub-tab is `<ReplayPlayer>` (`src/components/ReplayPlayer.tsx`), a canvas component
loaded lazily with `ssr: false` (its payload fetch + RAF loop are browser-only). It fetches the full
payload from **`GET /api/matches/[id]/replay/payload`** — which streams the gzipped `replay.json`
straight from R2 with `Content-Encoding: gzip` — only when the user opens the sub-tab, so the
multi-MB payload never bloats the server-rendered match page (the Events tab keeps using the
stripped `getReplayEventsView` projection).

The render is split into **three pure, runtime-agnostic modules** so the browser player and any
future headless renderer can share one code path with **no draw drift**:

| Module | Responsibility |
|---|---|
| `src/lib/replay/project.ts` | world (x,y) → canvas px. `autoFitProjector` (fit the payload's bounding box; default) and `calibratedProjector` (a map's radar triplet) behind one `Projector` interface. `projectorFor()` picks. |
| `src/lib/replay/playback.ts` | `viewStateAt(round, tick, tickRate)` — interpolates positions between downsampled frames (shortest-path yaw lerp), reconstructs planted-bomb state from plant/defuse events, and resolves active grenades / tracers / kill-feed by tick window. No clock. |
| `src/lib/replay/draw.ts` | `drawScene()` — paints one moment onto a structural `Ctx2D` (the Canvas2D subset used), taking colors from a passed `ReplayTheme` — the player reads CSS vars, so a future non-DOM renderer would just pass its own theme. No DOM, no React. |

`<ReplayPlayer>` is the thin shell: a DPR-aware canvas sized by `ResizeObserver`, a RAF clock that
advances `tick` (auto-advancing across rounds), and the controls (play/pause, 0.5–4× speed, round
jump, scrubber). The scrubber is uncontrolled and synced imperatively each frame to avoid a
per-frame React re-render. It also accepts an optional `jump={{ round, n }}` prop: clicking a round
header in the Recap tab's **Events** timeline (`MatchRecapTab`) switches to the 2D Replay sub-tab and
jumps the player to that round (the `n` nonce lets a repeat click on the same round re-fire). The pure modules are unit-tested in `src/lib/replay/replay.test.ts`
(`npm test`).

## Heatmap tab

Kill/death/grenade locations on `/maps/[slug]`, respecting the season filter (shared with the rest
of the page) plus a CT/T side toggle and per-layer toggles, plotted via the shared `project.ts`
(real radar when calibrated, else auto-fit) over the `heatmap.json` artifacts each match's
`replay-extract` run produces — there is no separate Action for this. The aggregation is **lazy**:
`MapHeatmap` (with the shared `useMapRadar` hook) fetches the points only when the Heatmap tab
opens — it POSTs the map's match ids to `/api/maps/[slug]/heatmap`, which calls `getMapHeatmap()` to
fan out one R2 GET per match, so the map page never pays that fan-out on every render. `MapHeatmap`
then renders the density additively on a canvas, with grenades drawn as their effect area. (Decoys
are excluded from `heatmap.json` entirely — `buildHeatmapPoints()` skips them; they carry no signal
worth plotting and the tab has no decoy layer.)

`MapHeatmap` is reused in two more places (#128), both passing explicit match-id sets to the same
component/route: the **Recap tab**'s *Heatmap* sub-tab scopes it to the single match
(`matchIds={[matchId]}`), and the **Scouting Report**'s *Map Intel* sub-tab plots the picked map's
full history (`getMatchIdsForMap()` resolves the ids server-side, passed down through
`MatchTabView` → `ScoutingReport`). No new aggregation path — same lazy POST to
`/api/maps/[slug]/heatmap`.

> **Scaling note:** the per-match R2 fan-out is fine for current match counts but grows linearly. A
> precomputed per-map rollup (or a streamed response) is tracked in issue #127 for when it matters.

The player loads a map's calibration via `GET /api/maps/[slug]/calibration` + `…/radar` and switches
`projectorFor()` to the calibrated branch (auto-fit fallback when uncalibrated). There is no in-site
manual radar-calibration/correction UI — `radar-build`'s automated extraction from the workshop VPK
has proven accurate across the whole map pool (it calibrated the entire pool by running the Action
from the Actions UI), so one wasn't needed.

## Background jobs (GitHub Actions)

Three workflows, all triggered via `repository_dispatch` (from the app) or `workflow_dispatch`
(manual). They follow the generic job conventions in
[`github-actions.md`](./github-actions.md) (SHA-pinned actions, least-privilege `permissions:`,
`timeout-minutes`, the `stage()`/`background_jobs` state machine); this section covers what's
replay-specific.

| Action | Trigger | Output |
|---|---|---|
| **A — `replay-extract`** | auto, after demo upload/parse | `replay.json` **and** compact `heatmap.json` → R2 `<matchId>/…` (`.github/workflows/replay-extract.yml` + `scripts/replay-extract.ts`) |
| **A′ — `replay-extract-all`** | manual (Actions UI / dispatch) | re-runs A for **every** match with a demo, as a matrix (`replay-extract-all.yml` + `scripts/list-demo-matches.ts`) |
| **B — `radar-build`** | per map (Actions UI, or admin `POST /api/maps/[slug]/radar/dispatch`) | radar PNG → R2 `maps/<id>/radar.png` + `maps` row calibration (`radar-build.yml` + `scripts/radar-build.ts`) |

> **Backfilling a logic/schema change:** when the extract or heatmap output shape changes
> (e.g. the post-round-kill fix, or a future `HEATMAP_SCHEMA_VERSION` bump for per-player
> filtering), run **`replay-extract-all`** to re-extract existing artifacts. It enumerates
> matches with a `<id>/game.dem` in R2 (`list-demo-matches.ts`; `only_missing` skips ones
> that already have a `replay.json`) and fans out Action A as a `max-parallel: 3` matrix.
> The Action runs the dispatched ref's code, so dispatch it on the branch/`main` that has
> the fix.

### Stage lists

Each job's ordered `stage()` list (see [`github-actions.md`](./github-actions.md#conventions-every-job-follows)
for what stages are and how they're surfaced):

`replay-extract`: `validate → download-demo → decompress → parse-ticks → parse-events →
parse-grenades → assemble → gzip → upload → heatmap → done`. (`buildReplay()` does the three parse
stages plus `assemble` in one library pass; they're surfaced as ordered stages around that call for
progress. `heatmap` builds + uploads the `heatmap.json` points artifact.)

`radar-build`: `validate-workshop-id → steamcmd-download → extract-vpk → decode-vtex →
compute-calibration → upload-radar → upsert-map → done`. The deterministic parsing
(`parseOverview()`, `workshopIdFromUrl()` in `radar.ts`) is unit-tested; the SteamCMD/Source2Viewer
orchestration is best-effort and isolated — a choke leaves the map uncalibrated (auto-fit fallback),
never blocking playback.

## Schema

Schema lives directly in the Supabase dashboard, not migrations — the user maintains it there.
RLS stays **off** (consistent with the rest of the site); Actions write via the service-role key,
the app reads server-side. Outputs live at deterministic R2 keys, so there are **no URL columns on
`matches`** — derive the key from the match/map id.

**`matches`** — denormalized status cache for cheap match-page reads (mirrors the existing
`round_history`/`screenshot_url_*` precedent):

| Column | Type | Purpose |
|---|---|---|
| `replay_status` | text | `none\|queued\|running\|ready\|failed` — gates the Recap tab's Events/Replay sub-tabs |

**`maps`** — calibration columns (workshop link already present):

| Column | Type | Purpose |
|---|---|---|
| `radar_image_url` | text | R2 path to the extracted top-down radar PNG |
| `radar_pos_x`, `radar_pos_y` | real | world→image origin offset |
| `radar_scale` | real | world units per pixel |
| `radar_source` | text | `'vpk'` \| `'auto'` \| `'manual'` |

**`background_jobs`** — latest-run state only, NOT a log; shared with every other background-job
pipeline (`demo_ingest` — see [`hosting.md`](./hosting.md) — as well as `replay_extract`/`radar_build`):

| Column | Type | Notes |
|---|---|---|
| `id` | bigint pk | |
| `job_type` | text | `replay_extract\|radar_build\|demo_ingest` |
| `match_id` | fk → matches, null | target (extract) |
| `map_id` | fk → maps, null | target (radar_build) |
| `status` | text | `queued\|running\|succeeded\|failed\|canceled` |
| `stage` | text | current named stage |
| `error_message` | text | on failure |
| `gh_run_id` / `gh_run_url` | bigint / text | deep-link to the run |
| `requested_by` | fk → players, null | who triggered a manual dispatch |
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
