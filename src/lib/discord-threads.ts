// Best-effort Discord forum-thread automation for weekly matches (#398). One thread per match in a
// regular season's `season-{N}` forum channel (`extractSeasonNumber()`'s convention), opening post
// tagging the four rostered players. Always admin-triggered — a season's `start_date` is often
// arbitrary and so is when an admin actually wants a week published, so there's no automatic
// Sunday-midnight cron here, only `publishWeekThreads()` called from
// `POST /api/seasons/[id]/discord-threads`. Every match's outcome is both recorded to `ops_errors`
// (`discord_thread_create`, entity `match`) and returned directly to the caller, since a channel
// permission overwrite is the likeliest first-attempt failure and needs to be visible immediately in
// the admin console, not only in the Activity feed on a later page load. `closeMatchThread()` is the
// other half — archives + locks one match's thread once it has nothing left to coordinate, called
// from `PATCH /api/matches/[id]/score`'s best-effort hooks on the transition into "played" (same spot
// `notifyMatchScoreReported()` fires from), not from `publishWeekThreads()`.
//
// Idempotency is checked against Discord itself, not `match_discord_state` — an admin can create a
// match's thread by hand (or a previous run's Discord call could have succeeded right before its own
// DB write failed), and the DB would have no record of it either way. `listChannelThreads()` reads
// the forum channel's actual threads before creating anything, matched by exact title
// (`threadTitle()`'s "Week N Game M"), the only link back to a match a hand-made thread can carry. A
// match whose title already exists in the channel is never posted into or otherwise touched — its
// thread id is just adopted into `match_discord_state` so `closeMatchThread()` can still find it once
// the match is played.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule, findCurrentWeek, getPlayersById } from './queries';
import type { WeekWithMatches, MatchWithRoster } from './queries/schedule';
import { extractSeasonNumber } from './util';
import { recordOpsError, clearOpsError } from './ops-errors';

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
 *  first-attempt setup mistake distinct from a permissions problem. */
async function resolveSeasonForumChannel(
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

function threadTitle(weekNumber: number, matchNumber: number): string {
  return `Week ${weekNumber} Game ${matchNumber}`;
}

interface DiscordThread {
  id: string;
  name: string;
  parent_id?: string | null;
}

/** Every thread Discord currently has in this forum channel — active, plus the first page (100, the
 *  API max) of publicly archived ones, which comfortably covers a single season's worth of weekly
 *  threads. The active-threads endpoint is guild-wide (Discord has no per-channel version), hence the
 *  `parent_id` filter; the archived one is already channel-scoped. Read once per `publishWeekThreads()`
 *  call and matched by title against every match in the target week, rather than trusting
 *  `match_discord_state` — see this file's header. */
async function listChannelThreads(
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

/** One match's opening-post body — mentions every rostered player who's linked their Discord account
 *  (`<@discord_id>`), falling back to their plain DGLS name for anyone unlinked. */
function openingPost(match: MatchWithRoster, playersById: Map<number, { discord_id: string | null }>): string {
  const mention = (p: { player_id: number; player_name: string }) => {
    const discordId = playersById.get(p.player_id)?.discord_id;
    return discordId ? `<@${discordId}>` : p.player_name;
  };
  return `${match.shirts.map(mention).join(' & ')} vs ${match.skins.map(mention).join(' & ')}`;
}

/** Creates one match's Discord thread — unless `existingThreadId` says Discord already has one titled
 *  for this match (looked up once per `publishWeekThreads()` call via `listChannelThreads()`, not
 *  read from `match_discord_state`), in which case it's adopted into the DB rather than duplicated or
 *  posted into. Either way the outcome is recorded to `ops_errors` (same "detected, skipped, needs
 *  admin eyes" pattern as a real failure for the adopt case) so a re-publish attempt on an
 *  already-published week is visible, not silently a no-op. */
async function publishMatchThread(
  supabaseAdmin: SupabaseClient,
  channelId: string,
  token: string,
  weekNumber: number,
  match: MatchWithRoster,
  playersById: Map<number, { discord_id: string | null }>,
  existingThreadId: string | undefined,
): Promise<ThreadPublishResult> {
  const title = threadTitle(weekNumber, match.match_number);

  if (existingThreadId) {
    await supabaseAdmin
      .from('match_discord_state')
      .upsert({ match_id: match.id, thread_id: existingThreadId }, { onConflict: 'match_id' });
    await recordOpsError(
      supabaseAdmin, 'match', match.id, THREAD_OPERATION,
      `Thread "${title}" already exists in the channel (${existingThreadId}) — adopted it instead of creating a duplicate`,
    );
    return { matchId: match.id, title, status: 'skipped', detail: `Already exists (thread ${existingThreadId})` };
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: title, message: { content: openingPost(match, playersById) } }),
    });
    if (!res.ok) {
      const detail = await discordErrorDetail('Thread create', res);
      await recordOpsError(supabaseAdmin, 'match', match.id, THREAD_OPERATION, detail);
      return { matchId: match.id, title, status: 'failed', detail };
    }
    const thread = (await res.json()) as { id: string };
    await supabaseAdmin
      .from('match_discord_state')
      .upsert({ match_id: match.id, thread_id: thread.id }, { onConflict: 'match_id' });
    await clearOpsError(supabaseAdmin, 'match', match.id, THREAD_OPERATION);
    return { matchId: match.id, title, status: 'created', detail: `Thread ${thread.id}` };
  } catch (e) {
    const detail = `Thread create failed: ${(e as Error).message}`;
    await recordOpsError(supabaseAdmin, 'match', match.id, THREAD_OPERATION, detail);
    return { matchId: match.id, title, status: 'failed', detail };
  }
}

