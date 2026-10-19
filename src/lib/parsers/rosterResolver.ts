import { parseEvent, parsePlayerInfo, parseTicks } from '@laihoe/demoparser2';
import type { RosterEntry } from '../demoParser';

function normName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export interface EliminationResolution {
  demoName: string;
  steamId: string;
  rosterName: string;
}

/**
 * The warning emitted when a demo player is matched to a roster slot by elimination. Its format is
 * the single source of truth — `parseEliminationWarning` reads it back, so keep the two in sync.
 */
export function eliminationWarning(demoName: string, steamId: string, rosterName: string): string {
  return `Resolved "${demoName}" (${steamId}) to roster player "${rosterName}" by elimination — verify this is correct.`;
}

/** Parse an elimination warning back into its parts, or `null` if the string isn't one. */
export function parseEliminationWarning(warning: string): EliminationResolution | null {
  const m = warning.match(/^Resolved "(.+?)" \((\d+)\) to roster player "(.+?)" by elimination/);
  return m ? { demoName: m[1], steamId: m[2], rosterName: m[3] } : null;
}

/**
 * The warning emitted when a demo yields zero players — distinct from the starting-side-unknown
 * warnings this would otherwise cascade into indistinguishably. A genuinely empty player list can
 * mean a truncated/corrupted file, but also a short or manually-started recording with no
 * populated player-info table — not necessarily a bad file, just one an admin should look at.
 */
export function noPlayersFoundWarning(): string {
  return 'No players found in demo — the file may be truncated/corrupted, or the recording may ' +
    'be too short/early-started for player info to have been captured.';
}

function withSteamIds(
  rows: { steamid: string | bigint; name?: string }[],
): { steamId: string; name: string }[] {
  return rows
    .filter((p) => p.steamid && String(p.steamid) !== '0')
    .map((p) => ({ steamId: String(p.steamid), name: p.name ?? '' }));
}

/** CS2 `team_num` of a player actually playing: 2 = T, 3 = CT (1 = spectator, 0 = unassigned). */
const PLAYING_TEAMS = new Set([2, 3]);

/**
 * Drops players who were sampled in the demo but never on T or CT — spectators and anyone left
 * unassigned — so they never count as roster candidates. A player with no usable `team_num`
 * sample at all (not networked at any sampled tick, or the field absent) is kept: nothing says
 * they weren't playing, and `parsePlayerInfo()` alone can be the only source that lists them.
 */
export function excludeNonPlayers(
  players: { steamId: string; name: string }[],
  teamSamples: { steamId: string; teamNum: number }[],
): { steamId: string; name: string }[] {
  const sampled = new Set<string>();
  const played = new Set<string>();
  for (const s of teamSamples) {
    if (!Number.isFinite(s.teamNum)) continue;
    sampled.add(s.steamId);
    if (PLAYING_TEAMS.has(s.teamNum)) played.add(s.steamId);
  }
  return players.filter((p) => !sampled.has(p.steamId) || played.has(p.steamId));
}

/**
 * The players who played in the demo: every steamid `parsePlayerInfo()` or a per-`round_end`-tick
 * read finds, minus spectators (`excludeNonPlayers()`). A spectator is not a roster candidate, so
 * `resolveRoster()` never has to match one and cannot mistake one for a missing rostered player.
 */
