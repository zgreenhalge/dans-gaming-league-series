## Statistics

	Raw nukmbers, direct from the game scoreboard

	### Basic Stats
		K = Kills
		A = Assists
		D = Deaths
		Dmg = Damage
		Kill Difference = Kills - Deaths

	### Kill Stats
		K/D = Kills / Deaths
		Dmg/Kill = Damage / Kills
		K/R = Kills / Rounds played
		A/R = Assists/ Rounds played
		D/R = Deaths / Rounds played
		K/W = Kills / Wins
		D/W = Deaths / Wins
		K/L = Kills / Losses
		D/L = Deaths / Losses

	### Game Stats
		Games = Games played
		W-L = Wins "-" Losses
		WR% = Wins / Games played
		Rounds = Rounds played
		RW-L = Round wins - Round losses
		Round difference = Rounds won - Rounds lost
		RWR% = Round wins / Rounds played

	### Average Game Stats
		R/G = Rounds played / Games played
		RD/G = Round difference / Games played
		RW/G = Rounds won / Games played
		RL/G = Rounds lost / Games played
		KD/G = Kill Difference / Games played
		Dmg/Game = Damage / Games played
		K/G = Kills / Games played
		A/G = Assists / Games played
		D/G = Deaths / Games played

## Sabremetrics

	Baseball style metrics with deeper insights, in the vein of WAR, OPS, etc.

	```
	Skill Rating = 100
		+ 0.30(KPR+ - 100)
		+ 0.20(ADR+ - 100)
		+ 0.15(Entry+ - 100)
		+ 0.15(Trade+ - 100)
		+ 0.10(Objective+ - 100)
		+ 0.10(Clutch+ - 100)
		- Beer Tax
	```

	`KPR+ = Player KPR / League Avg KPR * 100`
	`ADR+ = Player ADR / League Avg ADR * 100`
	`Entry+ = Player Entry Value / League Avg Entry Value * 100`
		`Entry Value = Opening Kills - Opening Deaths`
	`Trade+ = Player KAST / League Avg KAST 100`
		`KAST = rounds with Kill, Assist, Survived, or Traded`
		`Trade Score = KAST - (Untraded Deaths * 10)`
	`Objective+ = Player Objective Score / League Avg Objective Score * 100`
		`Objective Score = (2 * Plants) + (3 * Defuses) + Flash Assists + (Utility Damage / 50)`
	`Clutch+ = Player Clutch Score / League Avg Clutch Score * 100`
		`Clutch Score = 1v1 wins + 2 * (1v2 wins w/ assist) + 3 * (1v2 wins w/o assist)`
	
	```
	Beer Tax = (Teamflash seconds)
		+ 5 * (Forgot to buy full util rounds)
		+ 5 * (Died with bomb in spawn)
		+ 10 * (Forgot to buy armor rounds)
		+ 15 * (Knife deaths attempted)
	```


## Narrative Metrics
	
	Metrics derived from pairing-specific data

	Friends Rating = 0.5 * (games / maxGames) ^ 2
	       + 0.3 * (winRate / maxWinRate) ^ 2
	       + 0.2 * (rwr / maxRwr) ^ 2

	games = Number of games played by the duo
	maxGames = Highest games of any duo in the league
	winRate = Games won by duo / Games played by duo
	maxWinRate = Highest winRate of any duo in the league
	rwr = Rounds won by duo / Rounds played by duo
	maxRwr = Highest rwr of any duo in the league
	
	Rival Rating = 0.5 * (games / maxGames) ^ 2
       + 0.3 * (1 - winDiff / maxWinDiff) ^ 2
       + 0.2 * (1 - roundDiffPerGame / maxRoundDiff) ^ 2

    games = Number of games played by the duo
	maxGames = Highest games of any duo in the league
	winDiff = |aWins - bWins|
	maxWinDiff = Highest winDiff of any rivals in the league
	roundDiffPerGame = |aRoundsWon - bRoundsWon| / games
	maxRoundDiff = Highest roundDiffPerGame of any rivals in the league