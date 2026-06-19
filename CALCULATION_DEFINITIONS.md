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
from the roster's faction (SHIRTS/SKINS), the stored `skins_starting_side`, and the round number.
No per-tick `team_num` lookups are used.

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
  - `Trade Score` = `KAST` - (`Untraded Deaths` * 10)
- `Objective+` = `Player Objective Score` / `League Avg Objective Score`
  - `Objective Score` = (2 * `Plants`) + (3 * `Defuses`)
- `Utility+` = `Player Utility Score` / `League Avg Utility Score`
  - `Utility Score` = `Flash Assists` + (`Utility Damage` / 50)
- `Clutch+` = `Player Clutch Score` / `League Avg Clutch Score`
  - `Clutch Score` = `1v1 wins` + 3 * `1v2 wins`
- `Choke+` = `Player Choke Score` / `League Avg Choke Score`
  - `Choke Score` = `1v1 losses` + 2 * `1v2 losses` + 5 * `2v1 losses`

### Player Rating (aspirational — requires demo data)

A weighted sabremetric composite for individual performance. Independent from the
[EHOG skill rating](ehog/README.md), which is match-outcome-based (OpenSkill). These formulas
will be implemented once demo ingestion provides the underlying stats (Entry+, KAST+, etc.).

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
  - Beer Tax
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

#### Beer Tax

```
Beer Tax = (Teamflash seconds)
  + 5 * (Forgot to buy full util rounds)
  + 5 * (Died with bomb in spawn)
  + 10 * (Forgot to buy armor rounds)
  + 15 * (Knife deaths attempted)
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
| 2nd   | 1-1 in the final round, higher RWR% across all final-round matches |
| 3rd   | 1-1 in the final round, lower RWR% across all final-round matches |
| 4th   | 0-2 in the final round |
| 5th+  | Eliminated before the final round; sorted by latest round reached (higher = better rank), tiebreak by wins in that round then RWR% in that round (both descending) |

RWR% tiebreaks mirror the final-round logic throughout: it is always computed from the specific
round in which the placement is decided, not from overall gauntlet stats.

Returns no ranking while the gauntlet is incomplete (final round not fully played).

Implemented by `canonicalGauntletRankMap(rounds)` in `src/lib/util.ts`. Pass the result as the
`canonicalRanking` prop to `LeaderboardTable` anywhere gauntlet leaderboards are ranked.

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