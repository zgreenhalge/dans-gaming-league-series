// Best-effort Discord scheduled-event time sync-back for weekly matches (#398). Rather than trusting
// a player to name their Discord Scheduled Event to match the site's own "Week N Game M" convention
// (easy to typo, retype wrong, or just not bother with), this watches each match's own thread for
// Discord's own "Share to Channel" action on an event — which posts an ordinary message containing
// an invite link carrying the event's id as an `?event=` query param (`discord.gg/{code}?event={id}`),
// or the direct `discord.com/events/{guild}/{event}` form for a manually pasted link. Either way
// that id *is* the correlation: an exact event id, sourced from the platform itself, not a freeform
// string two humans have to agree on.
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
// first time (no checkpoint yet) pays the full backward-walk cost, once — unless its cached event later
// goes stale (see below), which pays it again since a cheap resume can't be trusted to still be correct.
//
// "Earliest" means earliest *live* share by post time, not most recent: the first-time scan walks a
// thread's message history backward to its actual start (Discord returns newest-first) rather than
// stopping at the first page, and only ever considers a message whose linked event is in this poll's
// freshly-fetched, still-live events list — so a stale link left behind by an early false start can't
// beat out whatever the players actually settled on later in the same thread. Once that first pass is
// done, only genuinely new messages (after the checkpoint) are ever looked at again — anything already
// scanned, matched or not, is never revisited *unless* the cached event itself later turns out
// canceled/deleted. That needs both halves of the fix, not just one: a cheap `after=<checkpoint>`
// resume alone can only ever find something *newer* than what's already been ruled out, but the real
// earliest-still-live share could be an *older* message this match's first scan already saw and
// correctly rejected in favor of the (now-invalid) one that won at the time — so a stale-event clear
// resets the checkpoint too, forcing one more full walk. And that walk only helps because it's
// live-aware: without also skipping already-known-invalid ids, a plain text rescan would just
// rediscover the exact same "earliest mention" and reject it all over again, since canceling an event
// doesn't change which message mentions it first. Together they make a stale clear self-correcting
// without needing to remember every runner-up a scan ever discarded — a rare event, worth paying for.
//
// Only unplayed matches (`isPlayedScore()`) are scanned, so a completed match's slot is never touched.
// A match with no thread yet, or a thread with nothing shared in it yet, is not a failure — most
// matches won't have either until players get around to it — so it's reported `no_thread`/`no_event`
// but never recorded to `ops_errors`; only a genuine Discord API failure or a write failure updating
// `match_discord_state`/`matches.scheduled_at` is, and each is cleared the moment its own step next
// succeeds (a scan failure by the next clean scan, a write failure by the next successful write) rather
// than waiting on some later, unrelated step. Each unplayed match's thread lives on its own Discord
// channel, so unlike `publishWeekThreads()`'s deliberately sequential thread *creation* (rate-limited
// on one shared per-channel route), scanning them is independent per match and runs concurrently, just
// bounded (`SCAN_CONCURRENCY`) rather than fully unbounded — see its own comment for why.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule } from './queries';
import { isPlayedScore } from './util';
import { discordErrorDetail, resolveSeasonForumChannel, listChannelThreads, threadTitle } from './discord-threads';
import { recordOpsError, clearOpsError } from './ops-errors';

const EVENT_SYNC_OPERATION = 'discord_event_sync';
// Caps how many matches scan their thread concurrently. Each match's thread is on its own per-channel
// rate-limit bucket, so this isn't `publishWeekThreads()`'s reason for going fully sequential (one
// shared thread-creation route) — but a season with many matches all needing a first-time scan at
// once (e.g. right after this feature first goes live against an already-in-progress season) could
// still burst past Discord's global per-bot rate limit if every match's up-to-`MAX_MESSAGE_PAGES`
// walk fired in the same instant. A small concurrency cap bounds that worst case while leaving the
// steady-state case (a handful of matches, almost all cache hits) effectively as parallel as before.
const SCAN_CONCURRENCY = 5;
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

