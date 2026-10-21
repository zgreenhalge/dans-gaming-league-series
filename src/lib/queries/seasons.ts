import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from '../supabase-admin';
import type { Player, Season } from '../types';
import { allMatchesPlayed, extractSeasonNumber, findPairedSeason, isPlayedScore } from '../util';
import { computeH2H, scheduleToH2HInput, type H2HData } from '../h2h';
import { getPlayersById } from './player';
import { batchedIn } from './_shared';
import { getMatchScoresForWeeks, getSeasonSchedule, type WeekWithMatches } from './schedule';
import { getSeasonEhogRatings } from './ehog';
import { getAllSabremetrics, hasSeasonSabremetrics, type SabremetricMatchRow } from './sabremetrics';
import { getAllMatchRounds, type MatchRoundRow } from './rounds';
import { getAllMatchKills, type MatchKillRow } from './kills';
import { getAllWeaponClassStats, getAllEconomyStats, type WeaponClassMatchRow, type EconomyMatchRow } from './weaponStats';
import { persistentQuery } from './_persistentCache';

export interface SeasonRosterEntry {
  player_id: number;
  player_name: string;
  steam_avatar_url: string | null;
  discord_id: string | null;
}

/** Optional `client` per docs/recipes.md's query-helper recipe. `persistentQuery()`-wrapped so
 *  the root layout's own read (feeds `SideNav`) and a page's separate read of the same table share one
 *  Supabase read — same reasoning as `getSeason()` below. */
export const getSeasons = persistentQuery('getSeasons', async (client?: SupabaseClient): Promise<Season[]> => {
  const db = client ?? getAdminClient();
  const { data, error } = await db
    .from('seasons')
    .select('*')
    .order('id');
  if (error) throw error;
  return (data ?? []) as Season[];
});

/** The current regular (non-gauntlet) `ACTIVE` season, or `null` if none is — a gauntlet can also be
 *  `ACTIVE` at the same time as its paired regular season briefly completes ahead of it (see
 *  architecture.md's season status lifecycle), so this always excludes gauntlets rather than
 *  picking whichever `ACTIVE` row sorts first. Ties (more than one `ACTIVE` regular season) resolve
 *  to the lowest id, same as the home page's own `active[0]` — not expected in practice. */
export async function getActiveRegularSeason(client?: SupabaseClient): Promise<Season | null> {
  const seasons = await getSeasons(client);
  return seasons.find((s) => !s.is_gauntlet && s.status === 'ACTIVE') ?? null;
}

/** The season behind the home page's standings and what to say about it. */
export interface HomeStandingsSeason {
  season: Season;
  /** The season is running (`ACTIVE`); otherwise it is the latest finished one. */
  live: boolean;
  /** The season's paired gauntlet when it is running, so the panel can point at it. */
  gauntlet: Season | null;
}

/** Which seasons the home page's panels read. */
export interface HomeSeasons {
  /** The first active regular season; the Upcoming Games source. */
  regular: Season | null;
  /** The first active gauntlet with the hub season id its pages hang off (its paired regular
   *  season, else the gauntlet itself); the Upcoming Games source when `regular` is `null`. */
  gauntlet: { season: Season; hubId: number } | null;
  /** The standings source: `regular`, else the most recently finished regular season (highest
   *  season number), else `null` — a league whose only seasons are upcoming has no standings. */
  standings: HomeStandingsSeason | null;
}

/** Resolves "which season is current" for the home page once, so the games and the standings
 *  share one rule. */
export function resolveHomeSeasons(seasons: Season[]): HomeSeasons {
  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntlets = seasons.filter((s) => s.is_gauntlet);

  const regular = regularSeasons.find((s) => s.status === 'ACTIVE') ?? null;
  const activeGauntlet = gauntlets.find((s) => s.status === 'ACTIVE');
  const gauntlet = activeGauntlet
    ? { season: activeGauntlet, hubId: findPairedSeason(activeGauntlet.name, regularSeasons)?.id ?? activeGauntlet.id }
    : null;

  const standingsSeason =
    regular ??
    regularSeasons
      .filter((s) => s.status === 'ARCHIVED')
      .sort((a, b) => (extractSeasonNumber(b.name) ?? b.id) - (extractSeasonNumber(a.name) ?? a.id))[0];
  let standings: HomeStandingsSeason | null = null;
  if (standingsSeason) {
    const paired = findPairedSeason(standingsSeason.name, gauntlets);
    standings = {
      season: standingsSeason,
      live: standingsSeason.status === 'ACTIVE',
      gauntlet: paired?.status === 'ACTIVE' ? paired : null,
    };
  }
  return { regular, gauntlet, standings };
}

