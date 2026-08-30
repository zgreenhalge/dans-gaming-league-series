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

A player's side (CT/T) each round is derived deterministically from the roster's faction
(SHIRTS/SKINS), the starting side, and the round number. The per-round side logic never does
per-tick `team_num` lookups. The starting-side **anchor** is `skins_starting_side` when stored, and
is otherwise inferred from a **single** round-1 `team_num` read when it isn't set (gauntlet/knife) —
stored always wins; see [`demo-ingestion.md`](./demo-ingestion.md#starting-side-inference).

- **Regulation:** Rounds 1–`regRoundsPerHalf` (= `target_win_rounds - 1`) use starting sides;
  rounds `regRoundsPerHalf + 1`–`regRoundsPerHalf * 2` use swapped sides.
- **Overtime:** MR3 halves alternate starting from the regulation H2 sides. OT half 1 (odd) =
  reg H2 sides, OT half 2 (even) = reg H1 sides.
- A player's side each round is `sideForFaction(roundSideInfo, faction)`.

Implemented in `src/lib/parsers/roundSides.ts`, and persisted per round as `match_rounds.shirts_side`
(`winner_side`/`shirts_side` on that table, see [`architecture.md`](./architecture.md)).

**CT/T splits for kills, deaths, assists, and headshot kills** are derived at query time from
`match_kills`, resolving each kill's attacker/victim/assister side via `resolvePlayerSide()`
(`match_rounds.shirts_side` for that round + the player's fixed match `faction`) and summing with
`deriveSideSplitCounts()` (both `src/lib/queries/kills.ts`) — not collected during parsing.

**CT/T splits for damage** (`damage_ct`/`damage_t`) are still computed from the engine's
`ActionTrackingServices` accumulators at each round-end tick: `delta(round R) = value@roundEnd(R) −
value@roundEnd(R−1)` (R=1 baseline 0), each delta attributed to the player's side that round —
implemented in `src/lib/parsers/accumulators.ts`. Unlike the other split stats, damage has no
granular per-round per-side fact table to derive from instead.

**ADR by side** divides the side-filtered damage (`damage_ct`/`damage_t`) by the rounds *played on
that side*, not the player's total rounds played — `roundsPlayedBySide()` in `roundSides.ts` derives
that count from the same starting-side/half/OT schedule as the side map above, given only a rounds-played
total and `target_win_rounds`, with no per-round breakdown. The match scoreboard
(`MatchTabView.tsx`'s `Scoreboard`) is the one place ADR is side-filterable — it's the only scope
with a single match's `target_win_rounds` to derive a rounds-played-by-side denominator from. The
season/career Advanced Stats leaderboard's Sides sub-tab (`SabremetricsLeaderboardView.tsx`) filters
Kills/Assists/Deaths/Damage by side the same way (via the shared `splitStat()`,
`src/lib/queries/sabremetrics.ts`), but shows a dash for ADR instead of guessing a
rounds-played-by-side total across many matches; every other ADR/damage-per-round figure on the site
(season/career/gauntlet aggregates, sabremetrics `ADR+`, per-match rows) always divides total damage
by total rounds, with no side filter to narrow the denominator.

**Round win % by side** — unlike ADR-by-side, this *is* backed by a real per-round breakdown:
`match_rounds` stores `winner_side`/`shirts_side` per round for every demo-parsed match (see
[`architecture.md`](./architecture.md)). `aggregatePerSideStats()`/`aggregatePlayerSideStats()`
(`src/lib/mapSideStats.ts`) tally round wins/losses for CT and T directly from these rows — a round
counts for whichever side actually played it, correctly splitting across the halftime side swap,
rather than crediting a whole match to the side a team started on. `aggregatePlayerSideStats()` still
falls back to the coarser whole-match `rounds_won`/`rounds_played`-on-starting-side approximation for
a match with no parsed demo (no `match_rounds` rows). Surfaced as "Round Win%"/"RWR%" on the player
page's own Side stats table (`aggregatePlayerSideStats()`), and — via the shared `PerSideStatsTable`
component (`aggregatePerSideStats()`) — on Basic Stats' season/career/map Maps & Sides tab and
Advanced Stats' Sides sub-tab.

Basic Stats' own K/D/A/ADR columns are never side-filtered — they're the site's one always-accurate
all-time total regardless of a match's demo-parse status, and a CT/T filter would silently narrow a
subset of players' rows to demo-parsed-only data without saying so. The Sides sub-tab lives on
Advanced Stats instead, where "demo-backed" is already the tab's whole premise, so no such coverage
caveat is needed.

**Round win condition** — `match_rounds.win_reason` (elimination/bomb detonation/defuse/time
expired, see `RoundCondition`) is tallied by `aggregateWinConditions()`
(`src/lib/mapSideStats.ts`) into a count and share per condition across every round in scope. A
round with no recorded condition (a `match_rounds` row predating this column, or a parser miss) is
excluded rather than guessed into a bucket. Surfaced as "Round win condition" on the season/career/
map Maps & Sides tab, next to Score Distribution. This is a separate figure from the per-round icon
on the match page's round-history strip (`RoundHistoryEntry.condition`, driven by the denormalized
`matches.round_history` column populated at demo-parse time): both ultimately classify the same CS2
`round_end` reason, but `RoundHistoryStrip` shows one match's rounds individually while this
breakdown aggregates across every round in the current scope.

**Ninja** — a defuse win (`win_reason = 'defuse'`) with at least one T-side player still alive when
the round ended, from `deriveNinjaDefuseRounds()` (`src/lib/queries/kills.ts`): the bomb was
defused without ever being contested. Resolved by comparing each round's T-side roster (from
`player_match_stats.faction` + that round's `shirts_side`) against who actually died that round
(`match_kills`), and attached as `MatchRoundRow.ninja` by `getAllMatchRounds()` so `RoundOutcome`
consumers don't need their own kills/roster join. Surfaced as an extra row in the Round win
condition breakdown — a count of the `defuse` subset, not an additional slice of `total` (a defuse
round is already counted once via `defuse`; `ninja` isn't summed a second time).

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
    - `Trade Kill Opportunities` = times a teammate died while this player was still alive,
      within 360 game units of the death, and within 540 game units of the killer (the chance to
      both reach the fight and realistically engage the killer existed — two separate legs, since
      being near the body alone doesn't mean there was a shot at whoever's still standing; looser
      than `Smokes Blocking Push`'s `SMOKE_BLOCK_RADIUS`, which approximates a smoke cloud's much
      smaller physical size, not a gunfight distance)
    - `Trade Kill Attempts` = opportunities where this player damaged the killer within the
      trade window
    - `Trade Kill Successes` = opportunities where this player killed the killer within the
      trade window — the same condition that qualifies a round as "Traded" for KAST
    - `Trade Kill %` = `Trade Kill Successes` / `Trade Kill Attempts`
  - **Traded Deaths** — the mirror, from the perspective of the player who died (tracked as its
    own raw stat; not currently folded into `Trade+`):
    - `Traded Death Opportunities` = times this player died while at least one teammate was
      still alive, within 360 game units of the death, and within 540 game units of the killer
      (someone had a realistic chance to reach and engage the killer)
    - `Traded Death Attempts` = opportunities where a teammate damaged the killer within the
      trade window
    - `Traded Death Successes` = opportunities where a teammate killed the killer within the
      trade window
    - `Traded Death %` = `Traded Death Successes` / `Traded Death Attempts`
  - In wingman there's exactly one teammate, so `Opportunities` degenerates to a single
    yes/no check per death rather than a count across a full side.
  - The trade window (currently 5s, `TRADE_WINDOW_SECONDS` in `src/lib/parsers/constants.ts`) and
    the distance gate above (`computeTradeOpportunities()` in `src/lib/parsers/trades.ts`) are both shared
    between KAST's `Traded` qualifier and the trade-kill/traded-death collector, so a round can
    never count as `Traded` for KAST without also being a real `Trade Kill`/`Traded Death` success.
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
  - A player is credited a `1v1`/`1v2` attempt the moment they become the sole survivor on their
    side, bucketed by how many enemies are alive at that instant. Once an enemy count of 2 drops
    to 1 (an enemy dies) before the round ends, the round has also narrowed to a genuine 1-on-1
    duel — the player picks up a separate `1v1` attempt for that later phase on top of the `1v2`
    attempt already recorded. This is the norm, not an edge case: any 1v2 resolved by killing the
    two enemies at different moments (rather than both dying simultaneously to one grenade) feeds
    both buckets. Both attempts resolve win/loss off the same final round outcome, so a
    sequentially-won 1v2 contributes `3 + 1 = 4` to `Clutch Score`, not just `3`.
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
- `Teamkills` — a raw counter, not folded into any `+` formula: deaths where the attacker and
  victim share a side that round, credited to the attacker. Uses the same side check that
  excludes a teamkill from `Entry+`'s opening kills and `KAST+`'s kill qualifier, just counted here
  instead of discarded.
- `Rounds Dropped on Reload` — a raw counter, not folded into any `+` formula: bullets still in the
  magazine — and therefore wasted — when a player reloads before it's empty, summed across every
  `weapon_reload` event in a match (an empty-mag reload contributes 0). `Rounds Dropped/Reload` =
  `Rounds Dropped on Reload` / `Reloads` averages that wastefulness per reload, with the
  denominator counting every reload including clean ones. `weapon_reload` is a discrete game event
  (confirmed against a real DGLS demo, unlike most CS2 actions this codebase tracks), so the
  collector reads `Weapon.m_iClip1`/`Weapon.m_bInReload` at each event's own tick rather than
  periodic sampling — the pre-reload clip count is frozen for the whole reload window (can't fire
  mid-reload), so the event tick itself always lands inside it. See `src/lib/parsers/reload.ts`.
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

### Weapon-Class and Round-Economy Breakdowns

Per-player shot/accuracy/damage/rounds breakdowns bucketed along two independent dimensions,
neither folded into any `+` formula — raw splits of the same underlying counts as the Mechanics
section, sliced a different way. Stored in their own tables (`player_match_weapon_stats`,
`player_match_economy_stats`), not `player_match_sabremetrics`, since each player has several rows
(one per bucket) rather than one. See `src/lib/parsers/weaponStats.ts`.

- **Weapon** — `player_match_weapon_stats` stores one row per (player, match, exact weapon
  classname, e.g. `ak47`), gated by `WEAPON_CATEGORY` (`src/lib/parsers/weaponClasses.ts`, the full
  CS2 gun roster) the same way `accuracy.ts`'s shots-fired/hit gating is — a grenade, knife, or C4
  event is never bucketed at all. `Shots Fired`/`Shots Hit`/`Headshot Hits`/`Damage Dealt` are the
  same guns-only counts as the Mechanics section, split by which exact weapon fired or landed the
  shot. `Rounds Played` for a weapon is the count of distinct live rounds the player fired it in at
  least once — shot-triggered, like the other counts. The weapon-class rollup
  (`pistol`/`smg`/`rifle`/`sniper`/`shotgun`) shown in the Weapons sub-tab is *derived* from `weapon`
  at query time (`WEAPON_CATEGORY[weapon]`, `getAllWeaponClassStats()`/`getMatchWeaponClassStats()`
  in `src/lib/queries/weaponStats.ts`) rather than stored as its own column, the same
  store-the-fact/derive-the-category relationship `killWeaponCategory()` already has to
  `match_kills.weapon`.
- **Round economy** — `eco` (equipment value under $2000), `force_buy` ($2000-3499), or `full_buy`
  ($3500+), classified per player per round from their own
  `CCSPlayerPawn.m_unFreezetimeEndEquipmentValue` at that round's freeze-time-end — an individual
  read, not a team average (Wingman's 2-player sides make the two nearly equivalent anyway).
  `Rounds Played` for a tier is seeded directly from this classification, independent of whether the
  player fired a shot that round, unlike the weapon breakdown above — an eco round with zero shots
  fired still counts as an eco round played.

### Kills by Weapon

Unlike the breakdowns above, kills-by-weapon is bucketed by *individual weapon* (`ak47`, `awp`,
`knife`, …), not category, and isn't pre-aggregated at all — `match_kills` (see
[`architecture.md`](./architecture.md)) stores one row per kill, and
`Kills`/`Headshot Kills`/`No-scope Kills`/`Wallbang Kills`/`Blind Kills`/`Midair Kills`/`Deaths` per
weapon are grouped from those rows at query time (`aggregateWeaponKillStats()`,
`src/lib/queries/kills.ts`). A kill only counts toward `Kills` and its modifier counts when the
attacker is a known roster player, the attacker isn't the victim, and it isn't a teamkill
(`is_teamkill = false`); `Deaths` counts every recorded death to that weapon regardless, including
self-kills and teamkills, so the victim side of the breakdown always reflects what actually killed
the player.

Grouping is by `weaponGroupKey()` (`src/lib/parsers/weaponClasses.ts`), not the raw
`match_kills.weapon` string directly — every knife/bayonet skin CS2 reports (`bayonet`,
`knife_karambit`, `knife_m9_bayonet`, …) collapses to one `knife` bucket, so a player's knife kills
show as a single combined row instead of splitting across cosmetic skin names. Every other weapon
keeps its own key. Display text throughout the Weapons sub-tab (`weaponDisplayName()`) maps that key
to the CS2 buy-menu name players expect (`AK-47`, `USP-S`, `Desert Eagle`, …) rather than the raw
backend classname; an unrecognized key falls back to a title-cased version of itself.

`No-scope Kills` is a sniper-rifle kill fired without the scope up (`noscope`); `Wallbang Kills` is a
kill whose bullet penetrated a surface — wall, door, etc. — before landing (`wallbang`, derived from
the demo's `penetrated` surface count); `Blind Kills` is a kill where the attacker was flashed at the
moment of the kill (`blind_kill`). All three are booleans read straight off the CS2 `player_death`
event, same as `headshot`.

`Midair Kills` (`midair`) is a kill where the attacker was airborne — jumping, not touching a
surface — at the moment of the kill. Unlike the other modifiers, this isn't a `player_death` field:
`collectMidairAttackers()` (`src/lib/parsers/matchContext.ts`) reads the attacker's own
`is_airborne` tick state at the kill's exact tick via one `parseTicks()` call, since a kill's tick
isn't guaranteed to land on any other already-sampled tick set. Shared by the stats path
(`collectMatchKills()`) and the replay path (`extract.ts`'s `collectEvents()`) so it's computed
identically in both.

**Category rollup** (`aggregateKillCategoryStats()`) sums individual-weapon rows up by the same
category `killWeaponCategory()` (`src/lib/parsers/weaponClasses.ts`) resolves each weapon to — reusing
the weapon-class breakdown's category set for guns (`pistol`/`smg`/`rifle`/`sniper`/`shotgun`) plus
`melee` (knife), `utility` (grenades, molotov/incendiary, taser), and `other` for anything else
(bomb/world). This is a distinct, wider mapping from `WEAPON_CATEGORY` (guns-only, used by
`accuracy.ts`'s shots-fired/hit gating) — `killWeaponCategory()` must never be used for that gate,
since every kill weapon needs a bucket but only guns count toward accuracy.

**Favorite weapon** (`favoriteWeapon()`) is simply the weapon with the most credited kills in scope.

The Weapons sub-tab shows one filter selection's row per player at a time, picked by
`resolveWeaponFilterStat()` against a `WeaponFilter` — a real 3-way union (`kills.ts`), not an
encoded string: each player's own favorite (`{kind: 'favorite'}`), one specific weapon (`{kind:
'weapon', weapon}`, chosen from `allWeaponsWithKills()` — every weapon with at least one credited
kill in the current scope, sorted by total kills descending, already grouped so knives appear
once), or a whole category (`{kind: 'category', category}`, one of `KILL_WEAPON_CATEGORIES`,
rolled up through `aggregateKillCategoryStats()`). Only the filter `<select>` itself
(`WeaponFilterSelect`, `SabremetricsLeaderboardView.tsx`) ever encodes a `WeaponFilter` to a string,
to satisfy the HTML control's own string-valued API — every other consumer works with the union
directly. A specific-weapon or category selection with no kills/deaths in scope still renders a
zeroed row rather than being hidden, so the filter always shows every player.

Every resolved row also carries that same selection's `player_match_weapon_stats` accuracy —
`WeaponFilterStat.accuracy` (`kills.ts`), resolved by the same `resolveWeaponFilterStat()` call from
a `PlayerWeaponAccuracy` (`groupWeaponAccuracyByPlayer()`, `src/lib/queries/weaponStats.ts` — one
grouping pass over `weaponClassStats` per render, keyed by both weapon and category, so a
multi-player table looks each row up in O(1) rather than rescanning per player). `accuracy` is
`null` only when the *selection itself* has no such concept at all — a melee/utility/other weapon
or category, since CS2 tracks no shots-fired for a knife swing or grenade throw — never merely
because the count happens to be zero (a gun a player didn't fire in scope still resolves a real
zeroed `WeaponClassAggregateStat`). The two cases render differently: the Weapons sub-tab's table
shows `—` in the accuracy columns for `null`; its single-player tile view omits the five accuracy
tiles entirely rather than showing them zeroed. A `favorite` selection is the one case where
`accuracy` isn't uniform across rows in the same table — each player's own favorite weapon differs,
so one player's row might show real accuracy while another's (favorite is a knife) shows `—`.

### Flair

The Flair sub-tab surfaces the off-meta kill counts on their own, totaled across every weapon rather
than broken out per-weapon like the Weapons sub-tab (`aggregateFlairKillStats()`,
`src/lib/queries/kills.ts`): `No-scope`, `Wallbang`, `Blind`, and `Midair` sum the same-named
counters from `aggregateWeaponKillStats()` across all of a player's weapons; `Knife` is
`aggregateKillCategoryStats()`'s `melee` category total (knives/bayonets), not a separate collector.

It's also the home for the `other` category's two uncredited-death counts, `Fall Deaths` and
`C4 Deaths` — a `world` (fall damage/environmental) or `planted_c4` (bomb detonation) death never
has a real player attacker (`killWeaponCategory()`), so it's structurally a Deaths-only stat with no
Kills to show; the Weapons sub-tab's category filter hides `other` for exactly that reason
(`HIDDEN_CATEGORY_FILTERS`, `SabremetricsLeaderboardView.tsx`) rather than rendering an always-zero
Kills row. `aggregateFlairKillStats()` reads each cause's `deaths` straight off its own
`weaponGroupKey()` bucket (`world`, `planted_c4`) instead of through `aggregateKillCategoryStats()`'s
merged `other` total, so the two causes stay distinguishable in the UI.

### Economy

The Economy sub-tab shows one round-buy tier's row per player at a time
(`aggregateEconomyStats()`/`resolveEconomyStat()`, `src/lib/queries/weaponStats.ts`), over the three
fixed tiers (`eco`/`force_buy`/`full_buy`, see [`demo-ingestion.md`](./demo-ingestion.md)), always
picked explicitly by the tier dropdown — unlike the Weapons sub-tab's favorite-or-specific picker,
there's no "most played" default, since full-buy rounds dominate most matches and a "most played"
default would just resolve to full-buy for nearly every player anyway. Since the tier set is fixed
and game-defined rather than derived from what a player happened to use, a tier with no rounds
played still renders a zeroed row rather than being hidden or omitted from the picker. The selected
tier is named once by the dropdown, not repeated as its own column — every other column's tooltip
names it instead (e.g. "Rounds played at Full Buy"). `Damage/Round` =
`damage_dealt / rounds_played` for the resolved tier — `rounds_played` is seeded from the round's
own economy classification, not shot-triggered, so it includes rounds the player never fired a shot
in. `W-L` = `rounds_won` – (`rounds_played` - `rounds_won`) — `rounds_won` comes from
`getEconomyRoundWins()` (`src/lib/queries/weaponStats.ts`), which joins `match_round_economy`'s
per-round tier to that round's own winner (`match_rounds`) via the player's side that round
(`faction` + `shirts_side`); `player_match_economy_stats` itself only sums `rounds_played`, not how
many of those were won, so this is a separate round-level join rather than a stored column. Surfaced
on the player/statistics/season pages (season-scoped `getAllEconomyStats()`) and the match page
(`getMatchEconomyStats()`), the same season/match split `getAllWeaponClassStats()`/
`getMatchWeaponClassStats()` use for the Weapons sub-tab.

`AggregatedSab` (`aggregateRows()`, `src/lib/queries/sabremetrics.ts`) carries `kills`/`deaths`/
`assists`/`damage`/`headshot_kills` as merged totals *and* their raw `_ct`/`_t` halves side by side
— the merged fields are simply the two halves summed, not a separately-tracked value. There is no
sabremetrics sub-tab showing the `_ct`/`_t` halves at season/career grain; the same underlying split
is only surfaced per-match, via the box score's CT/T checkboxes (`MatchTabView.tsx`'s `Scoreboard`),
which toggle which side's numbers replace the merged column for that one match.

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

The default sort order for every regular-season and career leaderboard: **Wins → RWR% → ADR**,
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
| 5th+  | Eliminated before the final round; sorted by latest round reached (higher = better rank), tiebreak by win rate in that round, then RWR%, then ADR in that round (all descending) |

Round reached is the primary axis: a player who advanced further always outranks one eliminated
earlier. The stat tiebreaks (RWR% then ADR) only order players *within* the same round, and are
always computed from the specific round in which the placement is decided, not from overall gauntlet
stats. ADR is round-weighted so it aggregates correctly across a round's matches.

`GauntletStandings` renders its podium straight from `canonicalGauntletRankMap()` — the standings and
the leaderboard table share the one ranking implementation.

Returns no ranking while the gauntlet is incomplete (final round not fully played).

Implemented by `canonicalGauntletRankMap(rounds)` in `src/lib/gauntlet-ranking.ts`. Pass the result as the
`canonicalRanking` prop to `LeaderboardTable` anywhere gauntlet leaderboards are ranked.

## Gauntlet Seeding Projection

The gold-bye/red-drop row tint on a regular season's own leaderboard — never shown on a gauntlet
season's own leaderboard, which gets a podium once complete instead (`GauntletStandings`) and has
nothing worth tinting rows for before then. Sourced one of two ways, in preference order, both
feeding the same `gauntletSeeding` prop on `LeaderboardTable`:

- **Real bracket, if the paired gauntlet has one.** Once the paired gauntlet season has a real,
  materialized bracket (`getGauntletBracketShape()`), the tint is read straight off it, regardless of
  either season's status — a player whose only seed-sourced pod slot lands in the final pod itself
  has a real bye (gold). A seed-sourced slot in an intermediate round (later than round 1 but not the
  final) still plays that round, so it isn't a bye. This reflects reality even if the bracket was
  hand-edited away from the shape `buildGauntletBracket()` would have produced (see the Gauntlet
  Bracket Generation section below for what "hand-edited" can mean here) — a real bracket is never
  wrong to prefer over a guess. There's no "won't qualify" case in this source, since a gauntlet's own
  bracket only ever contains players who already qualified into it. `SeasonTabView.tsx` reads this
  directly off `gauntletBracketShape`.

- **Live projection, otherwise.** While the regular season is still *ACTIVE* and no real bracket
  exists yet, a live preview of what the gauntlet bracket would look like if built from the current
  standings today. Seed 1 is the canonical-sort leader, seed N the canonical-sort last place, same
  convention `buildGauntletBracket(N)` itself uses. For a qualifier count `N` = the current
  leaderboard's length (matching exactly what `tryBuildGauntletShape()` uses when it later builds the
  real bracket):

  | Outcome | Condition |
  |---------|-----------|
  | Bye (gold) | The seed's bracket-entry slot is the final pod itself |
  | Won't qualify (red) | The seed is in `buildGauntletBracket(N)`'s `drops` — too many qualifiers for this bracket size, so the bottom seeds don't fit |
  | Playing round 1 (or an intermediate round) | Everyone else — placed straight into a round-1 pod, or (in the N≤7 rest ladder / N=12 shapes) into an intermediate round it still has to play |

  Every seed's projected round and pod are fully determined by `N` alone (no player-vs-player
  uncertainty). Returns no projection for a qualifier count `buildGauntletBracket` doesn't support
  (outside 4-20). Implemented by `projectGauntletSeeding(qualifierCount)` in
  `src/lib/gauntlet-bracket.ts`, which maps seeds to placements; `SeasonTabView.tsx` zips that
  against the current standings (already in canonical-sort order) to key it by `player_id`.

Once the regular season itself is archived, medal tinting (`showMedals`) still only takes over when
neither source above has data — matching the general LeaderboardTable rule that seed tinting always
wins over medal tinting when both are available.

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