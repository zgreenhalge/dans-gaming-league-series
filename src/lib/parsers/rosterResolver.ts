import { parsePlayerInfo } from '@laihoe/demoparser2';
import type { RosterEntry } from '../demoParser';

function normName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function readDemoPlayers(
  demoBuffer: Buffer,
): { steamId: string; name: string }[] {
  const playerInfoRaw: { steamid: string | bigint; name: string }[] =
    parsePlayerInfo(demoBuffer);
  return playerInfoRaw
    .filter((p) => p.steamid && String(p.steamid) !== '0')
    .map((p) => ({ steamId: String(p.steamid), name: p.name ?? '' }));
}

export function resolveRoster(
  demoPlayers: { steamId: string; name: string }[],
  roster: RosterEntry[],
  warnings: string[],
): Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }> {
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
    warnings.push(
      `Resolved "${d.name}" (${d.steamId}) to roster player "${open[0].name}" by elimination — verify this is correct.`,
    );
    resolved.set(d.steamId, { player_id: open[0].player_id, faction: open[0].faction });
    remaining = [];
  }

  if (remaining.length > 0) {
    throw new Error(
      `Could not match ${remaining.length} demo player(s) to roster: ` +
        remaining.map((d) => `"${d.name}" (${d.steamId})`).join(', ') +
        '. Check that players have their Steam ID saved.',
    );
  }

  return resolved;
}
