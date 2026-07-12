# Demo Ingestion

How an uploaded CS2 `.dem` file becomes match and sabremetric stats. This is the live in-app
ingestion path (distinct from the historical CSV pipeline in `ingestion/`). The formulas the parser
feeds are defined in [`calculations.md`](./calculations.md); the storage/route surface is summarized
in [`architecture.md`](./architecture.md). For external/community knowledge about the underlying
parsing library and the CS2 demo format itself, see
[`demo-parsing-reference.md`](./demo-parsing-reference.md).

## Pipeline

1. **Upload URL** — `POST /api/matches/[id]/demo/upload-url` mints a presigned **Cloudflare R2**
   PUT URL (via `getSignedUrl` over the S3-compatible client in `src/lib/r2.ts`). The object key is
   deterministic per match: `demoKey(matchId)` → `<matchId>/game.dem`. The caller must be in the
   match or an admin.
2. **Client upload** — the browser (`DemoUploadModal.tsx`, opened from `MatchTabView.tsx`) PUTs the
   `.dem` straight to R2 with the presigned URL. The file never passes through the Next.js server.
3. **Parse** — `POST /api/matches/[id]/demo/parse` fetches the object back from R2, decompresses if
   needed, and runs two parsers over the buffer:
   - `parseDemoFile()` (`src/lib/demoParser.ts`) — basic per-player stats (K/A/D, damage, ADR,
     rounds, win flags) plus warnings.
   - `parseDemoSabremetrics()` (`src/lib/demoOrchestrator.ts`) — the advanced sabremetric fields.
   The route returns the merged result for review; it does **not** write to the DB. The reviewed
   stats are persisted through the score-submission endpoint (`PATCH /api/matches/[id]/score`),
   which writes basics to `player_match_stats` and upserts the sabremetric rows into
   `player_match_sabremetrics` (keyed by `player_match_stats_id`).

Both parsers take the same inputs: the demo buffer, the resolved **roster**, `skins_starting_side`,
and the season's `target_win_rounds`. The roster (which Steam player maps to which DGLS player and
faction) is resolved server-side before parsing — see `parsers/rosterResolver.ts` (exact steam-id →
name → elimination fallback).

**Learning steam ids on confirm.** When a demo player is matched by the elimination fallback,
`rosterResolver.ts` emits a warning (`eliminationWarning()`) carrying the demo steam id + the roster
player it was matched to. The confirm forwards parser `warnings` to `PATCH /score`, which — **for an
admin confirm only**, and **only when exactly one** player was inferred — parses that warning and
writes the steam id/nickname onto the player (`applyEliminationSteamIds`), so future parses resolve
them by exact id. Guards: admin-gated (the warnings are client-supplied), single-elimination only,
and it skips if that steam id already belongs to another player. Best-effort — never blocks the score.

`skins_starting_side` is **optional**. When it's `null` (gauntlet/knife matches, which have no
stored side), the parser infers it from the demo — see "Starting-side inference" below — so those
matches still self-derive a score and stats with no manual entry.

## Reparsing an already-confirmed match

Demos are kept in R2 indefinitely (`demoKey(matchId)` is never deleted), so a match can be reparsed at
any time — most commonly to backfill fields from a sabremetric collector added after the match was
first confirmed. The admin match console (`/admin/matches`) offers a per-match **reparse demo** button
and a bulk **reparse all matches with demos** action; both re-dispatch `demo-ingest.yml`
(`POST /api/matches/[id]/demo/dispatch`) exactly as a first-time parse does.

The Action (`scripts/demo-ingest.ts`) treats a reparse of an already-scored match specially: if the
freshly derived score matches the match's existing `final_score`, it upserts the refreshed
sabremetrics directly (via `persistSabremetrics()`, shared with `PATCH /score`) and marks the job
`confirmed` — no staged review. If the derived score differs from the stored one, it falls through to
the normal staged-result flow so a human reviews and confirms it, the same as first-time ingestion.
This means a reparse can change sabremetric fields silently but can never silently change a match's
recorded score.

## Sabremetric collectors

`demoOrchestrator.ts` composes one collector per metric family, each in `src/lib/parsers/`:

