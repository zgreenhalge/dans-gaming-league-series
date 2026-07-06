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
  /** Where MatchZy POSTs the finished demo (the Cloudflare Worker). */
  demoUploadUrl?: string;
  /** Shared secret sent as `X-MatchZy-Token` with the demo upload. */
  demoUploadSecret?: string;
  /** Override `maplist` (e.g. the Steam workshop id for Phase 4 instead of the DGLS map name). */
  maplistOverride?: string;
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

  const cvars: Record<string, string> = {};
  if (opts.demoUploadUrl) {
    cvars.matchzy_demo_upload_url = opts.demoUploadUrl;
    cvars.matchzy_demo_upload_header_key = 'X-MatchZy-Token';
    if (opts.demoUploadSecret) cvars.matchzy_demo_upload_header_value = opts.demoUploadSecret;
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
