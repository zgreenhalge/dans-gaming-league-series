import { LeaderboardRowWithId } from './types';

export interface AdvancedStats {
  killDiff: number;
  dmgPerKill: number;
  kPerRound: number;
  aPerRound: number;
  dPerRound: number;
  kPerWin: number;
  dPerWin: number;
  kPerLoss: number;
  dPerLoss: number;
  roundsLost: number;
  roundDiff: number;
  rPerGame: number;
  rdPerGame: number;
  rwPerGame: number;
  rlPerGame: number;
  kdPerGame: number;
  dmgPerGame: number;
  kPerGame: number;
  aPerGame: number;
  dPerGame: number;
}

export function computeAdvancedStats(row: LeaderboardRowWithId): AdvancedStats {
  const {
    total_kills: k,
    total_deaths: d,
    total_assists: a,
    total_damage: dmg,
    total_rounds_played: rp,
    total_rounds_won: rw,
    matches_won: mw,
    matches_lost: ml,
    matches_played: mp,
    kills_in_wins: kiw,
    deaths_in_wins: diw,
    kills_in_losses: kil,
    deaths_in_losses: dil,
  } = row;

  const rl = rp - rw;
  const kd = k - d;

  return {
    killDiff: mp > 0 ? kd : NaN,
    dmgPerKill: k > 0 ? dmg / k : NaN,
    kPerRound: rp > 0 ? k / rp : NaN,
    aPerRound: rp > 0 ? a / rp : NaN,
    dPerRound: rp > 0 ? d / rp : NaN,
    kPerWin: mw > 0 ? kiw / mw : NaN,
    dPerWin: mw > 0 ? diw / mw : NaN,
    kPerLoss: ml > 0 ? kil / ml : NaN,
    dPerLoss: ml > 0 ? dil / ml : NaN,
    roundsLost: mp > 0 ? rl : NaN,
    roundDiff: mp > 0 ? rw - rl : NaN,
    rPerGame: mp > 0 ? rp / mp : NaN,
    rdPerGame: mp > 0 ? (rw - rl) / mp : NaN,
    rwPerGame: mp > 0 ? rw / mp : NaN,
    rlPerGame: mp > 0 ? rl / mp : NaN,
    kdPerGame: mp > 0 ? kd / mp : NaN,
    dmgPerGame: mp > 0 ? dmg / mp : NaN,
    kPerGame: mp > 0 ? k / mp : NaN,
    aPerGame: mp > 0 ? a / mp : NaN,
    dPerGame: mp > 0 ? d / mp : NaN,
  };
}
