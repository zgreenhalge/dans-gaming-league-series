import { rate, rating } from 'openskill';
import { plackettLuce } from 'openskill/models';

// Mirror ehog/engine.py constants — single source of truth for the TS side
export const MU_DEFAULT = 25.0;
export const SIGMA_DEFAULT = 8.3333333333;
export const BETA = SIGMA_DEFAULT * 0.5;
export const CREDIBILITY_EXPONENT = 1;
const WEIGHT_MIN = 0.1;
const WEIGHT_MAX = 0.9;
const EHOG_FLOOR = 10.0;
const EHOG_CAP_KNEE = 0.85;
const EHOG_POWER = 2;

function toEhog(raw: number): number {
  const x = Math.log1p(Math.exp(raw));
  return EHOG_FLOOR + (100.0 - EHOG_FLOOR) * (x / (x + EHOG_CAP_KNEE)) ** EHOG_POWER;
}

export function computeEhog(mu: number, sigma: number): number {
  const cred = Math.max(0, 1 - (sigma / SIGMA_DEFAULT) ** CREDIBILITY_EXPONENT);
  return toEhog((mu - 3 * sigma) * cred);
}

export const DEFAULT_EHOG = computeEhog(MU_DEFAULT, SIGMA_DEFAULT);

function teamWeights(scoreA: number, scoreB: number): [number, number] {
  const total = scoreA + scoreB;
  if (total <= 0) return [0.5, 0.5];
  return [
    Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, scoreA / total)),
    Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, scoreB / total)),
  ];
}

export interface PlayerRating {
  playerId: number;
  mu: number;
  sigma: number;
  ehogRating: number;
}

function projectScenario(
  teamA: PlayerRating[],
  teamB: PlayerRating[],
  scoreA: number,
  scoreB: number,
): Record<number, number> {
  const aWon = scoreA > scoreB;
  const [wA, wB] = teamWeights(scoreA, scoreB);
  const rA = teamA.map((p) => rating({ mu: p.mu, sigma: p.sigma }));
  const rB = teamB.map((p) => rating({ mu: p.mu, sigma: p.sigma }));
  const [newA, newB] = rate([rA, rB], {
    model: plackettLuce,
    beta: BETA,
    rank: aWon ? [0, 1] : [1, 0],
    weight: [[wA, wA], [wB, wB]],
  });

  const deltas: Record<number, number> = {};
  for (let i = 0; i < teamA.length; i++) {
    const newEhog = computeEhog(newA[i].mu, newA[i].sigma);
    deltas[teamA[i].playerId] = newEhog - teamA[i].ehogRating;
  }
  for (let i = 0; i < teamB.length; i++) {
    const newEhog = computeEhog(newB[i].mu, newB[i].sigma);
    deltas[teamB[i].playerId] = newEhog - teamB[i].ehogRating;
  }
  return deltas;
}

export interface RatingProjection {
  label: string;
  scoreA: number;
  scoreB: number;
  deltas: Record<number, number>;
}

export function projectRatingDeltas(
  shirts: PlayerRating[],
  skins: PlayerRating[],
  targetWinRounds: number,
): RatingProjection[] {
  const blowout = targetWinRounds;
  const closeWin = targetWinRounds;
  const closeLoss = targetWinRounds - 2;
  return [
    { label: `${blowout}-1`, scoreA: blowout, scoreB: 1, deltas: projectScenario(shirts, skins, blowout, 1) },
    { label: `${closeWin}-${closeLoss}`, scoreA: closeWin, scoreB: closeLoss, deltas: projectScenario(shirts, skins, closeWin, closeLoss) },
    { label: `${closeLoss}-${closeWin}`, scoreA: closeLoss, scoreB: closeWin, deltas: projectScenario(shirts, skins, closeLoss, closeWin) },
    { label: `1-${blowout}`, scoreA: 1, scoreB: blowout, deltas: projectScenario(shirts, skins, 1, blowout) },
  ];
}
