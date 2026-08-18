// Best-effort Discord scheduled-event time sync-back for weekly matches (#398). Rather than trusting
// a player to name their Discord Scheduled Event to match the site's own "Week N Game M" convention
// (easy to typo, retype wrong, or just not bother with), this watches each match's own thread for
// Discord's own "Share to Channel" action on an event — which posts an ordinary message containing
// the event's `discord.com/events/{guild}/{event}` link. That link *is* the correlation: an exact
// event id, sourced from the platform itself, not a freeform string two humans have to agree on.
//
// Threads are found the same title-matched way `publishWeekThreads()` finds them
// (`resolveSeasonForumChannel()` + `listChannelThreads()`, both exported from `discord-threads.ts`)
// rather than via `match_discord_state` — a thread nobody has "published" through the bot yet (an
// admin or player made it by hand) still gets found and scanned, exactly like a hand-made thread
// still gets adopted by a `publishWeekThreads()` re-run. No gateway bot required — this is a plain
// REST poll (`discord-event-sync.yml`) against whichever season is currently `ACTIVE`.
//
// "First shared" means earliest by post time, not most recent: `findFirstSharedEventId()` walks a
// thread's message history backward to its actual start (Discord returns newest-first) rather than
// just reading the first page, so a stale link left behind by an early false start can't beat out
// whatever the players actually settled on later in the same thread — the loop keeps overwriting its
// running answer with each older match it finds, so the true earliest survives. Only unplayed matches
// (`isPlayedScore()`) are scanned, so a completed match's slot is never touched. A match with no
// thread yet, or a thread with nothing shared in it yet, is not a failure — most matches won't have
// either until players get around to it — so it's reported `no_thread`/`no_event` but never recorded
// to `ops_errors`; only a genuine Discord API failure or a write failure updating `matches.scheduled_at` is.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule } from './queries';
import { isPlayedScore } from './util';
import { discordErrorDetail, resolveSeasonForumChannel, listChannelThreads, threadTitle } from './discord-threads';
import { recordOpsError, clearOpsError } from './ops-errors';

const EVENT_SYNC_OPERATION = 'discord_event_sync';
const MESSAGE_PAGE_SIZE = 100;
// Bounds the worst case for an unexpectedly long-lived thread — 10 pages comfortably covers any
// realistic weekly match thread, which these are meant to be short-lived by design.
const MAX_MESSAGE_PAGES = 10;

// Discord guild-scheduled-event `status`: SCHEDULED=1, ACTIVE=2, COMPLETED=3, CANCELED=4. Only the
// first two describe a still-relevant start time — a completed or canceled event's time is stale
// and shouldn't overwrite `scheduled_at`.
const LIVE_EVENT_STATUSES = new Set([1, 2]);

interface DiscordScheduledEvent {
  id: string;
  scheduled_start_time: string;
  status: number;
}

interface DiscordMessage {
  id: string;
  content: string;
  embeds?: { url?: string }[];
}

export interface EventSyncResult {
  matchId: number;
  title: string;
  status: 'synced' | 'unchanged' | 'no_thread' | 'no_event' | 'failed';
  detail: string;
}

export interface SyncSeasonEventsResult {
  seasonName: string;
  matches: EventSyncResult[];
}

async function listGuildScheduledEvents(
  guildId: string,
  token: string,
): Promise<DiscordScheduledEvent[] | { error: string }> {
  let res: Response;
  try {
    res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/scheduled-events`, {
      headers: { Authorization: `Bot ${token}` },
    });
  } catch (e) {
    return { error: `Listing scheduled events failed: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: await discordErrorDetail('Listing scheduled events', res) };
  return (await res.json()) as DiscordScheduledEvent[];
}

/** Pulls the event id out of a message's `/events/{guild}/{event}` link, checking both the raw
 *  content (what a manual paste, or Discord's own share action, posts as text) and any embed url
 *  (in case the message itself is otherwise empty and Discord's auto-unfurl is all that carries it).
 *  Scoped to our own guild id so a stray link to an unrelated server's event is never picked up. */
function extractEventId(message: DiscordMessage, guildId: string): string | null {
  const re = new RegExp(`discord\\.com/events/${guildId}/(\\d+)`);
  const haystack = [message.content, ...(message.embeds ?? []).map((e) => e.url ?? '')].join(' ');
  return haystack.match(re)?.[1] ?? null;
}

/** Finds the id of the earliest-posted scheduled-event share in a thread — see this file's header
 *  for why "earliest" matters and how the backward walk gets there. `null` means the thread has no
 *  such message (yet), not a failure. */
