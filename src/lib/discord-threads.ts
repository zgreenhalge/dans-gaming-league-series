// Best-effort Discord forum-thread automation for weekly matches (#398) and gauntlet pods. One
// thread per match in a regular season's `season-{N}` forum channel (`extractSeasonNumber()`'s
// convention), opening post tagging the four rostered players — `publishWeekThreads()`. A gauntlet
// pod's two games share the same 4 players and are always played sequentially, so they get one
// thread between them instead ("Round N Pod M") — `publishPodThreads()`, resolving to the same
// `season-{N}` channel as the pod's paired regular season. Always admin-triggered — a season's
// `start_date` is often arbitrary and so is when an admin actually wants a week/round published, so
// there's no automatic Sunday-midnight cron here, only these two functions called from
// `POST /api/seasons/[id]/discord-threads`. Every match's (or pod's) outcome is both recorded to
// `ops_errors` (`discord_thread_create`, entity `match`) and returned directly to the caller, since a
// channel permission overwrite is the likeliest first-attempt failure and needs to be visible
// immediately in the admin console, not only in the Activity feed on a later page load.
// `closeMatchThread()`/`closeGauntletPodThreadIfDone()` are the other half — archive + lock a
// thread once it has nothing left to coordinate, called from `writeMatchScore()`'s (`matchScore.ts`)
// best-effort hooks on every score write (same spot `notifyMatchScoreReported()` fires from), not
// from either publish function.
//
// Idempotency is checked against Discord itself, not `match_discord_state` — an admin can create a
// thread by hand (or a previous run's Discord call could have succeeded right before its own DB
// write failed), and the DB would have no record of it either way. `listChannelThreads()` reads the
// forum channel's actual threads before creating anything, matched by exact title (`threadTitle()`'s
// "Week N Game M", or `podThreadTitle()`'s "Round N Pod M") — the only link back to a match/pod a
// hand-made thread can carry. A title that already exists in the channel is never posted into or
// otherwise touched — its thread id is just adopted into `match_discord_state` (both games' rows, for
// a pod) so the close functions can still find it once played.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule, findNextUnplayedWeek, getGauntletRounds, getGauntletPodForMatch, getPlayersById, groupPodMatches } from './queries';
import type { WeekWithMatches, MatchWithRoster } from './queries/schedule';
import type { GauntletMatch, GauntletRound } from './queries/gauntlet';
import { extractSeasonNumber, isPlayedScore, allMatchesPlayed } from './util';
import { recordOpsError, clearOpsError } from './ops-errors';
import { POD_GAME_GAP_LABEL } from './gauntlet-pod';

const CHANNEL_OPERATION = 'discord_thread_publish';
const THREAD_OPERATION = 'discord_thread_create';
const THREAD_CLOSE_OPERATION = 'discord_thread_close';
const DISCORD_FORUM_CHANNEL_TYPE = 15;

export interface ThreadPublishResult {
  matchId: number;
  title: string;
  status: 'created' | 'skipped' | 'failed';
  detail: string;
}