/** Runs `fn` over `items` with at most `limit` in flight at once, preserving input order in the
 *  returned array regardless of which one finishes first — see `SCAN_CONCURRENCY`'s comment for why
 *  the per-match scan loop needs a cap instead of a single unbounded `Promise.all`. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** One Discord GET, normalized to either its parsed JSON or a labeled `{ error }` — the shared shell
 *  every read in this file uses, so a thrown fetch and a non-ok response are only ever handled once. */
async function fetchDiscordJson<T>(url: string, token: string, label: string): Promise<T | { error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
  } catch (e) {
    return { error: `${label} failed: ${(e as Error).message}` };
  }
  if (!res.ok) return { error: await discordErrorDetail(label, res) };
  return (await res.json()) as T;
}

function listGuildScheduledEvents(guildId: string, token: string): Promise<DiscordScheduledEvent[] | { error: string }> {
  return fetchDiscordJson<DiscordScheduledEvent[]>(
    `https://discord.com/api/v10/guilds/${guildId}/scheduled-events`,
    token,
    'Listing scheduled events',
  );
}

/** One page of a thread's messages, in Discord's native newest-first order. `cursor` selects which
 *  page — `before` walks backward toward the thread's start, `after` walks forward from a checkpoint
 *  toward "now"; omit for the most recent page. */
function fetchMessagesPage(
  threadId: string,
  token: string,
  cursor?: { before: string } | { after: string },
): Promise<DiscordMessage[] | { error: string }> {
  const cursorParam = cursor ? (('before' in cursor) ? `&before=${cursor.before}` : `&after=${cursor.after}`) : '';
  return fetchDiscordJson<DiscordMessage[]>(
    `https://discord.com/api/v10/channels/${threadId}/messages?limit=${MESSAGE_PAGE_SIZE}${cursorParam}`,
    token,
    'Listing thread messages',
  );
}

/** Pulls the event id out of a message's shared-event link, checking both the raw content (what a
 *  manual paste, or Discord's own share action, posts as text) and any embed url (in case the message
 *  itself is otherwise empty and Discord's auto-unfurl is all that carries it). Discord's "Share to
 *  Channel" action posts an invite link with an `?event=` query param (`discord.gg/{code}?event={id}`)
 *  rather than the direct `discord.com/events/{guild}/{event}` form, so both are matched; the invite
 *  form carries no guild id of its own; `liveEventIds` (checked by every caller) is what keeps a stray
 *  link to an unrelated server's event from ever being picked up. */
function extractEventId(message: DiscordMessage): string | null {
  const haystack = [message.content, ...(message.embeds ?? []).map((e) => e.url ?? '')].join(' ');
  const direct = haystack.match(/discord\.com\/events\/[^/\s]+\/(\d+)/)?.[1];
  const invite = haystack.match(/discord\.(?:gg|com\/invite)\/\S+?\?event=(\d+)/)?.[1];
  return direct ?? invite ?? null;
}

interface ThreadScan {
  /** The earliest scheduled-event share found by this scan — `null` if none. */
  eventId: string | null;
  /** The newest message id actually observed, to checkpoint against next time — `null` only if the
   *  scanned range (the whole thread, or everything after the previous checkpoint) had no messages
   *  at all. Always safe to persist as the new `message_checkpoint`, matched or not. */
  newestMessageId: string | null;
}

/** A thread's full history, walked backward from its most recent message to its start — the one-time
 *  cost paid the first time a match's thread is seen (or re-paid after a stale-event reset, see this
 *  file's header). Keeps overwriting its running answer with each *older* match it finds, so a stale
 *  early link can't beat out whatever players actually settled on later, and the true earliest
 *  survives the walk. Only ever considers a message whose linked id is in `liveEventIds` (this poll's
 *  freshly-fetched, still-live events) — otherwise a rescan forced by a canceled cached event would
 *  just rediscover that same canceled event's mention as "earliest" and go nowhere. */
