import { parseTicks } from '@laihoe/demoparser2';
import { DEFAULT_OT_ROUNDS_PER_HALF, sideForRealRound } from './roundSides';

// Infer skins' starting side (the round-1 anchor `buildRoundSides` needs) directly
// from the demo, instead of relying on a stored `skins_starting_side`. The demo is
// ground truth for who was on which side, so this lets gauntlet/knife matches — which
// have no stored side — self-derive their score + stats with no manual entry.
//
// Precedence (decided with the user): a *stored* side always wins (it was entered for
// a reason); the demo only fills the gap when nothing is stored, and a stored-vs-demo
// disagreement is surfaced as a warning rather than silently overridden.

// CS2 `team_num`: 2 = T, 3 = CT (1 = spectator, 0 = unassigned).
export const T_TEAM = 2;
export const CT_TEAM = 3;

type ResolvedRoster = Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }>;

/**
 * Pure decision: given each resolved player's `team_num` at round 1, which side did
 * SKINS start on? Majority vote over resolved SKINS players; if none resolved (e.g. a
 * SKINS player never connected), infer from SHIRTS (skins = the opposite side).
 * Returns `null` only when neither faction has a player on a valid side.
 */
export function decideSkinsSide(
  teamBySteamId: Map<string, number>,
  steamToPlayer: ResolvedRoster,
): 'CT' | 'T' | null {
  let skinsCT = 0;
  let skinsT = 0;
  let shirtsCT = 0;
  let shirtsT = 0;
  for (const [steamId, who] of steamToPlayer) {
    const team = teamBySteamId.get(steamId);
    if (team !== CT_TEAM && team !== T_TEAM) continue;
    const isCT = team === CT_TEAM;
    if (who.faction === 'SKINS') {
      if (isCT) skinsCT++;
      else skinsT++;
    } else {
      if (isCT) shirtsCT++;
      else shirtsT++;
    }
  }
  if (skinsCT + skinsT > 0) return skinsCT >= skinsT ? 'CT' : 'T';
  if (shirtsCT + shirtsT > 0) return shirtsCT >= shirtsT ? 'T' : 'CT'; // skins = opposite of shirts
  return null;
}

/**
 * Recovers the match's true round-1 side from a `team_num` read taken at a segment's own first
 * live round — identity when that segment starts at real round 1 (every single-segment caller),
 * but a segment that begins after the halftime/OT swap (a later segment of a restart-interrupted
 * match) reads its side *post*-swap, not the round-1 anchor `buildRoundSides` needs. Correcting for
 * this is `sideForRealRound`'s own inverse: applying the same half/OT schedule a second time at the
 * same round number always returns to the original side (the swap decision depends only on the
 * round number and target, not on which side is passed in), so the correction and the original
 * swap are the same function call.
 */
export function anchorToRoundOne(
  sideAtRound: 'CT' | 'T' | null,
  realRoundNumber: number,
  targetWinRounds: number,
  otRoundsPerHalf: number,
): 'CT' | 'T' | null {
  if (sideAtRound === null) return null;
  return sideForRealRound(realRoundNumber, sideAtRound, targetWinRounds, otRoundsPerHalf);
}

/**
 * Pure: the overtime half size implied by one team's observed side per real round. OT sides swap
 * between the two halves of the first period (after `otRoundsPerHalf` rounds) and the first OT
 * round continues the regulation-H2 side, so the first OT round whose side differs from round
 * `2 * (targetWinRounds - 1) + 1` is round `2 * (targetWinRounds - 1) + otRoundsPerHalf + 1`.
 * Returns `null` when the observations don't include that first OT round, or no swap is observed
 * (no OT, or the match ended before a half completed) — in which case the half size never
 * affected a round's side.
 */
export function inferOtRoundsPerHalf(
  sideByRealRound: Map<number, 'CT' | 'T'>,
  targetWinRounds: number,
): number | null {
  const otStart = (targetWinRounds - 1) * 2 + 1;
  const firstOtSide = sideByRealRound.get(otStart);
  if (firstOtSide === undefined) return null;
  for (let n = otStart + 1; sideByRealRound.has(n); n++) {
    if (sideByRealRound.get(n) !== firstOtSide) return n - otStart;
  }
  return null;
}

/**
 * Reads one resolved player's `team_num` at the end tick of each overtime round and runs
 * `inferOtRoundsPerHalf()` over it. `liveRoundEnds` are the segment's live `round_end` rows in
 * order; the first is real round `startingRealRound`. Returns `null` when there's no overtime in
 * this demo (or segment) to read — a segment that begins after the first OT round can't be
 * anchored, so it also returns `null`.
 */
function inferOtRoundsPerHalfFromDemo(
  demoBuffer: Buffer,
  liveRoundEnds: { tick: number }[],
  steamToPlayer: ResolvedRoster,
  targetWinRounds: number,
  startingRealRound: number,
): number | null {
  const otStart = (targetWinRounds - 1) * 2 + 1;
  const otEnds = liveRoundEnds
    .map((e, i) => ({ tick: e.tick, realRound: startingRealRound + i }))
    .filter((r) => r.realRound >= otStart);
  if (otEnds.length === 0 || otEnds[0].realRound !== otStart) return null;
  const steamId = steamToPlayer.keys().next().value;
  if (steamId === undefined) return null;
  const rows = parseTicks(demoBuffer, ['team_num'], otEnds.map((r) => r.tick)) as {
    steamid: string | bigint;
    tick: number;
    team_num?: number;
  }[];
  const teamAtTick = new Map<number, number>();
  for (const r of rows) {
    if (String(r.steamid ?? '') === steamId && typeof r.team_num === 'number') {
      teamAtTick.set(r.tick, r.team_num);
    }
  }
  const sideByRealRound = new Map<number, 'CT' | 'T'>();
  for (const r of otEnds) {
    const team = teamAtTick.get(r.tick);
    if (team === CT_TEAM) sideByRealRound.set(r.realRound, 'CT');
    else if (team === T_TEAM) sideByRealRound.set(r.realRound, 'T');
    else break;
  }
  return inferOtRoundsPerHalf(sideByRealRound, targetWinRounds);
}

