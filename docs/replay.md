# Match Replay & Events

The 2D match replay and core-events list (issue #121). Every uploaded CS2 demo is turned into a
**`replay.json`** payload that drives two products, both surfaced as sub-tabs under the match page's
**Recap** tab (`MatchRecapTab.tsx`): an **Events** list (kills, plants, defuses, round ends) and —
once Phase 2 lands — a **2D Replay** rendered in-browser by **`<ReplayPlayer>`** on a canvas (a
placeholder for now). An optional mp4 is produced on demand. This is a sibling pipeline to
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
- **Client `<ReplayPlayer>`** (Phase 2) — a canvas component that loads `replay.json` and plays it
  back interactively. The renderer.

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

### Known Phase-1 limitations

- **`frame.bomb` is always `null`.** Live per-tick bomb position requires tracking the C4 entity /
  carrier, which isn't wired yet. Plant/defuse **events** carry their own positions, so the Events tab
  and plant markers work; only the moving bomb dot is deferred. The schema field exists so adding it
  later is non-breaking.
- **Parser field names are validated by a real run.** Position/weapon prop names (`X`, `Y`, `yaw`,
  `health`, `is_alive`, `active_weapon_name`) and grenade fields are read defensively (`pick()` tries
  several candidate keys). The first real Action run against an uploaded demo is the validation step —
  watch the `assemble`-stage warnings.

## Background jobs (GitHub Actions)

Three workflows, all triggered via `repository_dispatch` (from the app) or `workflow_dispatch`
(manual). Conventions: pin actions to commit SHAs; minimal `permissions:`; secrets in GH Actions
secrets (R2 creds + Supabase service key + URL); `timeout-minutes` bound; idempotent (deterministic R2
keys, re-dispatch overwrites); run the same `src/lib/replay/*` code via `tsx`.

| Action | Trigger | Output | Status |
|---|---|---|---|
| **A — `replay-extract`** | auto, after demo upload/parse | `replay.json` → R2 `<matchId>/replay.json` | **Phase 1 — built** (`.github/workflows/replay-extract.yml` + `scripts/replay-extract.ts`) |
| **B — `radar-build`** | per map | radar PNG + calibration → R2 + `maps` row | Phase 3 — planned |
| **C — `replay-mp4`** | on demand ("Generate MP4") | `replay.mp4` → R2 `<matchId>/replay.mp4` | Phase 4 — planned |

### Observability

Each job declares an **ordered list of named stages**, reported two ways: collapsible GitHub logs
(`::group::`/`::notice::`/`::warning::`/`::error::`) AND `background_jobs.stage` (so the app shows
`stage X of N` + a "view logs" deep-link via `gh_run_url` without anyone opening Actions). A failure
records `status=failed`, the failing stage, and the message — no silent hangs.

`replay-extract` stages: `validate → download-demo → decompress → parse-ticks → parse-events →
parse-grenades → assemble → gzip → upload → done`. (`buildReplay()` does the three parse stages plus
`assemble` in one library pass; they're surfaced as ordered stages around that call for progress.)

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
| `<matchId>/replay.mp4` | on-demand render (Phase 4) |

Both `getR2Object()`/`putR2Object()` helpers live in `src/lib/r2.ts`.

## Required secrets / env

The Action needs these as **GitHub Actions secrets** (same values as the app's env): `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`,
`CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`. The app additionally needs a
**least-privilege token with `actions:write`** (fine-grained PAT or GitHub App) to dispatch the
workflow — see the dispatch endpoint.

## Phases

1. **`replay.json` schema (locked) + `replay-extract` Action + Events tab.** — *this deliverable.*
2. `<ReplayPlayer>` (client), calibration-free auto-fit + overlays + controls.
3. `radar-build` Action + admin calibration UI → real radar backgrounds.
4. On-demand `replay-mp4` Action + download UX (reuses the shared `drawFrame`).
