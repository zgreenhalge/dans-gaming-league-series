// Build a MatchZy match-config JSON for a DGLS match. Shared by `scripts/gen-matchzy-config.ts`
// (manual/CLI) and `GET /api/matches/[id]/matchzy-config` (the authenticated `matchzy_loadmatch_url`
// target used by Phase 4 server provisioning). One source of truth for the config shape.
//
// See `dathost_handoff/` for the contract: `matchid` = DGLS match_id (MatchZy stamps the demo with
// it → self-labels for R2); teams keyed by steamid64; `players_per_team: 2` (Wingman); conditional
// `map_sides` (stored side → forced, else knife); demo upload cvars.
//
// MatchZy locks the server to the roster once a match JSON is loaded — anyone not listed in
// team1/team2/spectators gets kicked on connect, including would-be spectators (confirmed live,
// see shobhit-pathak/MatchZy issue #372). `spectators` is populated with every known DGLS player's
// steamid64 (minus whoever's already placed on team1/team2) so any league member can watch without
// being kicked; it does not cover spectators outside the player roster.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getReplayInputs } from './replay/inputs';
import type { RosterEntry } from './demoParser';
import { mapSlug } from './maps';

export interface MatchzyConfig {
  matchid: number;
  num_maps: number;
  players_per_team: number;
  maplist: string[];
  map_sides: string[];
  clinch_series: boolean;
  team1: { name: string; players: Record<string, string> };
  team2: { name: string; players: Record<string, string> };
  spectators: { players: Record<string, string> };
  cvars: Record<string, string>;
}

export interface BuiltMatchzyConfig {
  config: MatchzyConfig;
  warnings: string[];
}

export interface MatchzyConfigOptions {
  /** Where MatchZy POSTs match events, including the final `map_result` (#138's auto-commit oracle,
   *  and this pipeline's trigger — see `matchzy-log/route.ts`). */
  remoteLogUrl?: string;
  /** Shared secret sent as `X-MatchZy-Token` with each remote-log event. */
  remoteLogSecret?: string;
  /** Override `maplist` (e.g. the Steam workshop id for Phase 4 instead of the DGLS map name). */
  maplistOverride?: string;
}

/**
 * The demo filename MatchZy will write for this match (no `.dem`, no `MatchZy/` path prefix) —
 * `{date}_{matchId}_{map}`, e.g. `2026-08-04_58_de-rooftop` (`mapSlug()` hyphenates). Fully literal (no MatchZy `{TOKEN}`
 * substitution) and computed purely from already-known DB values, so `buildMatchzyConfig` (which sets
 * this as the `matchzy_demo_name_format` cvar) and `fetchFromDathost.ts` (which polls for the exact
 * same path to pull the finished recording) each call this directly instead of one guessing at what
 * the other produced — the two can't drift apart, because there's only one function computing it.
 *
 * Deliberately doesn't use MatchZy's own `{MAP}` token: that's populated from the engine's live map
 * state at recording time, not observable ahead of the pull, and using it would reintroduce exactly
 * the directory-discovery problem this deterministic-path scheme exists to avoid. `date` is
 * `scheduledAt`'s calendar date (UTC) — a label, not a promise the match was actually played that day,
 * since a delayed match keeps its original `scheduledAt`.
 */
export function demoBaseName(matchId: number, scheduledAt: string | null, mapRaw: string | null): string {
  const date = scheduledAt ? scheduledAt.slice(0, 10) : 'unscheduled';
  const map = mapRaw ? mapSlug(mapRaw) : 'unknown-map';
  return `${date}_${matchId}_${map}`;
}

/** Which team is CT, given which side SKINS (team2) starts on. */
function mapSides(skinsSide: 'CT' | 'T' | null): string[] {
  if (skinsSide === 'CT') return ['team2_ct']; // skins start CT
  if (skinsSide === 'T') return ['team1_ct']; // skins start T ⇒ shirts CT
  return ['knife']; // unknown at config time (gauntlet/playoff) — knife decides
}

function playersOf(roster: RosterEntry[], faction: 'SHIRTS' | 'SKINS'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of roster) {
    if (p.faction !== faction) continue;
    if (!p.steam_id) continue; // missing steamid64 — can't place this player (warned by caller)
    out[p.steam_id] = p.steam_nickname || p.name;
  }
  return out;
}

export async function buildMatchzyConfig(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  opts: MatchzyConfigOptions = {},
): Promise<BuiltMatchzyConfig> {
  const inputs = await getReplayInputs(supabaseAdmin, matchId);
  const warnings: string[] = [];

  const missing = inputs.roster.filter((r) => !r.steam_id).map((r) => `${r.faction}:${r.name}`);
  if (missing.length) {
    warnings.push(`${missing.length} player(s) without a steam_id, omitted from teams: ${missing.join(', ')}`);
  }
  if (inputs.skinsSide === null) {
    warnings.push('skins_starting_side not set — map_sides = ["knife"]; set the side before parsing.');
  }
  const maplistValue = opts.maplistOverride ?? inputs.map;
  if (!maplistValue) {
    warnings.push('match has no picked map — maplist is empty; set the picked map first.');
  }

  const team1Players = playersOf(inputs.roster, 'SHIRTS');
  const team2Players = playersOf(inputs.roster, 'SKINS');
  const rosteredSteamIds = new Set([...Object.keys(team1Players), ...Object.keys(team2Players)]);

  const { data: allPlayers } = await supabaseAdmin.from('players').select('steam_id, steam_nickname, name');
  const spectators: Record<string, string> = {};
  for (const p of allPlayers ?? []) {
    if (!p.steam_id || rosteredSteamIds.has(p.steam_id)) continue;
    spectators[p.steam_id] = p.steam_nickname || p.name;
  }

  const cvars: Record<string, string> = {
    matchzy_demo_name_format: demoBaseName(matchId, inputs.scheduledAt, inputs.map),
  };
  if (opts.remoteLogUrl) {
    cvars.matchzy_remote_log_url = opts.remoteLogUrl;
    cvars.matchzy_remote_log_header_key = 'X-MatchZy-Token';
    if (opts.remoteLogSecret) cvars.matchzy_remote_log_header_value = opts.remoteLogSecret;
  }

  const config: MatchzyConfig = {
    matchid: matchId,
    num_maps: 1,
    players_per_team: 2,
    maplist: maplistValue ? [maplistValue] : [],
    map_sides: mapSides(inputs.skinsSide),
    clinch_series: true,
    team1: { name: 'SHIRTS', players: team1Players },
    team2: { name: 'SKINS', players: team2Players },
    spectators: { players: spectators },
    cvars,
  };

  return { config, warnings };
}
