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
// still gets adopted by a `publishWeekThreads()` re-run.
//
// No gateway bot required — this is a plain REST poll (`discord-event-sync.yml`) against whichever
// season is currently `ACTIVE`. A real Discord bot's gateway would push a `MESSAGE_CREATE` event the
// instant a share link lands, but that needs a persistent websocket connection somewhere, and nothing
// in this project's hosting (Vercel serverless + GitHub Actions' ephemeral runners) can hold one — so
// this polls instead, but avoids paying history-scan cost on every tick: `match_discord_state.event_id`
// caches a match's discovered event permanently once found (a match only needs its event *found*
// once — after that it's just a cheap id lookup against the already-fetched events list), and
// `message_checkpoint` lets a match still waiting on one resume scanning from where the last poll left
// off (`after=<checkpoint>`) instead of re-walking the whole thread. Only a match seen for the very
// first time (no checkpoint yet) pays the full backward-walk cost, once.
//
// "Earliest" means earliest by post time, not most recent: the first-time scan walks a thread's
// message history backward to its actual start (Discord returns newest-first) rather than stopping at
// the first page, so a stale link left behind by an early false start can't beat out whatever the
// players actually settled on later in the same thread. Once that first pass is done, only genuinely
// new messages (after the checkpoint) are ever looked at again — anything already scanned, matched or
// not, is never revisited. Only unplayed matches (`isPlayedScore()`) are scanned, so a completed
// match's slot is never touched. A match with no thread yet, or a thread with nothing shared in it
// yet, is not a failure — most matches won't have either until players get around to it — so it's
// reported `no_thread`/`no_event` but never recorded to `ops_errors`; only a genuine Discord API
// failure or a write failure updating `match_discord_state`/`matches.scheduled_at` is.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule } from './queries';
import { isPlayedScore } from './util';
import { discordErrorDetail, resolveSeasonForumChannel, listChannelThreads, threadTitle } from './discord-threads';
import { recordOpsError, clearOpsError } from './ops-errors';

const EVENT_SYNC_OPERATION = 'discord_event_sync';
const MESSAGE_PAGE_SIZE = 100;
// Bounds the worst case for an unexpectedly long-lived thread's first-time scan — 10 pages
// comfortably covers any realistic weekly match thread, which these are meant to be short-lived by
// design. The incremental (checkpointed) scan only ever needs one page in practice, since it's just
// "what's new since the last ~15-minute poll" — but shares the same cap for a uniform safety bound.
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

interface MatchDiscordState {
  match_id: number;
  thread_id: string | null;
  event_id: string | null;
  message_checkpoint: string | null;
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

interface ThreadScan {
  /** The earliest scheduled-event share found by this scan — `null` if none. */
  eventId: string | null;
  /** The newest message id actually observed, to checkpoint against next time — `null` only if the
   *  scanned range (the whole thread, or everything after the previous checkpoint) had no messages
   *  at all. Always safe to persist as the new `message_checkpoint`, matched or not. */
  newestMessageId: string | null;
}

/** A thread's full history, walked backward from its most recent message to its start (Discord
 *  returns newest-first) — the one-time cost paid the first time a match's thread is seen, before it
 *  has a `message_checkpoint` yet. Keeps overwriting its running answer with each *older* match it
 *  finds, so a stale early link can't beat out whatever players actually settled on later, and the
 *  true earliest survives the walk. */
async function scanThreadHistory(
  threadId: string,
  guildId: string,
  token: string,
): Promise<ThreadScan | { error: string }> {
  let before: string | undefined;
  let earliest: string | null = null;
  let newest: string | null = null;

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
    if (newest === null) newest = messages[0].id; // first page's first entry is the thread's current head
    // Newest-first within the page; iterating forward means the last match found here is this
    // page's own oldest, so it correctly overwrites a newer match found earlier in the same pass.
    for (const message of messages) {
      const eventId = extractEventId(message, guildId);
      if (eventId) earliest = eventId;
    }
    if (messages.length < MESSAGE_PAGE_SIZE) break; // fewer than a full page — reached the thread's start
    before = messages[messages.length - 1].id;
  }