/** True if the season has a schedule (at least one week/match exists) and every match in it has a
 * played score. A season with no matches yet is never "fully played". The shared ground truth for
 * "is this season actually done" — deliberately independent of `seasons.status`, which tracks the
 * admin-visible lifecycle stage and can move (e.g. a reset gauntlet reverting its paired regular
 * season back to `ACTIVE`) without the season's own match history changing. */
export async function isSeasonFullyPlayed(seasonId: number, client?: SupabaseClient): Promise<boolean> {
  const db = client ?? getAdminClient();
  const { data: weeks, error: weekErr } = await db.from('weeks').select('id').eq('season_id', seasonId);
  if (weekErr) throw weekErr;
  const weekIds = ((weeks ?? []) as { id: number }[]).map((w) => w.id);
  return allMatchesPlayed(await getMatchScoresForWeeks(db, weekIds));
}

/** `persistentQuery()`-wrapped so a route that reads it from both `generateMetadata` and the page
 *  component (e.g. `seasons/[id]/page.tsx`) shares one Supabase read. */
export const getSeason = persistentQuery('getSeason', async (id: number, client?: SupabaseClient): Promise<Season | null> => {
  const db = client ?? getAdminClient();
  const { data, error } = await db
    .from('seasons')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Season | null;
});

/** Find the gauntlet season paired to a regular season (`findPairedSeason()`'s rule). Reads through the
 *  persistent `getSeasons()` rather than its own query, so repeat lookups (e.g. one per row in
 *  `getAdminMatches()`) share the read already made elsewhere instead of adding their own. */
export async function getLinkedGauntlet(regularSeasonName: string, client?: SupabaseClient): Promise<Season | null> {
  const seasons = await getSeasons(client);
  return findPairedSeason(regularSeasonName, seasons.filter((s) => s.is_gauntlet));
}

/** Find the regular season paired to a gauntlet season (`findPairedSeason()`'s rule). Same
 *  `getSeasons()`-backed reasoning as `getLinkedGauntlet()` above. */
export async function getLinkedRegularSeason(gauntletName: string, client?: SupabaseClient): Promise<Season | null> {
  const seasons = await getSeasons(client);
  return findPairedSeason(gauntletName, seasons.filter((s) => !s.is_gauntlet));
}

/** Where a season's sub-pages live: the *hub* is the regular season every public season link points
 *  at (a gauntlet season id redirects there), and `gauntlet` is its paired gauntlet if one exists.
 *  A gauntlet with no paired regular season is its own hub. Given either season of a pair, both
 *  resolve identically. */
export interface SeasonScope {
  hub: Season;
  gauntlet: Season | null;
}

export async function getSeasonScope(season: Season, client?: SupabaseClient): Promise<SeasonScope> {
  if (season.is_gauntlet) {
    return { hub: (await getLinkedRegularSeason(season.name, client)) ?? season, gauntlet: season };
  }
  return { hub: season, gauntlet: await getLinkedGauntlet(season.name, client) };
}

/** The hub season id for every season in `seasons`: a regular season is its own hub, a gauntlet's is
 *  its paired regular season (`findPairedSeason()`), or itself if unpaired. The bulk form of
 *  `getSeasonScope()`'s hub rule, for callers listing many seasons. */
export function hubIdsBySeason(seasons: Season[]): Map<number, number> {
  const regulars = seasons.filter((s) => !s.is_gauntlet);
  return new Map(
    seasons.map((s) => [s.id, (s.is_gauntlet ? findPairedSeason(s.name, regulars)?.id : undefined) ?? s.id]),
  );
}

/** A season's explicit roster (`season_players`) — the pre-match-history source of who's on a
 * season before any matches exist to derive it from. Sorted by player name. */
export const getSeasonRoster = persistentQuery('getSeasonRoster', async (seasonId: number): Promise<SeasonRosterEntry[]> => {
  const [{ data, error }, resolvedPlayersById] = await Promise.all([
    getAdminClient().from('season_players').select('player_id').eq('season_id', seasonId),
    getPlayersById(),
  ]);
  if (error) throw error;

  const rows = (data ?? []) as { player_id: number }[];
  const entries: SeasonRosterEntry[] = [];
  for (const r of rows) {
    const player = resolvedPlayersById.get(r.player_id);
    // A roster is a flat list — a row referencing a player_id missing from playersById is simply
    // omitted, unlike getSeasonScheduleDraft()'s player() helper, which throws on the equivalent
    // case. That's deliberate, not an inconsistency to reconcile: a list tolerates one fewer row
    // fine, but a schedule draft's match slot can't render at all without a real player in it.
    if (!player) continue;
    entries.push({
      player_id: r.player_id,
      player_name: player.name,
      steam_avatar_url: player.steam_avatar_url,
      discord_id: player.discord_id,
    });
  }
  return entries.sort((a, b) => a.player_name.localeCompare(b.player_name));
});