export interface PublishWeekThreadsResult {
  seasonName: string;
  weekNumber: number;
  matches: ThreadPublishResult[];
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

/** Formats a non-ok Discord response as `"{prefix} returned {status}: {message}"` — the one shared
 *  shape every Discord call in this file uses to describe a failure, both for an `ops_errors` message
 *  and a result's own `detail`; also used by `discord-notify.ts`. */
export async function discordErrorDetail(prefix: string, res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return `${prefix} returned ${res.status}${body?.message ? `: ${body.message}` : ''}`;
}

/** Resolves a season's forum channel by its `season-{N}` name — Discord's thread-creation endpoint
 *  needs a channel id, not a name, and there's no lookup-by-name API. Distinguishes "no such channel"
 *  from "wrong channel type" in its error, since a misnamed or non-forum channel is a plausible
 *  first-attempt setup mistake distinct from a permissions problem. Also the entry point
 *  `discord-event-sync.ts` uses to find a season's threads in the first place. */
export async function resolveSeasonForumChannel(
  guildId: string,
  token: string,
  seasonName: string,
): Promise<{ channelId: string } | { error: string }> {
  const seasonNumber = extractSeasonNumber(seasonName);
  if (seasonNumber === null) return { error: `Could not extract a season number from "${seasonName}"` };
  const expectedName = `season-${seasonNumber}`;

  let res: Response;
  try {
    res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
    });
  } catch (e) {
    return { error: `Listing guild channels failed: ${(e as Error).message}` };
  }
  if (!res.ok) {
    return { error: await discordErrorDetail('Listing guild channels', res) };
  }
  const channels = (await res.json()) as DiscordChannel[];
  const channel = channels.find((c) => c.name === expectedName);
  if (!channel) return { error: `No channel named "${expectedName}" found in the guild — check the forum channel exists and the bot can see it` };
  if (channel.type !== DISCORD_FORUM_CHANNEL_TYPE) {
    return { error: `"${expectedName}" is not a forum channel (type ${channel.type})` };
  }
  return { channelId: channel.id };
}

/** A match's Discord thread title, "Week N Game M" — also how `discord-event-sync.ts` finds a
 *  match's thread in the first place (via `listChannelThreads()`'s title match), independently of
 *  `match_discord_state`. */
export function threadTitle(weekNumber: number, matchNumber: number): string {
  return `Week ${weekNumber} Game ${matchNumber}`;
}

/** A gauntlet pod's Discord thread title, "Round N Pod M" (1-based, `podIndex` is 0-based) — one
 *  thread per pod, not per game, since both of a pod's games share the same 4 players and are
 *  scheduled/played as a unit. Same idempotency role `threadTitle()` plays for weekly threads. */
export function podThreadTitle(roundNumber: number, podIndex: number): string {
  return `Round ${roundNumber} Pod ${podIndex + 1}`;
}

export interface DiscordThread {
  id: string;
  name: string;
  parent_id?: string | null;
}

/** Every thread Discord currently has in this forum channel — active, plus the first page (100, the
 *  API max) of publicly archived ones, which comfortably covers a single season's worth of weekly
 *  threads. The active-threads endpoint is guild-wide (Discord has no per-channel version), hence the
 *  `parent_id` filter; the archived one is already channel-scoped. Read once per `publishWeekThreads()`
 *  call and matched by title against every match in the target week, rather than trusting
 *  `match_discord_state` — see this file's header. `discord-event-sync.ts` reuses this same
 *  title-matched lookup to find each match's thread id before scanning it for a shared event. */
export async function listChannelThreads(
  guildId: string,
  channelId: string,
  token: string,
): Promise<DiscordThread[] | { error: string }> {
  const headers = { Authorization: `Bot ${token}` };
  let activeRes: Response;
  let archivedRes: Response;
  try {
    [activeRes, archivedRes] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, { headers }),
      fetch(`https://discord.com/api/v10/channels/${channelId}/threads/archived/public?limit=100`, { headers }),
    ]);
  } catch (e) {
    return { error: `Listing existing threads failed: ${(e as Error).message}` };
  }
  if (!activeRes.ok) return { error: await discordErrorDetail('Listing active threads', activeRes) };
  if (!archivedRes.ok) return { error: await discordErrorDetail('Listing archived threads', archivedRes) };

  const active = (await activeRes.json()) as { threads: DiscordThread[] };
  const archived = (await archivedRes.json()) as { threads: DiscordThread[] };
  return [...active.threads.filter((t) => t.parent_id === channelId), ...archived.threads];
}

/** A player's opening-post mention: the `<@discord_id>` tag when they've linked their Discord
 *  account, else their plain DGLS name. Shared by a weekly match's and a gauntlet pod's opening
 *  posts alike. */
function mentionOrName(p: { player_id: number; player_name: string }, playersById: Map<number, { discord_id: string | null }>): string {
  const discordId = playersById.get(p.player_id)?.discord_id;
  return discordId ? `<@${discordId}>` : p.player_name;
}

