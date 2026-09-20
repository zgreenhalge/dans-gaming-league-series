import { parseTicks } from '@laihoe/demoparser2';
import { sideForRealRound } from './roundSides';

// Infer skins' starting side (the round-1 anchor `buildRoundSides` needs) directly
// from the demo, instead of relying on a stored `skins_starting_side`. The demo is
// ground truth for who was on which side, so this lets gauntlet/knife matches — which
// have no stored side — self-derive their score + stats with no manual entry.
//
// Precedence (decided with the user): a *stored* side always wins (it was entered for
// a reason); the demo only fills the gap when nothing is stored, and a stored-vs-demo
// disagreement is surfaced as a warning rather than silently overridden.

// CS2 `team_num`: 2 = T, 3 = CT (1 = spectator, 0 = unassigned).
const T_TEAM = 2;
const CT_TEAM = 3;

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
): 'CT' | 'T' | null {
  if (sideAtRound === null) return null;
  return sideForRealRound(realRoundNumber, sideAtRound, targetWinRounds);
}

/**
 * Read `team_num` at a segment's first live round and infer skins' round-1 starting side.
 * (Sides don't change within a round, so a round's end tick reflects its own side.) `targetWinRounds`
 * and `startingRealRound` (default 1) anchor that reading back to the match's true round 1 via
 * `anchorToRoundOne()` — a no-op for the common single-segment/first-segment case.
 */
export function inferSkinsStartingSide(
  demoBuffer: Buffer,
  firstLiveRoundTick: number,
  steamToPlayer: ResolvedRoster,
  targetWinRounds: number,
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
  return anchorToRoundOne(sideAtSegmentStart, startingRealRound, targetWinRounds);
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
export function sideDisagreementWarning(stored: 'CT' | 'T', inferred: 'CT' | 'T'): string {
  return (
    `Stored starting side (${stored}) disagrees with the demo (skins started ${inferred}). ` +
    `Using the stored side — verify the entered result.`
  );
}