async function scanThreadHistory(
  threadId: string,
  token: string,
  liveEventIds: ReadonlySet<string>,
): Promise<ThreadScan | { error: string }> {
  let before: string | undefined;
  let earliest: string | null = null;
  let newest: string | null = null;

  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const messages = await fetchMessagesPage(threadId, token, before ? { before } : undefined);
    if ('error' in messages) return messages;
    if (messages.length === 0) break;
    if (newest === null) newest = messages[0].id; // first page's first entry is the thread's current head
    // Newest-first within the page; iterating forward means the last match found here is this
    // page's own oldest, so it correctly overwrites a newer match found earlier in the same pass.
    for (const message of messages) {
      const eventId = extractEventId(message);
      if (eventId && liveEventIds.has(eventId)) earliest = eventId;
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
 *  between two ~15-minute polls. Same `liveEventIds` filter as `scanThreadHistory()`, for the same
 *  reason. */
async function scanThreadSince(
  threadId: string,
  token: string,
  checkpoint: string,
  liveEventIds: ReadonlySet<string>,
): Promise<ThreadScan | { error: string }> {
  let after = checkpoint;
  let earliest: string | null = null;
  let newest: string | null = null;

  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const messages = await fetchMessagesPage(threadId, token, { after });
    if ('error' in messages) return messages;
    if (messages.length === 0) break;
    newest = messages[0].id; // this page's newest — the closer to "now" this poll reaches, the better
    if (!earliest) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const eventId = extractEventId(messages[i]);
        if (eventId && liveEventIds.has(eventId)) {
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

/** One unplayed match's outcome: finds (or reuses a cached) scheduled-event id and syncs
 *  `matches.scheduled_at` to it. Independent of every other match — safe to run concurrently with
 *  them (see this file's header) since it only ever touches this match's own thread and rows. */
async function syncMatchScheduledEvent(
  supabaseAdmin: SupabaseClient,
  token: string,
  title: string,
  match: { id: number; scheduled_at: string | null },
  threadId: string | undefined,
  state: MatchDiscordState | undefined,
  eventsById: Map<string, DiscordScheduledEvent>,
): Promise<EventSyncResult> {
  if (!threadId) {
    return { matchId: match.id, title, status: 'no_thread', detail: 'No Discord thread found yet' };
  }

  let eventId = state?.event_id ?? null;

  if (!eventId) {
    const liveEventIds = new Set(eventsById.keys());
    const scan = state?.message_checkpoint
      ? await scanThreadSince(threadId, token, state.message_checkpoint, liveEventIds)
      : await scanThreadHistory(threadId, token, liveEventIds);
    if ('error' in scan) {
      await recordOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION, scan.error);
      return { matchId: match.id, title, status: 'failed', detail: scan.error };
    }
    await clearOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION);

    // Persisted regardless of whether this scan found anything, so the next poll only ever looks at
    // what's new from here rather than re-covering ground already ruled out.
    const { error: stateError } = await supabaseAdmin.from('match_discord_state').upsert(
      {
        match_id: match.id,
        thread_id: threadId,
        event_id: scan.eventId,
        message_checkpoint: scan.newestMessageId ?? state?.message_checkpoint ?? null,
      },
      { onConflict: 'match_id' },
    );
    if (stateError) {
      const detail = `Writing match_discord_state failed: ${stateError.message}`;
      await recordOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION, detail);
      return { matchId: match.id, title, status: 'failed', detail };
    }
    eventId = scan.eventId;
  }

  if (!eventId) {
    return { matchId: match.id, title, status: 'no_event', detail: 'No scheduled event shared in the thread yet' };
  }

  const event = eventsById.get(eventId);
  if (!event) {
    // The cached event vanished or is no longer live. Also resets the checkpoint, forcing a full
    // rescan next time rather than a cheap resume — see this file's header for why a resume alone
    // can't be trusted to find whatever's actually earliest now.
    const { error: clearError } = await supabaseAdmin
      .from('match_discord_state')
      .update({ event_id: null, message_checkpoint: null })
      .eq('match_id', match.id);
    if (clearError) {
      const detail = `Clearing the stale cached event failed: ${clearError.message}`;
      await recordOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION, detail);
      return { matchId: match.id, title, status: 'failed', detail };
    }
    return { matchId: match.id, title, status: 'no_event', detail: `Shared event ${eventId} is no longer scheduled` };
  }

  const currentMs = match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  const eventMs = new Date(event.scheduled_start_time).getTime();
  if (currentMs === eventMs) {
    return { matchId: match.id, title, status: 'unchanged', detail: `Already synced to ${event.scheduled_start_time}` };
  }

  const { error } = await supabaseAdmin.from('matches').update({ scheduled_at: event.scheduled_start_time }).eq('id', match.id);
  if (error) {
    const detail = `Writing scheduled_at failed: ${error.message}`;
    await recordOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION, detail);
    return { matchId: match.id, title, status: 'failed', detail };
  }
  await clearOpsError(supabaseAdmin, 'match', match.id, EVENT_SYNC_OPERATION);
  return { matchId: match.id, title, status: 'synced', detail: `Synced to ${event.scheduled_start_time}` };
}