/** One game's "A & B vs C & D" lineup line, mentioning each player per `mentionOrName()`. */
function lineup(
  shirts: { player_id: number; player_name: string }[],
  skins: { player_id: number; player_name: string }[],
  playersById: Map<number, { discord_id: string | null }>,
): string {
  return `${shirts.map((p) => mentionOrName(p, playersById)).join(' & ')} vs ${skins.map((p) => mentionOrName(p, playersById)).join(' & ')}`;
}

/** One match's opening-post body. */
function openingPost(match: MatchWithRoster, playersById: Map<number, { discord_id: string | null }>): string {
  return lineup(match.shirts, match.skins, playersById);
}

/** Creates (or adopts, per this file's header) a Discord thread and points every match in
 *  `matchIds` at it via `match_discord_state` — shared mechanics behind a weekly match's own thread
 *  (`matchIds` of length 1, via `publishWeekThreads()`) and a gauntlet pod's shared thread (length 2,
 *  via `publishPodThreads()`). `matchIds[0]` is the "anchor" `ops_errors`/result key either way. */
async function publishThread(
  supabaseAdmin: SupabaseClient,
  channelId: string,
  token: string,
  title: string,
  content: string,
  matchIds: number[],
  existingThreadId: string | undefined,
): Promise<ThreadPublishResult> {
  const anchorId = matchIds[0];
  const stateRows = (threadId: string) => matchIds.map((matchId) => ({ match_id: matchId, thread_id: threadId }));

  if (existingThreadId) {
    await supabaseAdmin.from('match_discord_state').upsert(stateRows(existingThreadId), { onConflict: 'match_id' });
    await recordOpsError(
      supabaseAdmin, 'match', anchorId, THREAD_OPERATION,
      `Thread "${title}" already exists in the channel (${existingThreadId}) — adopted it instead of creating a duplicate`,
    );
    return { matchId: anchorId, title, status: 'skipped', detail: `Already exists (thread ${existingThreadId})` };
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: title, message: { content } }),
    });
    if (!res.ok) {
      const detail = await discordErrorDetail('Thread create', res);
      await recordOpsError(supabaseAdmin, 'match', anchorId, THREAD_OPERATION, detail);
      return { matchId: anchorId, title, status: 'failed', detail };
    }
    const thread = (await res.json()) as { id: string };
    await supabaseAdmin.from('match_discord_state').upsert(stateRows(thread.id), { onConflict: 'match_id' });
    await clearOpsError(supabaseAdmin, 'match', anchorId, THREAD_OPERATION);
    return { matchId: anchorId, title, status: 'created', detail: `Thread ${thread.id}` };
  } catch (e) {
    const detail = `Thread create failed: ${(e as Error).message}`;
    await recordOpsError(supabaseAdmin, 'match', anchorId, THREAD_OPERATION, detail);
    return { matchId: anchorId, title, status: 'failed', detail };
  }
}

/** Resolves a season's forum channel and its already-existing threads — the season-level scaffold
 *  shared by `publishWeekThreads()` and `publishPodThreads()`. Records/clears the
 *  `discord_thread_publish` ops error itself. */
async function resolveChannelAndThreads(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  seasonName: string,
  guildId: string,
  token: string,
): Promise<{ channelId: string; existingByTitle: Map<string, string> } | { error: string }> {
  const channel = await resolveSeasonForumChannel(guildId, token, seasonName);
  if ('error' in channel) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, CHANNEL_OPERATION, channel.error);
    return { error: channel.error };
  }
  const existingThreads = await listChannelThreads(guildId, channel.channelId, token);
  if ('error' in existingThreads) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, CHANNEL_OPERATION, existingThreads.error);
    return { error: existingThreads.error };
  }
  await clearOpsError(supabaseAdmin, 'season', seasonId, CHANNEL_OPERATION);
  return { channelId: channel.channelId, existingByTitle: new Map(existingThreads.map((t) => [t.name, t.id])) };
}

function resolveTargetWeek(schedule: WeekWithMatches[], week: number | 'next'): WeekWithMatches | null {
  return week === 'next' ? findNextUnplayedWeek(schedule) : schedule.find((w) => w.week_number === week) ?? null;
}