/** Ids of the seasons a player is on the explicit roster (`season_players`) of — what "have I
 *  signed up for this season" means while a season is UPCOMING. */
export const getPlayerRosterSeasonIds = persistentQuery('getPlayerRosterSeasonIds', async (playerId: number): Promise<Set<number>> => {
  const { data, error } = await getAdminClient().from('season_players').select('season_id').eq('player_id', playerId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => (r as { season_id: number }).season_id));
});

/** Everyone currently part of a season, unioning `season_players` with anyone who already has a
 *  scheduled or played match under it (`weeks` → `matches` → `player_match_stats`). `season_players`
 *  alone is the pre-schedule signup list; once a schedule exists, a season's real participants are
 *  whoever it actually rostered into matches — which for a season imported or scheduled without ever
 *  writing `season_players` rows (e.g. a historically-imported season) is the *only* place that
 *  membership is recorded. Used wherever "is this player currently part of the season" needs to be
 *  right regardless of which stage produced that membership — the `@Participants` Discord role sync
 *  (`discord-roles.ts`, `season-lifecycle.ts`), not `getSeasonRoster()`'s own callers (the roster
 *  editor, schedule generation), which specifically want the raw pre-schedule signup list. */
export async function getSeasonParticipants(seasonId: number, playersById?: Map<number, Player>): Promise<SeasonRosterEntry[]> {
  const [roster, resolvedPlayersById, { data: weekRows, error: weekErr }] = await Promise.all([
    getSeasonRoster(seasonId),
    playersById ?? getPlayersById(),
    getAdminClient().from('weeks').select('id').eq('season_id', seasonId),
  ]);
  if (weekErr) throw weekErr;

  const byId = new Map(roster.map((r) => [r.player_id, r]));
  const weekIds = ((weekRows ?? []) as { id: number }[]).map((w) => w.id);
  if (weekIds.length > 0) {
    const { data: matchRows, error: matchErr } = await getAdminClient().from('matches').select('id').in('week_id', weekIds);
    if (matchErr) throw matchErr;
    const matchIds = ((matchRows ?? []) as { id: number }[]).map((m) => m.id);
    if (matchIds.length > 0) {
      const { data: statRows, error: statErr } = await getAdminClient().from('player_match_stats').select('player_id').in('match_id', matchIds);
      if (statErr) throw statErr;
      for (const { player_id } of (statRows ?? []) as { player_id: number }[]) {
        if (byId.has(player_id)) continue;
        const player = resolvedPlayersById.get(player_id);
        if (!player) continue;
        byId.set(player_id, {
          player_id,
          player_name: player.name,
          steam_avatar_url: player.steam_avatar_url,
          discord_id: player.discord_id,
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.player_name.localeCompare(b.player_name));
}

/** Ids of the players who played in a regular season — on a match with a played score, in the season
 *  itself or its paired gauntlet. `cache()`-wrapped on `seasonId` alone (the weeks → matches → stats
 *  walk is the expensive part) so every caller in one request shares it. */
const getSeasonPlayedPlayerIds = cache(async (seasonId: number): Promise<number[]> => {
  const season = await getSeason(seasonId);
  if (!season) return [];
  const gauntlet = season.is_gauntlet ? null : await getLinkedGauntlet(season.name);

  const { data: weekRows, error: weekErr } = await getAdminClient()
    .from('weeks')
    .select('id')
    .in('season_id', [seasonId, ...(gauntlet ? [gauntlet.id] : [])]);
  if (weekErr) throw weekErr;

  const weekIds = (weekRows ?? []).map((w) => w.id);
  if (weekIds.length === 0) return [];
  const matchRows = await batchedIn<{ id: number; final_score: string | null }>('matches', 'week_id', weekIds, 'id, final_score');
  const playedMatchIds = matchRows.filter((m) => isPlayedScore(m.final_score)).map((m) => m.id);
  if (playedMatchIds.length === 0) return [];
  const statRows = await batchedIn<{ player_id: number }>('player_match_stats', 'match_id', playedMatchIds, 'player_id');
  return [...new Set(statRows.map((r) => r.player_id))];
});

/** Players who actually played in a regular season (see `getSeasonPlayedPlayerIds()`). Narrower than
 *  `getSeasonParticipants()`, which also counts a rostered player whose matches are still unplayed;
 *  this is the "took part" signal the post-season survey and superlatives vote gate on. Sorted by
 *  player name. */
export const getSeasonPlayedPlayers = persistentQuery('getSeasonPlayedPlayers', async (seasonId: number, playersById?: Map<number, Player>): Promise<SeasonRosterEntry[]> => {
  const [playerIds, resolvedPlayersById] = await Promise.all([getSeasonPlayedPlayerIds(seasonId), playersById ?? getPlayersById()]);
  const entries: SeasonRosterEntry[] = [];
  for (const playerId of playerIds) {
    const player = resolvedPlayersById.get(playerId);
    if (!player) continue;
    entries.push({
      player_id: playerId,
      player_name: player.name,
      steam_avatar_url: player.steam_avatar_url,
      discord_id: player.discord_id,
    });
  }
  return entries.sort((a, b) => a.player_name.localeCompare(b.player_name));
});

/** Whether `playerId` is among a season's played players (`getSeasonPlayedPlayers()`'s result) — the one
 *  eligibility predicate the survey and superlatives gates and views all share. */
export function hasPlayedSeason(played: SeasonRosterEntry[], playerId: number): boolean {
  return played.some((p) => p.player_id === playerId);
}

export interface RegularSeasonLightView {
  schedule: WeekWithMatches[];
  h2hData: H2HData;
  ehogRatings: Record<number, number>;
  /** Whether this season has at least one match with parsed sabremetrics — decides whether the
   *  Advanced Stats tab shows at all, independent of whether `SeasonStatsView` has been fetched yet
   *  (see `hasSeasonSabremetrics()`, `sabremetrics.ts`). */
  hasAdvancedStats: boolean;
}

/** The Stats/Advanced Stats sub-tab fields for either season kind — identical shape for a regular
 *  season and a gauntlet, so `gauntlet.ts`'s own `getGauntletSeasonStatsView()` reuses this type
 *  directly rather than declaring a byte-for-byte duplicate. */
export interface SeasonStatsView {
  sabremetrics: SabremetricMatchRow[];
  matchRounds: MatchRoundRow[];
  matchKills: MatchKillRow[];
  matchWeaponClassStats: WeaponClassMatchRow[];
  matchEconomyStats: EconomyMatchRow[];
}

/** The season detail page's Regular Season tab fields needed regardless of which sub-tab is
 *  showing — the Leaderboard, H2H, Groups, and Schedule sub-tabs all render from this alone.
 *  Distinct from `SeasonStatsView` (the Stats/Advanced Stats sub-tabs' own per-match fields, the
 *  most expensive queries this app runs), which is fetched lazily, client-side, only once one of
 *  those two sub-tabs is actually opened — see `getRegularSeasonStatsView()` below and
 *  `SeasonTabView`. `seasonNumber` is accepted rather than re-resolved here since every caller (the
 *  page's own initial render, the lazy tab-switch route) already has it in hand. */
export const getRegularSeasonLightView = persistentQuery('getRegularSeasonLightView', async (
  seasonId: number,
  seasonNumber: number | null,
): Promise<RegularSeasonLightView> => {
  const [schedule, ehogRatings, hasAdvancedStats, playersById] = await Promise.all([
    getSeasonSchedule(seasonId),
    getSeasonEhogRatings(seasonId),
    hasSeasonSabremetrics(seasonId),
    getPlayersById(),
  ]);
  // Computed from `schedule` — already fetched above — instead of a second, redundant
  // getH2HData() round-trip over the same matches (see #441).
  const h2hData = computeH2H(scheduleToH2HInput(schedule, seasonNumber), playersById);
  return { schedule, h2hData, ehogRatings, hasAdvancedStats };
});

/** The Regular Season tab's Stats/Advanced Stats sub-tab fields — see `RegularSeasonLightView`'s
 *  own doc comment for why these are split out and fetched separately, lazily. */
export const getRegularSeasonStatsView = persistentQuery('getRegularSeasonStatsView', async (seasonId: number): Promise<SeasonStatsView> => {
  const [sabremetrics, matchRounds, matchKills, matchWeaponClassStats, matchEconomyStats] = await Promise.all([
    getAllSabremetrics(seasonId),
    getAllMatchRounds(seasonId),
    getAllMatchKills(seasonId),
    getAllWeaponClassStats(seasonId),
    getAllEconomyStats(seasonId),
  ]);
  return { sabremetrics, matchRounds, matchKills, matchWeaponClassStats, matchEconomyStats };
});