async function findFirstSharedEventId(
  threadId: string,
  guildId: string,
  token: string,
): Promise<{ eventId: string | null } | { error: string }> {
  let before: string | undefined;
  let earliest: string | null = null;

  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const url = `https://discord.com/api/v10/channels/${threadId}/messages?limit=${MESSAGE_PAGE_SIZE}${before ? `&before=${before}` : ''}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
    } catch (e) {
      return { error: `Listing thread messages failed: ${(e as Error).message}` };
    }
    if (!res.ok) return { error: await discordErrorDetail('Listing thread messages', res) };

    const messages = (await res.json()) as DiscordMessage[];
    if (messages.length === 0) break;
    // Newest-first within the page; iterating forward means the last match found here is this
    // page's own oldest, so it correctly overwrites a newer match found earlier in the same pass.
    for (const message of messages) {
      const eventId = extractEventId(message, guildId);
      if (eventId) earliest = eventId;
    }
    if (messages.length < MESSAGE_PAGE_SIZE) break; // fewer than a full page — reached the thread's start
    before = messages[messages.length - 1].id;
  }

  return { eventId: earliest };
}

/** Syncs one regular season's unplayed matches against events shared in their Discord threads.
 *  Returns `{ error }` for a season-level failure (bad season, unconfigured Discord, resolving the
 *  forum channel, or listing its threads/the guild's events) before any match is considered;
 *  otherwise every unplayed match's own outcome, matched or not. */
export async function syncSeasonScheduledEvents(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
): Promise<SyncSeasonEventsResult | { error: string }> {
  const season = await getSeason(seasonId);
  if (!season) return { error: 'Season not found' };
  if (season.is_gauntlet) return { error: 'Gauntlet seasons do not use weekly match threads' };

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { error: 'Discord is not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)' };

  const schedule = await getSeasonSchedule(seasonId);
  const unplayedByTitle = new Map<string, { id: number; scheduled_at: string | null }>();
  for (const week of schedule) {
    for (const match of week.matches) {
      if (isPlayedScore(match.final_score)) continue;
      unplayedByTitle.set(threadTitle(week.week_number, match.match_number), match);
    }
  }
  if (unplayedByTitle.size === 0) return { seasonName: season.name, matches: [] };

  const channel = await resolveSeasonForumChannel(guildId, token, season.name);
  if ('error' in channel) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION, channel.error);
    return { error: channel.error };
  }

  const threads = await listChannelThreads(guildId, channel.channelId, token);
  if ('error' in threads) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION, threads.error);
    return { error: threads.error };
  }

  const events = await listGuildScheduledEvents(guildId, token);
  if ('error' in events) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION, events.error);
    return { error: events.error };
  }
  await clearOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION);

  const threadIdByTitle = new Map(threads.map((t) => [t.name, t.id]));
  const eventsById = new Map(events.filter((e) => LIVE_EVENT_STATUSES.has(e.status)).map((e) => [e.id, e]));

  const results: EventSyncResult[] = [];
  for (const [title, match] of unplayedByTitle) {
    const threadId = threadIdByTitle.get(title);
    if (!threadId) {
      results.push({ matchId: match.id, title, status: 'no_thread', detail: 'No Discord thread found yet' });
      continue;
    }

    const found = await findFirstSharedEventId(threadId, guildId, token);
    if ('error' in found) {
      await recordOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION, found.error);
      results.push({ matchId: match.id, title, status: 'failed', detail: found.error });
      continue;
    }
    if (!found.eventId) {
      results.push({ matchId: match.id, title, status: 'no_event', detail: 'No scheduled event shared in the thread yet' });
      continue;
    }

    const event = eventsById.get(found.eventId);
    if (!event) {
      results.push({ matchId: match.id, title, status: 'no_event', detail: `Shared event ${found.eventId} is no longer scheduled` });
      continue;
    }

    const currentMs = match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
    const eventMs = new Date(event.scheduled_start_time).getTime();
    if (currentMs === eventMs) {
      results.push({ matchId: match.id, title, status: 'unchanged', detail: `Already synced to ${event.scheduled_start_time}` });
      continue;
    }

    const { error } = await supabaseAdmin
      .from('matches')
      .update({ scheduled_at: event.scheduled_start_time })
      .eq('id', match.id);
    if (error) {
      const detail = `Writing scheduled_at failed: ${error.message}`;
      await recordOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION, detail);
      results.push({ matchId: match.id, title, status: 'failed', detail });
      continue;
    }
    await clearOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION);
    results.push({ matchId: match.id, title, status: 'synced', detail: `Synced to ${event.scheduled_start_time}` });
  }

  return { seasonName: season.name, matches: results };
}
