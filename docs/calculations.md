# Calculation Definitions

The formulas behind every stat and ranking shown on the site — raw scoreboard stats, side splits,
sabremetrics, the canonical regular-season and gauntlet rankings, and narrative (pairing) metrics.
See [`glossary.md`](./glossary.md) for the domain vocabulary and [`ehog.md`](./ehog.md) for the
separate match-outcome skill rating.

## Statistics

Raw numbers, direct from the game scoreboard

### Basic Stats

- K = Kills
- A = Assists
- D = Deaths
- Dmg = Damage
- Kill Difference = Kills - Deaths

### Kill Stats

- K/D = Kills / Deaths
- Dmg/Kill = Damage / Kills
- HS% = Headshot Kills / Kills — kill-only headshot rate, from the in-game scoreboard; distinct
  from the hit-based `Head Accuracy` sabremetric below (which counts every headshot *hit*, not
  just kills, and excludes the AWP)
- K/R = Kills / Rounds played
- A/R = Assists / Rounds played
- D/R = Deaths / Rounds played
- K/W = Kills in wins only / Wins (average kills per game when winning)
- D/W = Deaths in wins only / Wins (average deaths per game when winning)
- K/L = Kills in losses only / Losses (average kills per game when losing)
- D/L = Deaths in losses only / Losses (average deaths per game when losing)

### Game Stats

- Games = Games played
- W-L = Wins "-" Losses
- WR% = Wins / Games played
- Rounds = Rounds played
- RW-L = Round wins - Round losses
- Round difference = Rounds won - Rounds lost
- RWR% = Round wins / Rounds played

### Average Game Stats

- R/G = Rounds played / Games played
- RD/G = Round difference / Games played
- RW/G = Rounds won / Games played
- RL/G = Rounds lost / Games played
- KD/G = Kill Difference / Games played
- Dmg/Game = Damage / Games played
- K/G = Kills / Games played
- A/G = Assists / Games played
- D/G = Deaths / Games played

## Side Splits