/**
 * Read `team_num` at a segment's first live round and infer skins' round-1 starting side.
 * (Sides don't change within a round, so a round's end tick reflects its own side.) `targetWinRounds`
 * and `startingRealRound` (default 1) anchor that reading back to the match's true round 1 via
 * `anchorToRoundOne()` — a no-op for the common single-segment/first-segment case.
 */
function inferSkinsStartingSide(
  demoBuffer: Buffer,
  firstLiveRoundTick: number,
  steamToPlayer: ResolvedRoster,
  targetWinRounds: number,
  otRoundsPerHalf: number,
  startingRealRound = 1,
): 'CT' | 'T' | null {
  const rows = parseTicks(demoBuffer, ['team_num'], [firstLiveRoundTick]) as {
    steamid: string | bigint;
    team_num?: number;
  }[];
  const teamBySteamId = new Map<string, number>();
  for (const r of rows) {
    const sid = String(r.steamid ?? '');
    if (!sid || sid === '0') continue;
    if (typeof r.team_num === 'number') teamBySteamId.set(sid, r.team_num);
  }
  const sideAtSegmentStart = decideSkinsSide(teamBySteamId, steamToPlayer);
  return anchorToRoundOne(sideAtSegmentStart, startingRealRound, targetWinRounds, otRoundsPerHalf);
}

/**
 * Resolve the side to actually use for round attribution: stored wins; the demo-inferred
 * side fills a missing stored value (gauntlet/knife). `disagreed` is true when a stored
 * side is contradicted by the demo — the caller surfaces that as a warning.
 */
export function resolveEffectiveSide(
  stored: 'CT' | 'T' | null,
  inferred: 'CT' | 'T' | null,
): { side: 'CT' | 'T' | null; disagreed: boolean } {
  if (stored !== null) return { side: stored, disagreed: inferred !== null && inferred !== stored };
  return { side: inferred, disagreed: false };
}

/** The warning surfaced (and shown in the admin panel) when stored and demo disagree. */
function sideDisagreementWarning(stored: 'CT' | 'T', inferred: 'CT' | 'T'): string {
  return (
    `Stored starting side (${stored}) disagrees with the demo (skins started ${inferred}). ` +
    `Using the stored side — verify the entered result.`
  );
}

export interface StartingSideResolution {
  /** Side inferred from the demo's round-1 `team_num` (null if unresolvable). */
  inferredSide: 'CT' | 'T' | null;
  /** The side to actually use for round attribution — stored wins over `inferredSide`
   *  (see `resolveEffectiveSide()`). */
  effectiveSide: 'CT' | 'T' | null;
  /** The overtime half size inferred from the demo's own mid-period `team_num` swap, or `null`
   *  when the demo (segment) shows none — see `inferOtRoundsPerHalf()`. This is the value to
   *  persist as `matches.ot_rounds_per_half`. */
  inferredOtRoundsPerHalf: number | null;
  /** The half size round attribution actually uses: `inferredOtRoundsPerHalf`, else
   *  `DEFAULT_OT_ROUNDS_PER_HALF` (a demo with no mid-period swap never exercises the value). */
  otRoundsPerHalf: number;
  /** Set when a stored side is contradicted by the demo; null otherwise. Whether to surface
   *  this (push it onto a caller's own `warnings` array) is the caller's call. */
  disagreementWarning: string | null;
}

/**
 * The starting-side-resolution sequence every demo-parsing entry point (`parseDemoFile()`,
 * `parseDemoSabremetrics()`, `buildReplay()`) needs before it can attribute rounds: infer the
 * side from the demo, resolve it against any stored side, and produce the disagreement warning
 * text when the two conflict. `liveRoundEnds` is the caller's own live-round-end rows (each
 * already produced via `filterLiveRoundEnds()`/`getLiveRoundEndEvents()` — this doesn't
 * re-derive them, since callers need that array for other things too); only its first entry's
 * tick is read, to sample `team_num` at round 1.
 */
export function resolveStartingSide(
  demoBuffer: Buffer,
  liveRoundEnds: { tick: number }[],
  steamToPlayer: ResolvedRoster,
  storedSide: 'CT' | 'T' | null,
  targetWinRounds: number,
  startingRealRound = 1,
): StartingSideResolution {
  const inferredOtRoundsPerHalf = inferOtRoundsPerHalfFromDemo(
    demoBuffer, liveRoundEnds, steamToPlayer, targetWinRounds, startingRealRound,
  );
  const otRoundsPerHalf =
    inferredOtRoundsPerHalf ?? DEFAULT_OT_ROUNDS_PER_HALF;
  const inferredSide =
    liveRoundEnds.length > 0
      ? inferSkinsStartingSide(
          demoBuffer, liveRoundEnds[0].tick, steamToPlayer, targetWinRounds, otRoundsPerHalf, startingRealRound,
        )
      : null;
  const { side: effectiveSide, disagreed } = resolveEffectiveSide(storedSide, inferredSide);
  const disagreementWarning =
    disagreed && storedSide !== null && inferredSide !== null
      ? sideDisagreementWarning(storedSide, inferredSide)
      : null;
  return { inferredSide, effectiveSide, inferredOtRoundsPerHalf, otRoundsPerHalf, disagreementWarning };
}
