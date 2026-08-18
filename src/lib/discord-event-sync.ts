// Best-effort Discord scheduled-event time sync-back for weekly matches (#398). Players create a
// Discord Scheduled Event themselves once their match thread exists, naming it to match the thread
// (`threadTitle()`'s "Week N Game M" — the same string `discord-threads.ts` uses for the thread
// itself). Guild scheduled events carry no structural link back to a forum thread — Discord's API
// only gives voice/stage events a `channel_id`, and a thread isn't either — so title equality is the
// only correlation available, and it doesn't depend on `match_discord_state`/thread ids at all: a
// hand-created thread the weekly publish step never adopted (or hasn't run yet for that week) still
// syncs correctly as long as the event's name matches the convention.
//
// No gateway bot required — `GET /guilds/{guild_id}/scheduled-events` is a plain REST poll, meant to
// run on a periodic cron (see `discord-event-sync.yml`) against whichever season is currently
// `ACTIVE`. Only unplayed matches (`isPlayedScore()`) are considered, so a completed match's slot
// never gets clobbered by a stale or reused event name. A match with no matching event yet is not a
// failure — most matches won't have one until players get around to it — so it's reported as
// `no_event` in the result but never recorded to `ops_errors`; only a genuine Discord API failure
// (listing events) or a write failure updating `matches.scheduled_at` is.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSeason, getSeasonSchedule } from './queries';
import { isPlayedScore } from './util';
import { discordErrorDetail, threadTitle } from './discord-threads';
import { recordOpsError, clearOpsError } from './ops-errors';

const EVENT_SYNC_OPERATION = 'discord_event_sync';

// Discord guild-scheduled-event `status`: SCHEDULED=1, ACTIVE=2, COMPLETED=3, CANCELED=4. Only the
// first two describe a still-relevant start time — a completed or canceled event's time is stale
// and shouldn't overwrite `scheduled_at`.
const LIVE_EVENT_STATUSES = new Set([1, 2]);

interface DiscordScheduledEvent {
  id: string;
  name: string;
  scheduled_start_time: string;
  status: number;
}

export interface EventSyncResult {
  matchId: number;
  title: string;
  status: 'synced' | 'unchanged' | 'no_event' | 'failed';
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

/** Syncs one regular season's unplayed matches against the guild's current scheduled events, by
 *  title. Returns `{ error }` for a season-level failure (bad season, unconfigured Discord, the
 *  events listing call itself failing) before any match is considered; otherwise every unplayed
 *  match's own outcome, matched or not. */
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

  const events = await listGuildScheduledEvents(guildId, token);
  if ('error' in events) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION, events.error);
    return { error: events.error };
  }
  await clearOpsError(supabaseAdmin, 'season', seasonId, EVENT_SYNC_OPERATION);

  const eventsByTitle = new Map(
    events.filter((e) => LIVE_EVENT_STATUSES.has(e.status)).map((e) => [e.name, e]),
  );

  const results: EventSyncResult[] = [];
  for (const [title, match] of unplayedByTitle) {
    const event = eventsByTitle.get(title);
    if (!event) {
      results.push({ matchId: match.id, title, status: 'no_event', detail: 'No scheduled event found yet' });
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