  return { eventId: earliest, newestMessageId: newest };
}

/** Only the messages posted after `checkpoint` — a match whose first-time scan already ran doesn't
 *  need its whole thread re-read on every subsequent poll, just whatever's new since the last one.
 *  Any match found here is automatically the earliest *new* one (nothing before the checkpoint could
 *  be newer), so the first page containing one settles it; pagination continues regardless, bounded
 *  by the same cap as the full scan, purely to advance the checkpoint as close to "now" as this poll
 *  can manage — an edge case in practice, since these threads see nowhere near 100 new messages
 *  between two ~15-minute polls. */
async function scanThreadSince(
  threadId: string,
  guildId: string,
  token: string,
  checkpoint: string,
): Promise<ThreadScan | { error: string }> {
  let after = checkpoint;
  let earliest: string | null = null;
  let newest: string | null = null;

  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const url = `https://discord.com/api/v10/channels/${threadId}/messages?limit=${MESSAGE_PAGE_SIZE}&after=${after}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
    } catch (e) {
      return { error: `Listing thread messages failed: ${(e as Error).message}` };
    }
    if (!res.ok) return { error: await discordErrorDetail('Listing thread messages', res) };

    const messages = (await res.json()) as DiscordMessage[];
    if (messages.length === 0) break;
    newest = messages[0].id; // this page's newest — the closer to "now" this poll reaches, the better
    if (!earliest) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const eventId = extractEventId(messages[i], guildId);
        if (eventId) {
          earliest = eventId;
          break;
        }
      }
    }
    if (messages.length < MESSAGE_PAGE_SIZE) break; // fewer than a full page — caught up to "now"
    after = messages[0].id;
  }

  return { eventId: earliest, newestMessageId: newest ?? checkpoint };
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

  const matchIds = [...unplayedByTitle.values()].map((m) => m.id);
  const { data: stateRows } = await supabaseAdmin
    .from('match_discord_state')
    .select('match_id, thread_id, event_id, message_checkpoint')
    .in('match_id', matchIds);
  const stateByMatchId = new Map(
    ((stateRows ?? []) as MatchDiscordState[]).map((r) => [r.match_id, r]),
  );

  const results: EventSyncResult[] = [];
  for (const [title, match] of unplayedByTitle) {
    const threadId = threadIdByTitle.get(title);
    if (!threadId) {
      results.push({ matchId: match.id, title, status: 'no_thread', detail: 'No Discord thread found yet' });
      continue;
    }

    const state = stateByMatchId.get(match.id);
    let eventId = state?.event_id ?? null;

    if (!eventId) {
      const scan = state?.message_checkpoint
        ? await scanThreadSince(threadId, guildId, token, state.message_checkpoint)
        : await scanThreadHistory(threadId, guildId, token);
      if ('error' in scan) {
        await recordOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION, scan.error);
        results.push({ matchId: match.id, title, status: 'failed', detail: scan.error });
        continue;
      }

      // Persisted regardless of whether this scan found anything, so the next poll only ever looks
      // at what's new from here rather than re-covering ground already ruled out.
      await supabaseAdmin.from('match_discord_state').upsert(
        {
          match_id: match.id,
          thread_id: threadId,
          event_id: scan.eventId,
          message_checkpoint: scan.newestMessageId ?? state?.message_checkpoint ?? null,
        },
        { onConflict: 'match_id' },
      );
      eventId = scan.eventId;
    }

    if (!eventId) {
      results.push({ matchId: match.id, title, status: 'no_event', detail: 'No scheduled event shared in the thread yet' });
      continue;
    }

    const event = eventsById.get(eventId);
    if (!event) {
      // The cached event vanished or is no longer live — clear it so the next poll re-derives
      // cleanly (from the same checkpoint, so it only looks at whatever's posted since) instead of
      // permanently trusting a stale id.
      await supabaseAdmin.from('match_discord_state').update({ event_id: null }).eq('match_id', match.id);
      results.push({ matchId: match.id, title, status: 'no_event', detail: `Shared event ${eventId} is no longer scheduled` });
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