function resolveTargetWeek(schedule: WeekWithMatches[], startDate: string | null, week: number | 'next'): WeekWithMatches | null {
  return week === 'next' ? findCurrentWeek(schedule, startDate) : schedule.find((w) => w.week_number === week) ?? null;
}

/** Archives + locks a single match's Discord thread, if it has one — the score route's best-effort
 *  hook, called only on the transition into "played" (an admin correcting an already-played score
 *  shouldn't re-attempt closing a thread that's presumably already closed). No-ops without
 *  `DISCORD_BOT_TOKEN` or without a recorded `match_discord_state.thread_id` — most matches were
 *  never threaded in the first place. Archiving/locking an already-archived thread is a harmless
 *  no-op on Discord's side, so a retry (or an admin re-editing a score) can't double-fail. */
export async function closeMatchThread(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  const { data } = await supabaseAdmin
    .from('match_discord_state')
    .select('thread_id')
    .eq('match_id', matchId)
    .maybeSingle();
  const threadId = (data as { thread_id: string | null } | null)?.thread_id;
  if (!threadId) return;

  try {
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
 *  or `'next'`, resolved via `findCurrentWeek()` — the same helper the home page and the `/scheduled`
 *  Discord command use — so "publish next week" can never disagree with what the rest of the site
 *  calls "next week." Threads are created one at a time rather than in parallel, out of caution around
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
  const targetWeek = resolveTargetWeek(schedule, season.start_date, week);
  if (!targetWeek) return { error: week === 'next' ? 'No upcoming week found' : `Week ${week} not found` };
  if (targetWeek.matches.length === 0) return { error: `Week ${targetWeek.week_number} has no matches` };

  const channel = await resolveSeasonForumChannel(guildId, token, season.name);
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
  const existingByTitle = new Map(existingThreads.map((t) => [t.name, t.id]));

  const playersById = await getPlayersById();
  const results: ThreadPublishResult[] = [];
  for (const match of targetWeek.matches) {
    const title = threadTitle(targetWeek.week_number, match.match_number);
    results.push(
      await publishMatchThread(supabaseAdmin, channel.channelId, token, targetWeek.week_number, match, playersById, existingByTitle.get(title)),
    );
  }

  return { seasonName: season.name, weekNumber: targetWeek.week_number, matches: results };
}