| Module | Produces |
|---|---|
| `rosterResolver.ts` | Steam-id → DGLS player + faction resolution |
| `matchContext.ts` | Per-round/per-death context shared by the collectors |
| `roundSides.ts` | Which side (CT/T) each faction is on each round — see "Side splits" below |
| `accumulators.ts` | Per-side K/A/D/damage/headshot deltas from round-end accumulator ticks |
| `entry.ts` | Opening kills/deaths (`Entry+`) |
| `kast.ts` | KAST rounds + trade tracking (`KAST+`) |
| `multikill.ts` | Multikill rounds |
| `clutch.ts` | 1vN attempts/wins and 2v1 numbers-advantage attempts/wins (`Clutch+`, `Choke+`) |
| `utility.ts` | Flash assists, utility damage, teamflash/self-flash (`Utility+`) |
| `objectives.ts` | Bomb plants/defuses (`Objective+`) |
| `trades.ts` | Trade-kill/traded-death opportunity/attempt/success counts, sharing `kast.ts`'s trade window (`Trade+`) |
| `heGrenade.ts` | HE grenades thrown and enemy damage dealt (HE Damage/Throw) |
| `accuracy.ts` | Raw accuracy / head accuracy (AWP-excluded) from `weapon_fire`/`player_hurt` |
| `counterStrafe.ts` | Counter-strafe % from per-tick duck-state/position reads at rifle `weapon_fire` ticks |
| `sprayAccuracy.ts` | Spray accuracy within sequences of 3+ consecutive rifle shots |
| `smokes.ts` | CT-side smokes interfering with pushes, from `smokegrenade_detonate`/`_expired` + sampled enemy positions |
| `unusedUtility.ts` | Buy-menu value of grenades held at death (`Unused Util/Death`) |

## Match start (skipping warmup and stray knife rounds)

Both parsers derive rounds only from the live match. The live match begins at the last
`begin_new_match` tick (`findMatchStartTick()` in `parsers/matchContext.ts`); any `round_end` before
it is warmup or a knife round and is dropped by tick. This matters when a knife round is
**erroneously recorded as a live round** — the engine counts it as `total_rounds_played = 1` and
never resets its counter, so the real rounds carry numbers 2..N.

Survivors keep their engine `total_rounds_played` as their round identity — they are **not**
renumbered to 1..N — since round-death/hurt events and accumulator ticks are keyed by that same
number. The half-swap boundary, however, is computed relative to the *first surviving round*
(`buildRoundSides()` in `parsers/roundSides.ts`), not the raw engine number: the actual in-game
halftime swap lands after `regRoundsPerHalf` *real* rounds regardless of a stray knife round earlier
in the engine's counter, so comparing the raw engine number directly against the half-length would
move the boundary earlier by the knife round's shift and mislabel the round straddling it. The score,
per-player rounds, and the accumulator-based side splits (which diff cumulative counters that reset
at `begin_new_match`) all read from the post-start rounds, so a stray knife round no longer inflates
the score or corrupts the splits.

## Side splits (deterministic from the round-1 anchor)

CT/T splits are derived **deterministically** from faction (SHIRTS/SKINS), the starting side, and the
round number — the regulation half-swap and overtime (MR3) logic in `parsers/roundSides.ts` walks the
sides from that single round-1 anchor, with no per-round `team_num` reads. Per-round deltas come from
the engine's `ActionTrackingServices` accumulators in `parsers/accumulators.ts`. See
[`calculations.md`](./calculations.md#side-splits) for the exact rules.

### Starting-side inference

The anchor is `skins_starting_side` when stored. When it's absent (gauntlet/knife), `parsers/
sideInference.ts` reads `team_num` **once**, at the first live round's tick, and maps each resolved
player's side to their faction to decide which side SKINS started on (majority vote; falls back to the
inverse of SHIRTS if no SKINS player resolved). This is a single anchor read — not the fragile
per-round lookup the split logic deliberately avoids.

Precedence: **a stored side always wins** (it was entered deliberately); the demo only fills a missing
value. When a stored side and the demo disagree, the parser keeps the stored side and emits a warning,
which surfaces on the admin jobs dashboard (`/admin/jobs`) as a data-quality flag.

## Environment

The demo path needs Cloudflare R2 credentials (in addition to the standard env vars in the root
[`README.md`](../README.md)):

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_R2_ACCOUNT_ID` | R2 account — used to build the S3 endpoint |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 access key |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 secret key |
| `CLOUDFLARE_R2_BUCKET_NAME` | Bucket that holds uploaded `.dem` files |