CT/T splits for kills, deaths, assists, damage, and headshot kills are derived deterministically
from the roster's faction (SHIRTS/SKINS), the starting side, and the round number. The per-round side
logic never does per-tick `team_num` lookups. The starting-side **anchor** is `skins_starting_side`
when stored, and is otherwise inferred from a **single** round-1 `team_num` read when it isn't set
(gauntlet/knife) — stored always wins; see
[`demo-ingestion.md`](./demo-ingestion.md#starting-side-inference).

- **Regulation:** Rounds 1–`regRoundsPerHalf` (= `target_win_rounds - 1`) use starting sides;
  rounds `regRoundsPerHalf + 1`–`regRoundsPerHalf * 2` use swapped sides.
- **Overtime:** MR3 halves alternate starting from the regulation H2 sides. OT half 1 (odd) =
  reg H2 sides, OT half 2 (even) = reg H1 sides.
- A player's side each round is `sideForFaction(roundSideInfo, faction)`.

Per-round deltas are computed from the engine's `ActionTrackingServices` accumulators at each
round-end tick: `delta(round R) = value@roundEnd(R) − value@roundEnd(R−1)` (R=1 baseline 0).
Each delta is attributed to the player's side that round.

Implemented in `src/lib/parsers/roundSides.ts` (side map) and `src/lib/parsers/accumulators.ts`
(delta splitter).

## Sabremetrics

Baseball style metrics with deeper insights, in the vein of WAR, OPS, etc.

- `KPR+` = `Player K/R` / `League Avg K/R`
- `APR+` = `Player A/R` / `League Avg A/R`
- `DPR+` = `Player D/R` / `League Avg D/R`
- `KDR+` = `Player K/D` / `League Avg K/D`
- `ADR+` = `Player ADR` / `League Avg ADR`
- `Entry+` = `Player Opening Success Rate` / `League Avg Opening Success Rate`
  - `Opening Success Rate` = `Opening Kills` / (`Opening Kills` + `Opening Deaths`)
- `KAST+` = `Player KAST` / `League Avg KAST`
  - `KAST` = `Rounds with Kill, Assist, Survived, or Traded` / `Rounds played`
- `Trade+` = `Player Trade Kill %` / `League Avg Trade Kill %`
  - **Trade Kills** — from the perspective of the player who could avenge a teammate:
    - `Trade Kill Opportunities` = times a teammate died while this player was still alive and
      within 800 game units of the death (the chance to trade realistically existed — matching
      `Smokes Blocking Push`'s distance gate; adjust if a reparse run shows it needs tuning)
    - `Trade Kill Attempts` = opportunities where this player damaged the killer within the
      trade window
    - `Trade Kill Successes` = opportunities where this player killed the killer within the
      trade window — the same condition that qualifies a round as "Traded" for KAST
    - `Trade Kill %` = `Trade Kill Successes` / `Trade Kill Attempts`
  - **Traded Deaths** — the mirror, from the perspective of the player who died (tracked as its
    own raw stat; not currently folded into `Trade+`):
    - `Traded Death Opportunities` = times this player died while at least one teammate was
      still alive and within 800 game units (someone had a realistic chance to trade them)
    - `Traded Death Attempts` = opportunities where a teammate damaged the killer within the
      trade window
    - `Traded Death Successes` = opportunities where a teammate killed the killer within the
      trade window
    - `Traded Death %` = `Traded Death Successes` / `Traded Death Attempts`
  - In wingman there's exactly one teammate, so `Opportunities` degenerates to a single
    yes/no check per death rather than a count across a full side.
  - The trade window (currently 5s, `TRADE_WINDOW_SECONDS` in `src/lib/parsers/constants.ts`)
    is shared between KAST's `Traded` qualifier and the trade-kill/traded-death collector so
    the two can never disagree.
- `Objective+` = `Player Objective Score` / `League Avg Objective Score`
  - `Objective Score` = (2 * `Plants`) + (3 * `Defuses`)
- `Utility+` = `0.30 * Flash Assists+` + `0.30 * Utility Damage+` + `0.20 * Blocking Smokes+` +
  `0.20 * (2 - Teamflash+)` — a weighted average of four already-normalized `+` ratios (each vs.
  its own league-average rate per round, or per CT smoke thrown for `Blocking Smokes+`), the same
  way `Aim+` averages `Accuracy+`/`Head Accuracy+`/`Counter-Strafe+`, rather than a raw point score
  whose league average could land near zero and blow up the ratio. `Teamflash+` is "lower is
  better," so it's folded in inverted (`2 - Teamflash+`) to land on the same "1.00 = average" scale
  as the other three before weighting.
  - `Utility Damage` is CS2's own `m_iUtilityDamage` engine accumulator (`accumulators.ts`) — not
    a DGLS-computed sum — and has always combined HE grenade damage and Molotov/Incendiary damage
    to enemies (teamdamage/self-damage excluded natively). `HE Damage` (below) is a separate,
    HE-only event-based collector used for `HE Damage/Throw`, not a component `Utility Damage` is
    missing.
  - `Flash Assists` and `Enemies Flashed` only count blinds of **1.1s or longer** ("half-blind"
    exposure is excluded), matching Leetify's flash-effectiveness definition. `Blind Duration
    Dealt` is a raw, ungated exposure total with no half-blind gate and no role in `Utility Score`.
    `Teamflash Duration` is likewise a raw, ungated exposure total, but feeds `Utility+` as an
    inverted ratio, per above.
  - `Flash Assists` credits a **teammate's** kill on the blinded enemy within a fixed window
    after the blind expires (own kills excluded) — this is the scoreboard-style definition and
    keeps its name/meaning for continuity.
  - `Flashes Leading to Kill` follows Leetify's own wording ("if the flashed player then gets
    killed by you or a teammate"), which names no exact cutoff. This counts a death from the
    blind's start through **half the flash's own duration past its expiry** — not just the
    active-blind window — since a kill immediately after an enemy's vision clears is still
    meaningfully attributable to the flash. Counts a kill by anyone, including the flasher's own.
    `Utility+` keeps using `Flash Assists`, not `Flashes Leading to Kill`, unless the league
    decides otherwise.
  - `HE Damage/Throw` = `HE Damage` / `HE Thrown` — damage dealt to enemies by HE grenades
    (teamdamage and self-damage excluded), divided by HE grenades thrown.
  - `Unused Util/Death` = `Unused Util Value on Death` / `Deaths` — Leetify's "Unused Utility on
    Death": the buy-menu value (Valve's stable HE/Flash/Smoke/Molotov/Incendiary/Decoy prices) of
    grenades still held at the moment of death, summed across a player's deaths and averaged per
    death. Lower is better (utility bought and not used before dying). Read from demoparser2's
    "inventory" tick field one tick before death (the engine strips weapon services on the death
    tick itself), confirmed against a real DGLS demo; see `src/lib/parsers/unusedUtility.ts`.
    Tracked as its own raw stat, not folded into `Utility+`.
  - `Enemies Flashed/Flash` = `Enemies Flashed` / `Flashes Thrown`
  - `Avg Blind/Flash` = `Blind Duration Max Sum` / `Effective Flashes` — for each flash that
    blinded at least one enemy for 1.1s+, take the *longest* blind duration it caused (not the
    sum across every enemy hit); average that across all such flashes. A flash that only
    half-blinds (or misses) every enemy doesn't count as an effective flash. All enemies blinded
    by the same detonation are identified by sharing an (attacker, tick) pair, since there's no
    explicit flash-entity id on the underlying event.
- `Clutch+` = `Player Clutch Score` / `League Avg Clutch Score`
  - `Clutch Score` = `1v1 wins` + 3 * `1v2 wins`
- `Choke+` = `Player Choke Score` / `League Avg Choke Score` — lower is better (fewer/smaller
  blown advantages)
  - `Choke Score` = `1v1 losses` + 2 * `1v2 losses` + 5 * `2v1 losses`
  - `1v1/1v2 losses` = the mirror of `Clutch Score`'s wins: `Clutch Attempts - Clutch Wins` for
    each bucket.
  - `2v1 Attempts`/`2v1 Wins` — a `2v1 Attempt` is a numbers advantage: this player's side has
    **both** teammates alive against a single remaining enemy, and the round is decided from
    there. `2v1 losses` = `2v1 Attempts - 2v1 Wins`. Unlike a 1v1/1v2 clutch, a 2v1 advantage
    isn't attributable to a single "clutcher" — **both** players on the advantaged side are
    credited the attempt (and the win, if the round is won), since blowing a full-team numbers
    advantage is a shared failure, not one player's alone.
- `Aim+` = `0.35 * Accuracy+` + `0.40 * Head Accuracy+` + `0.25 * Counter-Strafe+` (each itself
  `Player X` / `League Avg X`, computed on `Accuracy`/`Head Accuracy`/`Counter-Strafe %` from the
  Mechanics section below). A weighted blend rather than a sum on a shared point-scale like
  `Utility Score` — these three are fairly orthogonal skills on different denominators (a great
  spray-controller isn't necessarily a good counter-strafer), so there's no principled single
  scale to weight them on directly. Once each is its own `1.00 = league average` ratio, blending
  them is apples-to-apples; the weights themselves reflect that landing headshots matters most,
  followed by raw accuracy, with counter-strafing weighted lowest of the three.
- `Spray+` = `Player Spray Accuracy` / `League Avg Spray Accuracy` — a standalone ratio, not folded
  into `Aim+`, since spraying and single-tapping are different enough mechanical skills to track
  separately.

### Mechanics (raw, ungated)

Raw accuracy stats derived straight from `weapon_fire`/`player_hurt` events. "Raw" because they
aren't gated on whether the enemy was actually spotted/visible (Leetify's "Accuracy (Enemy
Spotted)"); CS2's spotted mask (`m_bSpotted`) is known-flaky, so these ship ungated first per
`docs/demo-parsing-reference.md`'s guidance on that tradeoff. `Accuracy`, `Head Accuracy`, and
`Counter-Strafe %` feed `Aim+`; `Spray Accuracy` feeds `Spray+` — see below.

- `Shots Fired` = count of gun shots fired (guns only; grenade throws, knife, and C4 don't count).
- `Accuracy` = `Shots Hit` / `Shots Fired` — guns only; grenade throws, knife, and C4 don't count
  as "shots". Hits from grenades (HE, molotov/incendiary) are excluded from `Shots Hit` the same
  way.
- `Head Accuracy` = `Headshot Hits (excl. AWP)` / `Shots Hit (excl. AWP)` — hits landing on the
  head hitgroup, independent of whether the hit was a kill (distinct from the kill-only `HS%`
  above). AWP shots are excluded from both the numerator and denominator, matching Leetify's
  Headshot Accuracy definition exactly ("Excludes shots with AWP"); general `Accuracy` still
  includes the AWP, since Leetify only carves it out of this one stat.
- Shotguns firing multiple pellets per `weapon_fire` (and wallbang penetration hitting more than
  one player) mean `Shots Fired` and `Shots Hit` aren't a strict 1:1 shot-to-hit correspondence —
  an accepted imprecision of "raw" accuracy, not a bug.
- `Counter-Strafe %` = `Counter-Strafe Good Shots` / `Counter-Strafe Shots` — rifles only
  (`RIFLE_WEAPONS` in `src/lib/parsers/counterStrafe.ts`). A shot is eligible (`Counter-Strafe
  Shots`) if the shooter wasn't crouched (`m_bDucked`) at the moment of firing; it's "good" if
  their speed at that instant was under 34% of the weapon's current max speed
  (`m_flMaxspeed`, which already factors in the held weapon's speed penalty — no separate
  per-weapon speed table needed). This parser exposes no direct velocity read, so speed is
  derived from the position delta between the fire tick and one tick earlier.
- `Spray Accuracy` = `Spray Shots Hit` / `Spray Shots Fired` — rifles only, within sequences of
  3+ consecutive shots from the same weapon (a gap of 0.25s+ between shots starts a new
  sequence; taps and short bursts under 3 shots don't count at all). Reports the league's overall
  total, not a per-rifle breakdown — a per-rifle version would need per-weapon columns or a
  child table, deferred until that's actually wanted.
- `CT Smokes Blocking %` = `Smokes Blocking Push` / `CT Smokes Thrown` — CT-side only, matching
  the CT-only scope and percentage shape of Leetify's `[CT] Smokes That Stopped a Push` (a T-side
  smoke serves a different tactical purpose — covering a plant/retake, not stopping a push — and
  isn't counted). A CT smoke counts as "blocking" if an enemy came within `SMOKE_BLOCK_RADIUS`
  (180 game units, `src/lib/parsers/smokes.ts`) of the detonation position at some sampled point
  during the smoke's life — this approximates CS2's volumetric, irregularly-shaped smoke cloud
  with a circle at roughly its actual radius, rather than Leetify's much larger 800-unit proximity
  check. Paired from the
  `smokegrenade_detonate`/`smokegrenade_expired` events via a shared `entityid` (confirmed
  against a real DGLS demo); a smoke whose round ends before it expires falls back to the
  round's end tick. This is position-based, not a true visibility/render check — see
  `docs/demo-parsing-reference.md` for why that's out of scope. The raw `Smokes Blocking Push`
  count (not the `%`) also feeds `Utility+` — see above.

### Player Rating (not yet implemented)

A weighted sabremetric composite for individual performance. Independent from the
[EHOG skill rating](ehog.md), which is match-outcome-based (OpenSkill). Every underlying `+` stat
this formula references (`KPR+`, `ADR+`, `Entry+`, `Clutch+`, `Choke+`, `KAST+`, `Trade+`,
`Objective+`, `Utility+`, `APR+`, `DPR+`, `K/D+`) is already computed by demo ingestion and shown
live in `SabremetricsLeaderboardView.tsx`. The composite itself, combining these into one number,
hasn't been implemented yet.

```
Player Rating = 1.00
  + 0.30(KPR+ - 1)
  + 0.20(ADR+ - 1)
  + 0.10(Entry+ - 1)
  + 0.10(Clutch+ - 1)
  + 0.10(KAST+ - 1)
  + 0.10(Objective+ - 1)
  + 0.10(Utility+ - 1)
  + 0.10(APR+ - 1)
  - 0.10(DPR+ - 1)
```

#### Role ratings

```
Entry Rating = 1.00
  + 0.35(Entry+ - 1)
  + 0.20(KPR+ - 1)
  + 0.20(ADR+ - 1)
  + 0.15(KAST+ - 1)
  + 0.10(K/D+ - 1)
```

```
Anchor Rating = 1.00
  + 0.50(KPR+ - 1)
  + 0.40(Clutch+ - 1)
  + 0.15(ADR+ - 1)
  + 0.15(KAST+ - 1)
  + 0.10(Objective+ - 1)
  - 0.50(DPR+ - 1)
  - 0.20(Choke+ - 1)
```

```
Setup Rating = 1.00
  + 0.50(APR+ - 1)
  + 0.40(Utility+ - 1)
  + 0.10(Objective+ - 1)
  - 10 * Teamflash seconds
```

## Canonical Regular Season Ranking

The default sort order for every regular-season and career leaderboard: **WR% → RWR% → ADR**,
all descending. Applying all three keys in sequence avoids overweighting any single metric and
produces a stable, consistent ordering across views.

Implemented by `canonicalSort(rows)` in `src/lib/util.ts`. Use it everywhere regular-season or
career player rows are ranked — never sort by ADR alone.

## Canonical Gauntlet Ranking

The official finish order for a completed gauntlet season. Used by the leaderboard table on
gauntlet season pages and matches the podium displayed by `GauntletStandings`.

| Place | Condition |
|-------|-----------|
| 1st   | 2-0 record in the final round |
| 2nd   | 1-1 in the final round, higher RWR% (then ADR) across all final-round matches |
| 3rd   | 1-1 in the final round, lower RWR% (then ADR) across all final-round matches |
| 4th   | 0-2 in the final round |
| 5th+  | Eliminated before the final round; sorted by latest round reached (higher = better rank), tiebreak by wins in that round, then RWR%, then ADR in that round (all descending) |

Round reached is the primary axis: a player who advanced further always outranks one eliminated
earlier. The stat tiebreaks (RWR% then ADR) only order players *within* the same round, and are
always computed from the specific round in which the placement is decided, not from overall gauntlet
stats. ADR is round-weighted so it aggregates correctly across a round's matches.

`GauntletStandings` renders its podium straight from `canonicalGauntletRankMap()` — the standings and
the leaderboard table share the one ranking implementation.

Returns no ranking while the gauntlet is incomplete (final round not fully played).

Implemented by `canonicalGauntletRankMap(rounds)` in `src/lib/util.ts`. Pass the result as the
`canonicalRanking` prop to `LeaderboardTable` anywhere gauntlet leaderboards are ranked.

## Gauntlet Seeding Projection

A live preview, shown on an *ACTIVE* regular season's own leaderboard, of what the gauntlet bracket
would look like if built from the current standings today — before any gauntlet season exists.

Seed 1 is the canonical-sort leader, seed N the canonical-sort last place, same convention
`buildGauntletBracket(N)` itself uses. For a qualifier count `N` = the current leaderboard's length
(matching exactly what `tryBuildGauntletShape()` uses when it later builds the real bracket):

| Outcome | Condition |
|---------|-----------|
| Bye (gold) | The seed's bracket-entry slot is in a round after round 1 |
| Won't qualify (red) | The seed is in `buildGauntletBracket(N)`'s `drops` — too many qualifiers for this bracket size, so the bottom seeds don't fit |
| Playing round 1 | Everyone else — placed straight into a round-1 pod |

Every seed's projected round and pod are fully determined by `N` alone (no player-vs-player
uncertainty), so the leaderboard shows a text label (e.g. "R1 · Pod 2", "Final (Bye)") alongside the
row tint. Returns no projection for a qualifier count `buildGauntletBracket` doesn't support
(outside 4-20).

Implemented by `projectGauntletSeeding(qualifierCount)` in `src/lib/gauntlet-bracket.ts`, which maps
seeds to placements; `SeasonTabView.tsx` zips that against the current standings (already in
canonical-sort order) to key it by `player_id`, and passes the result as the `gauntletSeeding` prop
to `LeaderboardTable`.

## Narrative Metrics

Metrics derived from pairing-specific data

**Friends Rating** = 0.5 * (games / maxGames)² + 0.3 * (winRate / maxWinRate)² + 0.2 * (rwr / maxRwr)²

- `games` = Number of games played by the duo
- `maxGames` = Highest games of any duo in the league
- `winRate` = Games won by duo / Games played by duo
- `maxWinRate` = Highest winRate of any duo in the league
- `rwr` = Rounds won by duo / Rounds played by duo
- `maxRwr` = Highest rwr of any duo in the league

**Rival Rating** = 0.5 * (games / maxGames)² + 0.3 * (1 - winDiff / maxWinDiff)² + 0.2 * (1 - roundDiffPerGame / maxRoundDiff)²

- `games` = Number of games played by the duo
- `maxGames` = Highest games of any duo in the league
- `winDiff` = |aWins - bWins|
- `maxWinDiff` = Highest winDiff of any rivals in the league
- `roundDiffPerGame` = |aRoundsWon - bRoundsWon| / games
- `maxRoundDiff` = Highest roundDiffPerGame of any rivals in the league