/** Archives + locks a single match's Discord thread, if it has one — `writeMatchScore()`'s
 *  (`matchScore.ts`) best-effort hook, called unconditionally on every score write, including an
 *  admin's later correction. No-ops without `DISCORD_BOT_TOKEN` or without a recorded
 *  `match_discord_state.thread_id` — most matches were never threaded in the first place.
 *  Archiving/locking an already-archived thread is a harmless no-op on Discord's side, so a retry (or
 *  a repeat call on a match that's already closed) can't double-fail — there's no need to gate this
 *  on a first-time score. Never throws: the `match_discord_state` read and the Discord call share one
 *  try/catch, recording a real failure to `ops_errors` rather than letting it propagate into
 *  `writeMatchScore()`'s `Promise.all`. */
export async function closeMatchThread(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  try {
    const { data } = await supabaseAdmin
      .from('match_discord_state')
      .select('thread_id')
      .eq('match_id', matchId)
      .maybeSingle();
    const threadId = (data as { thread_id: string | null } | null)?.thread_id ?? null;
    if (!threadId) return;

    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true, locked: true }),
    });
    if (!res.ok) {
      const detail = await discordErrorDetail('Thread close', res);
      await recordOpsError(supabaseAdmin, 'match', matchId, THREAD_CLOSE_OPERATION, detail);
      return;
    }
    await clearOpsError(supabaseAdmin, 'match', matchId, THREAD_CLOSE_OPERATION);
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'match', matchId, THREAD_CLOSE_OPERATION, `Thread close failed: ${(e as Error).message}`);
  }
}

/** Publishes one week's match threads for a regular season. `week` is either an explicit week number
 *  or `'next'`, resolved via `findNextUnplayedWeek()` — the first week with no played matches yet,
 *  not the calendar-current week `findCurrentWeek()` gives the home page and `/scheduled` — since
 *  out-of-order match entry means those can disagree on which week still needs threads. Threads are
 *  created one at a time rather than in parallel, out of caution around
 *  Discord's per-route rate limits on forum thread creation. Returns `{ error }` for a season-level
 *  failure (bad season, unconfigured Discord, channel not found/wrong type, no such week) before any
 *  match is attempted; otherwise every match's own outcome, whether or not some of them failed. */
export async function publishWeekThreads(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  week: number | 'next',
): Promise<PublishWeekThreadsResult | { error: string }> {
  const season = await getSeason(seasonId);
  if (!season) return { error: 'Season not found' };
  if (season.is_gauntlet) return { error: 'Gauntlet seasons do not use weekly match threads' };

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { error: 'Discord is not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)' };

  const schedule = await getSeasonSchedule(seasonId);
  const targetWeek = resolveTargetWeek(schedule, week);
  if (!targetWeek) return { error: week === 'next' ? 'No upcoming week found' : `Week ${week} not found` };
  if (targetWeek.matches.length === 0) return { error: `Week ${targetWeek.week_number} has no matches` };

  const resolved = await resolveChannelAndThreads(supabaseAdmin, seasonId, season.name, guildId, token);
  if ('error' in resolved) return resolved;
  const { channelId, existingByTitle } = resolved;

  const playersById = await getPlayersById();
  const results: ThreadPublishResult[] = [];
  for (const match of targetWeek.matches) {
    const title = threadTitle(targetWeek.week_number, match.match_number);
    results.push(
      await publishThread(supabaseAdmin, channelId, token, title, openingPost(match, playersById), [match.id], existingByTitle.get(title)),
    );
  }

  return { seasonName: season.name, weekNumber: targetWeek.week_number, matches: results };
}

function resolveTargetRound(rounds: GauntletRound[], round: number | 'next'): GauntletRound | null {
  return round === 'next'
    ? rounds.find((r) => r.matches.some((m) => !isPlayedScore(m.final_score))) ?? null
    : rounds.find((r) => r.round_number === round) ?? null;
}

