import { rate, rating, predictWin } from 'openskill';
import { plackettLuce } from 'openskill/models';
import constants from '../../ehog/constants.json';

export const MU_DEFAULT = constants.MU_DEFAULT;
export const SIGMA_DEFAULT = constants.SIGMA_DEFAULT;
export const BETA = SIGMA_DEFAULT * constants.BETA_FACTOR;
const EHOG_CENTER = constants.EHOG_CENTER;
const EHOG_SCALE = constants.EHOG_SCALE;
const EHOG_LAMBDA = constants.EHOG_LAMBDA;
const SIGMA_FLOOR = constants.SIGMA_FLOOR;
const MOV_M_MIN = constants.MOV_M_MIN;
const MOV_M_MAX = constants.MOV_M_MAX;
const PROVISIONAL_SIGMA_THRESHOLD = constants.PROVISIONAL_SIGMA_THRESHOLD;

export function toEhog(mu: number, sigma: number): number {
  const skill = mu - EHOG_LAMBDA * sigma;
  return 10.0 + 90.0 / (1.0 + Math.exp(-(skill - EHOG_CENTER) / EHOG_SCALE));
}

/**
 * Inverse of toEhog() — the mu that produces a given display rating at a fixed sigma.
 * Domain: (10, 100) exclusive (the asymptotes are unreachable).
 */
export function fromEhog(targetEhog: number, sigma: number = SIGMA_DEFAULT): number {
  const skill = EHOG_CENTER - EHOG_SCALE * Math.log(90.0 / (targetEhog - 10.0) - 1.0);
  return skill + EHOG_LAMBDA * sigma;
}

export const DEFAULT_EHOG = toEhog(MU_DEFAULT, SIGMA_DEFAULT);

export function marginMultiplier(scoreA: number, scoreB: number): number {
  const total = scoreA + scoreB;
  if (total <= 0) return 1.0;
  const marginFrac = Math.abs(scoreA - scoreB) / total;
  return MOV_M_MIN + (MOV_M_MAX - MOV_M_MIN) * marginFrac;
}

export interface PlayerRating {
  playerId: number;
  mu: number;
  sigma: number;
  ehogRating: number;
}

/**
 * Probability team A wins, from current OpenSkill state alone (no MOV, no trained model — the
 * library's own PlackettLuce predictWin()).
 */
export function predictWinProbability(teamA: PlayerRating[], teamB: PlayerRating[]): number {
  const rA = teamA.map((p) => rating({ mu: p.mu, sigma: p.sigma }));
  const rB = teamB.map((p) => rating({ mu: p.mu, sigma: p.sigma }));
  const [pA] = predictWin([rA, rB], { beta: BETA });
  return pA;
}

/**
 * True if any player across both teams is still above PROVISIONAL_SIGMA_THRESHOLD — early enough
 * in their rating history that a win-probability prediction involving them carries extra
 * uncertainty beyond what the number alone conveys.
 */
export function isProvisional(teamA: PlayerRating[], teamB: PlayerRating[]): boolean {
  return [...teamA, ...teamB].some((p) => p.sigma >= PROVISIONAL_SIGMA_THRESHOLD);
}

function projectScenario(
  teamA: PlayerRating[],
  teamB: PlayerRating[],
  scoreA: number,
  scoreB: number,
): Record<number, number> {
  const aWon = scoreA > scoreB;

  // Unweighted PlackettLuce update — identical to Python engine
  const rA = teamA.map((p) => rating({ mu: p.mu, sigma: p.sigma }));
  const rB = teamB.map((p) => rating({ mu: p.mu, sigma: p.sigma }));
  const [baseA, baseB] = rate([rA, rB], {
    model: plackettLuce,
    beta: BETA,
    rank: aWon ? [0, 1] : [1, 0],
  });

  // MoV margin multiplier — μ-only (D5), same m for all 4 players
  const m = marginMultiplier(scoreA, scoreB);

  const deltas: Record<number, number> = {};
  for (let i = 0; i < teamA.length; i++) {
    const newMu = teamA[i].mu + m * (baseA[i].mu - teamA[i].mu);
    const newSigma = Math.max(SIGMA_FLOOR, baseA[i].sigma);
    deltas[teamA[i].playerId] = toEhog(newMu, newSigma) - teamA[i].ehogRating;
  }
  for (let i = 0; i < teamB.length; i++) {
    const newMu = teamB[i].mu + m * (baseB[i].mu - teamB[i].mu);
    const newSigma = Math.max(SIGMA_FLOOR, baseB[i].sigma);
    deltas[teamB[i].playerId] = toEhog(newMu, newSigma) - teamB[i].ehogRating;
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
