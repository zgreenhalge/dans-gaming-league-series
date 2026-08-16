// Best-effort Discord forum-thread automation for weekly matches (#398). One thread per match in a
// regular season's `season-{N}` forum channel (`extractSeasonNumber()`'s convention), opening post
// tagging the four rostered players. Always admin-triggered — a season's `start_date` is often
// arbitrary and so is when an admin actually wants a week published, so there's no automatic
// Sunday-midnight cron here, only `publishWeekThreads()` called from
// `POST /api/seasons/[id]/discord-threads`. Every match's outcome is both recorded to `ops_errors`
// (`discord_thread_create`, entity `match`) and returned directly to the caller, since a channel
// permission overwrite is the likeliest first-attempt failure and needs to be visible immediately in
// the admin console, not only in the Activity feed on a later page load. Each publish also sweeps the
// whole season for existing threads whose match has since been played and archives/locks them
// (`discord_thread_close`) — there's no separate trigger for this, it rides along with whatever
// already calls `publishWeekThreads()`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule, findCurrentWeek, getPlayersById } from './queries';
import type { WeekWithMatches, MatchWithRoster } from './queries/schedule';
import { extractSeasonNumber, isPlayedScore } from './util';
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

export interface ThreadCloseResult {
  matchId: number;
  title: string;
  status: 'closed' | 'failed';
  detail: string;
}

export interface PublishWeekThreadsResult {
  seasonName: string;
  weekNumber: number;
  matches: ThreadPublishResult[];
  closed: ThreadCloseResult[];
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
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
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { error: `Listing guild channels returned ${res.status}${body?.message ? `: ${body.message}` : ''}` };
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

/** One match's opening-post body — mentions every rostered player who's linked their Discord account
 *  (`<@discord_id>`), falling back to their plain DGLS name for anyone unlinked. */
function openingPost(match: MatchWithRoster, playersById: Map<number, { discord_id: string | null }>): string {
  const mention = (p: { player_id: number; player_name: string }) => {
    const discordId = playersById.get(p.player_id)?.discord_id;
    return discordId ? `<@${discordId}>` : p.player_name;
  };
  return `${match.shirts.map(mention).join(' & ')} vs ${match.skins.map(mention).join(' & ')}`;
}

/** Creates one match's Discord thread. Idempotent: a match that already has
 *  `match_discord_state.thread_id` set is skipped rather than duplicated, and the skip itself is
 *  recorded to `ops_errors` (same "detected, skipped, needs admin eyes" pattern as a real failure) so
 *  a re-publish attempt on an already-published week is visible, not silently a no-op. */
async function publishMatchThread(
  supabaseAdmin: SupabaseClient,
  channelId: string,
  token: string,
  weekNumber: number,
  match: MatchWithRoster,
  playersById: Map<number, { discord_id: string | null }>,
): Promise<ThreadPublishResult> {
  const title = threadTitle(weekNumber, match.match_number);

  const { data: existing } = await supabaseAdmin
    .from('match_discord_state')
    .select('thread_id')
    .eq('match_id', match.id)
    .maybeSingle();
  const existingThreadId = (existing as { thread_id: string | null } | null)?.thread_id;
  if (existingThreadId) {
    await recordOpsError(
      supabaseAdmin, 'match', match.id, THREAD_OPERATION,
      `Already has a thread (${existingThreadId}) — skipped duplicate create for "${title}"`,
    );
    return { matchId: match.id, title, status: 'skipped', detail: `Already published (thread ${existingThreadId})` };
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: title, message: { content: openingPost(match, playersById) } }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      const detail = `Thread create returned ${res.status}${body?.message ? `: ${body.message}` : ''}`;
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

/** Archives + locks the Discord thread for every played match across the whole season (not just the
 *  week being published) that still has one open — a played match's thread has nothing left to
 *  coordinate, so it's swept closed as a side effect of whatever publish call happens to run next
 *  rather than needing its own trigger. Archiving/locking an already-archived thread is a harmless
 *  no-op on Discord's side, so this doesn't need to track "already closed" itself — it just re-checks
 *  every played match with a thread on every call. */
async function closePlayedMatchThreads(
  supabaseAdmin: SupabaseClient,
  token: string,
  schedule: WeekWithMatches[],
): Promise<ThreadCloseResult[]> {
  const playedMatches = schedule.flatMap((w) =>
    w.matches.filter((m) => isPlayedScore(m.final_score)).map((m) => ({ ...m, weekNumber: w.week_number })),
  );
  if (playedMatches.length === 0) return [];

  const { data } = await supabaseAdmin
    .from('match_discord_state')
    .select('match_id, thread_id')
    .in('match_id', playedMatches.map((m) => m.id))
    .not('thread_id', 'is', null);
  const threadByMatch = new Map(
    ((data ?? []) as { match_id: number; thread_id: string }[]).map((r) => [r.match_id, r.thread_id]),
  );

  const results: ThreadCloseResult[] = [];
  for (const match of playedMatches) {
    const threadId = threadByMatch.get(match.id);
    if (!threadId) continue;
    const title = threadTitle(match.weekNumber, match.match_number);
    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true, locked: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        const detail = `Thread close returned ${res.status}${body?.message ? `: ${body.message}` : ''}`;
        await recordOpsError(supabaseAdmin, 'match', match.id, THREAD_CLOSE_OPERATION, detail);
        results.push({ matchId: match.id, title, status: 'failed', detail });
        continue;
      }
      await clearOpsError(supabaseAdmin, 'match', match.id, THREAD_CLOSE_OPERATION);
      results.push({ matchId: match.id, title, status: 'closed', detail: `Thread ${threadId} archived & locked` });
    } catch (e) {
      const detail = `Thread close failed: ${(e as Error).message}`;
      await recordOpsError(supabaseAdmin, 'match', match.id, THREAD_CLOSE_OPERATION, detail);
      results.push({ matchId: match.id, title, status: 'failed', detail });
    }
  }
  return results;
}

/** Publishes one week's match threads for a regular season. `week` is either an explicit week number
 *  or `'next'`, resolved via `findCurrentWeek()` — the same helper the home page and the `/scheduled`
 *  Discord command use — so "publish next week" can never disagree with what the rest of the site
 *  calls "next week." Threads are created one at a time rather than in parallel, out of caution around
 *  Discord's per-route rate limits on forum thread creation. Also sweeps and closes (`closed`) every
 *  played match's thread across the whole season, not just the published week — see
 *  `closePlayedMatchThreads()`. Returns `{ error }` for a season-level failure (bad season,
 *  unconfigured Discord, channel not found/wrong type, no such week) before any match is attempted;
 *  otherwise every match's own create/close outcome, whether or not some of them failed. */
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
  await clearOpsError(supabaseAdmin, 'season', seasonId, CHANNEL_OPERATION);

  const playersById = await getPlayersById();
  const results: ThreadPublishResult[] = [];
  for (const match of targetWeek.matches) {
    results.push(await publishMatchThread(supabaseAdmin, channel.channelId, token, targetWeek.week_number, match, playersById));
  }

  const closed = await closePlayedMatchThreads(supabaseAdmin, token, schedule);

  return { seasonName: season.name, weekNumber: targetWeek.week_number, matches: results, closed };
}