/** Syncs one regular season's unplayed matches against events shared in their Discord threads.
 *  Returns `{ error }` for a season-level failure (bad season, unconfigured Discord, resolving the
 *  forum channel, or listing its threads/the guild's events) before any match is considered;
 *  otherwise every unplayed match's own outcome, matched or not. */
export async function syncSeasonScheduledEvents(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
): Promise<SyncSeasonEventsResult | { error: string }> {
  const season = await getSeason(seasonId, supabaseAdmin);
  if (!season) return { error: 'Season not found' };
  if (season.is_gauntlet) return { error: 'Gauntlet seasons do not use weekly match threads' };

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { error: 'Discord is not configured (DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)' };

  const schedule = await getSeasonSchedule(seasonId, supabaseAdmin);
  const unplayedByTitle = new Map<string, { id: number; scheduled_at: string | null }>();
  for (const week of schedule) {
    for (const match of week.matches) {
      if (isPlayedScore(match.final_score)) continue;
      unplayedByTitle.set(threadTitle(week.week_number, match.match_number), match);
    }
  }
  if (unplayedByTitle.size === 0) return { seasonName: season.name, matches: [] };

  const matchIds = [...unplayedByTitle.values()].map((m) => m.id);
  // The channel→threads lookup is a real dependency chain; listing the guild's events and this
  // season's already-known match_discord_state rows are independent of it and of each other, so all
  // three run concurrently rather than as one long sequential chain.
  const [channelThreadsResult, eventsResult, stateRowsResult] = await Promise.all([
    resolveSeasonForumChannel(guildId, token, season.name).then((channel) =>
      'error' in channel ? channel : listChannelThreads(guildId, channel.channelId, token),
    ),
    listGuildScheduledEvents(guildId, token),
    supabaseAdmin.from('match_discord_state').select('match_id, event_id, message_checkpoint').in('match_id', matchIds),
  ]);

  if ('error' in channelThreadsResult) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION, channelThreadsResult.error);
    return { error: channelThreadsResult.error };
  }
  if ('error' in eventsResult) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION, eventsResult.error);
    return { error: eventsResult.error };
  }
  await clearOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION);

  const threadIdByTitle = new Map(channelThreadsResult.map((t) => [t.name, t.id]));
  const eventsById = new Map(eventsResult.filter((e) => LIVE_EVENT_STATUSES.has(e.status)).map((e) => [e.id, e]));
  const stateByMatchId = new Map(
    ((stateRowsResult.data ?? []) as MatchDiscordState[]).map((r) => [r.match_id, r]),
  );

  const results = await mapWithConcurrency(
    [...unplayedByTitle.entries()],
    SCAN_CONCURRENCY,
    ([title, match]) =>
      syncMatchScheduledEvent(
        supabaseAdmin, token, title, match,
        threadIdByTitle.get(title), stateByMatchId.get(match.id), eventsById,
      ),
  );

  return { seasonName: season.name, matches: results };
}
