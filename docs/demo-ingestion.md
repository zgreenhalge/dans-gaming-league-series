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
first confirmed. The admin console's Manage → Match view offers a per-match **reparse demo** button
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
| `teamkill.ts` | Teamkills committed |
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
| `reload.ts` | Rounds dropped on reload, read from the discrete `weapon_reload` event (`Rounds Dropped/Reload`) |
| `weaponClasses.ts` | CS2 weapon → category (pistol/smg/rifle/sniper/shotgun) allowlist; also the gun/non-gun source of truth for `accuracy.ts`, shared with `weaponStats.ts`. `killWeaponCategory()` is the separate, wider mapping used for kills — it covers every kill weapon (melee/utility/other, not just guns) and must not be used for the accuracy allowlist |
| `economy.ts` | Per-round eco/force-buy/full-buy classification from `CCSPlayerPawn.m_unFreezetimeEndEquipmentValue` at each round's freeze-time-end |
| `weaponStats.ts` | Per-weapon-category and per-round-economy shot/accuracy/damage/rounds breakdowns, plus `collectMatchKills()` — flat per-kill fact rows for `match_kills` (see "Kill and round fact tables" below) |

## Weapon-class and round-economy breakdowns

Unlike every other collector above, `weaponStats.ts`'s two collectors — `collectWeaponClassStats()`
and `collectEconomyStats()` — don't feed a single per-player row in `SabFields`. Each produces
several bucketed rows per player (one per weapon category, or one per economy tier), persisted into
their own tables — `player_match_weapon_stats` and `player_match_economy_stats` — rather than
`player_match_sabremetrics`. `demoOrchestrator.ts` returns them as `ParsedDemoSabremetricsResult`'s
`weaponStats` field, alongside (not merged into) `sabremetrics`; `src/lib/demo/weaponStats.ts`
mirrors `demo/sabremetrics.ts`'s upsert-or-clear persistence shape, keyed the same way off
`player_match_stats_id` plus the bucket column (`weapon_category`/`economy_type`).

`rounds_played` means something different for the two breakdowns. For weapon class, it's the count
of distinct live rounds in which the player fired that category at least once — shot-triggered, same
as `shots_fired`/`shots_hit`. For economy, it's seeded directly from the round's own eco/force/full
classification, independent of whether the player fired a shot that round — an eco round the player
never fired in still counts as an eco round played.

## Kill and round fact tables

`match_kills` and `match_rounds` (see [`architecture.md`](./architecture.md)) are granular per-event
fact tables, not per-player pre-aggregates — one row per kill and one row per round, with aggregation
(kills-by-weapon, killed-by-weapon, category rollups, favorite weapon, round-win-%-by-side) done at
query time rather than baked into the persisted shape. This is a deliberate departure from the
`player_match_weapon_stats`-style pattern above: a new derived stat is a query change, not a new table.

- `collectMatchKills()` (`weaponStats.ts`) reads `player_death` events (parsed with a `weapon` field,
  unlike every other consumer of that event) and emits one `KillFactRow` per kill: round, attacker/
  victim/assister steamid, weapon, headshot/noscope/wallbang/blind-kill modifier flags, and whether it
  was a teamkill. `wallbang` is derived from the event's `penetrated` surface count (`penetrated > 0`);
  `headshot`/`noscope`/`blind_kill` (from `attackerblind`) are read straight off the event, same as
  `weapon`. It's simpler than the bucketed collectors above — a `player_death` row already carries both
  attacker and victim, so there's no fire/hurt reconciliation. Self-kills and teamkills are kept (not
  filtered out) so the table stays a genuine fact table; consuming queries decide whether to exclude them.
- `match_rounds` needs no new collector at all — `buildRoundSides()` (`roundSides.ts`) already computes
  `{ roundNumber, winnerSide, shirtsSide, winReason }` per live round for the CT/T sabremetric splits;
  `demoOrchestrator.ts` just maps `context.rounds` straight into `DemoMatchRound[]`. `winReason` comes
  from `round_end`'s `reason` field via `reasonToCondition()` (`roundSides.ts`), shared with the replay
  pipeline (`replay/extract.ts`) rather than each defining its own copy.
- `src/lib/demo/matchKills.ts` / `matchRounds.ts` persist via `replaceMatchRows()`
  (`src/lib/demo/factTables.ts`) — one generic delete-then-insert helper shared by both tables (and any
  future fact table), rather than each reimplementing the pattern `weaponStats.ts` established.
- Wired into the same two call sites as every other demo-derived stat: `matchScore.ts`'s
  `Promise.all` (score confirm) and `scripts/demo-ingest.ts`'s reparse fast path.

## Match start (skipping warmup and stray knife rounds)

Both parsers derive rounds only from the live match. The live match begins at the last
`begin_new_match` tick (`findMatchStartTick()` in `parsers/matchContext.ts`); any `round_end` before
it is warmup or a knife round and is dropped by tick. This matters when a knife round is
**erroneously recorded as a live round** — the engine counts it as `total_rounds_played = 1` and
never resets its counter, so the real rounds carry numbers 2..N.

Every other per-tick event (`player_death`, `player_hurt`, `weapon_fire`, ...) resolves its round the
same tick-gated way, not just `round_end`: `roundOf()`/`groupByRound()` (`parsers/_shared.ts`) reject
an event whose tick is before `matchStartTick`, in addition to checking its `total_rounds_played`
offset against the live rounds. The tick check matters on its own — MatchZy's round counter isn't
guaranteed to reset at `begin_new_match`, so a warmup-period event's offset can coincidentally match a
live round number and, without the tick check, get counted as that round's data by every collector
that reads it (`MatchContext` carries `matchStartTick` alongside `liveRounds` for exactly this).

A player can die at most once in a live round — `match_kills` enforces `unique (round, victim)` — so
`dedupeDeathEvents()` (`parsers/matchContext.ts`) drops any second `player_death` landing on the same
(round, victim) before any event-based collector sees the stream (`demoOrchestrator.ts` calls it once,
right after `buildMatchContext()`). A genuine duplicate there (as opposed to warmup noise, which the
tick check above already excludes) is a real anomaly — e.g. a duplicated event from the parser itself
— so it's recorded to `context.warnings`, which gates auto-commit (`evaluateAutoCommit()`), routing the
match to manual review instead of confirming with silently-dropped or double-counted events.

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
which surfaces on the admin console's Activity feed as a data-quality flag.

## Environment

The demo path needs Cloudflare R2 credentials (in addition to the standard env vars in the root
[`README.md`](../README.md)):

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_R2_ACCOUNT_ID` | R2 account — used to build the S3 endpoint |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 access key |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 secret key |
| `CLOUDFLARE_R2_BUCKET_NAME` | Bucket that holds uploaded `.dem` files |
