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
- K/W = Kills / Wins
- D/W = Deaths / Wins
- K/L = Kills / Losses
- D/L = Deaths / Losses

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

## Sabremetrics

Baseball style metrics with deeper insights, in the vein of WAR, OPS, etc.

- `KPR+` = `Player K/R` / `League Avg K/R` * 100
- `APR+` = `Player A/R` / `League Avg A/R` * 100
- `DPR+` = `Player D/R` / `League Avg D/R` * 100
- `KDR+` = `Player K/D` / `League Avg K/D` * 100
- `ADR+` = `Player ADR` / `League Avg A/R` * 100
- `Entry+` = `Player Entry Value` / `League Avg Entry Value` * 100
  - `Entry Value` = `Opening Kills` - `Opening Deaths`
- `Trade+` = `Player KAST` / `League Avg KAST` * 100
  - `KAST` = `Rounds with Kill, Assist, Survived, or Traded` / `Rounds played`
  - `Trade Score` = `KAST` - (`Untraded Deaths` * 10)
- `Objective+` = `Player Objective Score` / `League Avg Objective Score` * 100
  - `Objective Score` = (2 * `Plants`) + (3 * `Defuses`) + 
  `Utility+` = `Player Utility Score` / `League Avg Utility Score` * 100
  - `Utility Score` = `Flash Assists` + (`Utility Damage` / 50) 
- `Clutch+` = `Player Clutch Score` / `League Avg Clutch Score` * 100
  - `Clutch Score` = `1v1 wins` + 2 * `1v2 wins w/ assist` + 3 * `1v2 wins w/o assist`
- `Choke+` = `Player Choke Score` / `League Avg Choke Score` * 100
  - `Choke Score` = `1v1 losses` + 2 * `1v2 losses` + 5 * `2v1 losses`

```
E-HOG = 100
  + 0.30(KPR+ - 100)
  + 0.20(ADR+ - 100)
  + 0.10(Entry+ - 100)
  + 0.10(Clutch+ - 100)
  + 0.10(Trade+ - 100)
  + 0.10(Objective+ - 100)
  + 0.10(Utility+ - 100)
  + 0.10(APR+ - 100)
  - 0.10(DPR+ - 100)
  - Beer Tax
```

```
Entry Rating = 100
  + 0.35(Entry+ - 100)
  + 0.20(KPR+ - 100)  
  + 0.20(ADR+ - 100)
  + 0.15(Trade+ - 100)
  + 0.10(K/D+ - 100)
```

```
Anchor Rating = 100 
  + 0.50(KPR+ - 100)
  + 0.40(Clutch+ - 100)
  + 0.15(ADR+ - 100)
  + 0.15(Trade+ - 100)
  + 0.10(Objective+ - 100)
  - 0.50(DPR+ - 100)
  - 0.20(Choke+ - 100)
```

```
Setup Rating = 100
  + 0.50(APR+ - 100)
  + 0.40(Utility+ - 100)
  + 0.10(Objective+ - 100)
  - 10 * Teamflash seconds

```

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