/** A pod's opening post: both games' shirts-vs-skins lineups. Both games share the same 4 players
 *  reshuffled across factions, so this is the one place a pod thread actually distinguishes them. */
function podOpeningPost(game1: GauntletMatch, game2: GauntletMatch, playersById: Map<number, { discord_id: string | null }>): string {
  return `Game 1: ${lineup(game1.shirts_stats, game1.skins_stats, playersById)}\n` +
    `Game 2 (${POD_GAME_GAP_LABEL} later): ${lineup(game2.shirts_stats, game2.skins_stats, playersById)}`;
}

export interface PublishPodThreadsResult {
  seasonName: string;
  roundNumber: number;
  pods: ThreadPublishResult[];
}

/** Publishes one round's pod threads for a gauntlet season — the pod counterpart to
 *  `publishWeekThreads()`, resolving to the same `season-{N}` forum channel as the paired regular
 *  season (`extractSeasonNumber()` parses "Season N Gauntlet" the same as "Season N"). `round` is
 *  either an explicit round number or `'next'`, resolved as the first round with any unplayed game.
 *  A pod whose two games aren't both materialized yet is reported `failed` rather than attempted —
 *  there's nothing to link to until it is. */
export async function publishPodThreads(
  supabaseAdmin: SupabaseClient,
  gauntletSeasonId: number,
  round: number | 'next',
): Promise<PublishPodThreadsResult | { error: string }> {
  const season = await getSeason(gauntletSeasonId);
  if (!season) return { error: 'Season not found' };
  if (!season.is_gauntlet) return { error: 'Not a gauntlet season' };

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { error: 'Discord is not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)' };

  const rounds = await getGauntletRounds(gauntletSeasonId);
  const targetRound = resolveTargetRound(rounds, round);
  if (!targetRound) return { error: round === 'next' ? 'No upcoming round found' : `Round ${round} not found` };

  const byPod = groupPodMatches(targetRound);
  if (byPod.size === 0) return { error: `Round ${targetRound.round_number} has no materialized pods` };

  const resolved = await resolveChannelAndThreads(supabaseAdmin, gauntletSeasonId, season.name, guildId, token);
  if ('error' in resolved) return resolved;
  const { channelId, existingByTitle } = resolved;

  const playersById = await getPlayersById();
  const results: ThreadPublishResult[] = [];
  for (const [podIndex, matches] of [...byPod.entries()].sort((a, b) => a[0] - b[0])) {
    const title = podThreadTitle(targetRound.round_number, podIndex);
    if (matches.length !== 2) {
      results.push({ matchId: matches[0]?.id ?? 0, title, status: 'failed', detail: 'Pod is not fully materialized (expected 2 games)' });
      continue;
    }
    const [game1, game2] = [...matches].sort((a, b) => a.match_number - b.match_number);
    results.push(
      await publishThread(supabaseAdmin, channelId, token, title, podOpeningPost(game1, game2, playersById), [game1.id, game2.id], existingByTitle.get(title)),
    );
  }

  return { seasonName: season.name, roundNumber: targetRound.round_number, pods: results };
}

/** Gauntlet counterpart to `closeMatchThread()` — a pod's thread coordinates both of its games, so
 *  it must not archive/lock after only the first is scored. No-ops until both of the pod's games
 *  have a played score, then closes the shared thread via either game's `match_discord_state` row
 *  (`publishPodThreads()` points both at the same thread id). No-ops (not an error) for a match with
 *  no resolvable pod. */
export async function closeGauntletPodThreadIfDone(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const pod = await getGauntletPodForMatch(matchId);
  if (!pod) return;

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, final_score')
    .in('id', [pod.match1_id, pod.match2_id]);
  if (error) {
    console.error(`closeGauntletPodThreadIfDone(${matchId}) failed to read pod matches:`, error);
    return;
  }
  const matches = (data ?? []) as { id: number; final_score: string | null }[];
  if (matches.length !== 2 || !allMatchesPlayed(matches)) return;

  await closeMatchThread(supabaseAdmin, matchId);
}