export function readDemoPlayers(
  demoBuffer: Buffer,
): { steamId: string; name: string }[] {
  // parsePlayerInfo() reads a player-info string table that can come back empty, or short by one or
  // more players, for a short demo segment resumed mid-match after a server restart — even though
  // every player's steamid/name is readable directly off their entity at any tick, the same per-tick
  // read every other collector in this codebase already relies on. Always cross-referenced against
  // that per-tick read (not just as a fallback when parsePlayerInfo() is *totally* empty) — a
  // partial result is just as real a risk as an empty one and would otherwise silently
  // under-resolve the roster with no signal anything was missing.
  //
  // Samples every round_end tick, not just the first — a player who reconnects a little later than
  // the others after the restart that necessitated this cross-reference in the first place might
  // not be networked yet at that first tick. Later ticks pick them up.
  const byId = new Map<string, { steamId: string; name: string }>();
  const teamSamples: { steamId: string; teamNum: number }[] = [];
  const rounds = parseEvent(demoBuffer, 'round_end', [], []) as { tick: number }[];
  if (rounds.length > 0) {
    const rows = parseTicks(demoBuffer, ['name', 'team_num'], rounds.map((r) => r.tick)) as {
      steamid: string | bigint;
      name?: string;
      team_num?: number;
    }[];
    for (const p of withSteamIds(rows)) byId.set(p.steamId, p);
    for (const r of rows) {
      if (r.steamid && String(r.steamid) !== '0') {
        teamSamples.push({ steamId: String(r.steamid), teamNum: Number(r.team_num) });
      }
    }
  }
  // parsePlayerInfo()'s name (when it has an entry) wins as the cleaner display name — the per-tick
  // sample's `name` field is a fallback for steamids it alone found, not the preferred source.
  for (const p of withSteamIds(parsePlayerInfo(demoBuffer))) byId.set(p.steamId, p);

  return excludeNonPlayers([...byId.values()], teamSamples);
}

export function resolveRoster(
  demoPlayers: { steamId: string; name: string }[],
  roster: RosterEntry[],
  warnings: string[],
): Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }> {
  if (demoPlayers.length === 0) {
    warnings.push(noPlayersFoundWarning());
    return new Map();
  }

  const resolved = new Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }>();
  const usedIds = new Set<number>();
  let remaining = [...demoPlayers];

  // Pass 1: exact Steam ID
  for (const d of [...remaining]) {
    const slot = roster.find(
      (r) => r.steam_id && String(r.steam_id) === d.steamId && !usedIds.has(r.player_id),
    );
    if (slot) {
      resolved.set(d.steamId, { player_id: slot.player_id, faction: slot.faction });
      usedIds.add(slot.player_id);
      remaining = remaining.filter((r) => r.steamId !== d.steamId);
    }
  }

  // Pass 2: name / steam_nickname
  for (const d of [...remaining]) {
    const target = normName(d.name);
    const slot = roster.find(
      (r) =>
        !usedIds.has(r.player_id) &&
        (target === normName(r.name) || (r.steam_nickname && target === normName(r.steam_nickname))),
    );
    if (slot) {
      resolved.set(d.steamId, { player_id: slot.player_id, faction: slot.faction });
      usedIds.add(slot.player_id);
      remaining = remaining.filter((r) => r.steamId !== d.steamId);
    }
  }

  // Pass 3: elimination
  const open = roster.filter((r) => !usedIds.has(r.player_id));
  if (remaining.length === 1 && open.length === 1) {
    const d = remaining[0];
    warnings.push(eliminationWarning(d.name, d.steamId, open[0].name));
    resolved.set(d.steamId, { player_id: open[0].player_id, faction: open[0].faction });
    usedIds.add(open[0].player_id);
    remaining = [];
  }

  if (remaining.length > 0) {
    throw new Error(
      `Could not match ${remaining.length} demo player(s) to roster: ` +
        remaining.map((d) => `"${d.name}" (${d.steamId})`).join(', ') +
        '. Check that players have their Steam ID saved.',
    );
  }

  // Every demo player matched a roster slot, but that's not the same as every roster slot having
  // a demo player — a demo that simply never captured one player (e.g. one who reconnected too
  // late to appear in any round_end-tick sample) resolves cleanly here with no thrown error and no
  // elimination warning (that pass only fires for exactly one unmatched slot), so this is the one
  // remaining place such a partial roster would otherwise go undetected.
  const stillOpen = roster.filter((r) => !usedIds.has(r.player_id));
  if (stillOpen.length > 0) {
    warnings.push(
      `Demo resolved ${resolved.size} of ${roster.length} roster players — missing: ` +
        `${stillOpen.map((r) => r.name).join(', ')}. Their stats for this segment cannot be included.`,
    );
  }

  return resolved;
}
