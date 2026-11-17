// Best-effort Discord messages for scrim nights, posted through the match notifications' webhook
// (`discord-webhook.ts`). Every export is safe to call unconditionally: a missing webhook is a no-op,
// and a failure is logged rather than thrown, so no caller can fail over a notification (`ops_errors`
// has no scrim-night entity).
//
// A night has two messages, both stored in `scrim_night_discord_state`:
//   1. The announcement, posted when the night is scheduled: a link Discord previews (with the start time).
//   2. The night message, posted an hour before the start by the one-shot job
//      `scheduleScrimNightReminder()` queues (a night scheduled less than an hour out gets it
//      straight away). It deletes the announcement and is then edited in place by
//      `syncScrimNightMessage()`: the roster (✅ Definite, ❔ Maybe), the latest started match's
//      running or final score until the next match's server starts, and the final standings once the
//      night has been ended. A night that goes idle ends on the clock with no write to react to, so its
//      message keeps its last state until the next sync.
// A new post is what pings people; an edit does not.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REMINDER_WINDOW_MS,
  EMBED_FIELD_VALUE_MAX,
  MESSAGE_CONTENT_MAX,
  deleteWebhookMessage,
  joinWithinLimit,
  matchNotificationsWebhookUrl,
  editWebhookEmbed,
  playerTag,
  postWebhookEmbed,
  type Embed,
  type EmbedField,
} from './discord-webhook';
import {
  getScrimLiveScore,
  getScrimNightForDiscord,
  getScrimNightMatches,
  getScrimNightStandings,
  type ScrimDiscordSignup,
  type ScrimLeaderboardRow,
  type ScrimMatch,
} from './queries/scrims';
import { scrimMatchHasStarted } from './scrim-matches';
import { hasScrimNightEnded, hasScrimNightStarted, type ScrimNight } from './scrim-schedule';
import { scrimMatchUrl, scrimNightUrl } from './seo/site';
import { formatLeagueDateTime, parseScore } from './util';

const COLOR_UPCOMING = 0xfee75c; // Discord's "yellow", as for a match reminder
const COLOR_LIVE = 0xed4245; // Discord's "red" — a match is being played
const COLOR_OVER = 0x5865f2; // Discord's "blurple" — the night has ended
/** A night is due its night message within this long of its start: the hour's lead plus 5 minutes of
 *  slack, since a pg_cron job fires on the minute, a little before a start with seconds on it. */
const REMINDER_DUE_WITHIN_MS = 65 * 60 * 1000;
/** Standings listed in the message; a night has a handful of players. */
const MAX_STANDINGS_ROWS = 10;

interface DiscordState {
  announcement_message_id: string | null;
  reminder_message_id: string | null;
  finalized_at: string | null;
}

/** What the night message shows of the latest match that has started: its score, running or final,
 *  or where its server is while there is no score yet. */
interface LatestMatch {
  match: ScrimMatch;
  /** Without a score: `starting` (the server is booting), `ready` (up, waiting for the first round),
   *  `waiting` (the game is over, awaiting the result). */
  kind: 'final' | 'live' | 'starting' | 'ready' | 'waiting';
  shirts: number;
  skins: number;
  round: number | null;
}

interface NightMessageData {
  night: ScrimNight;
  signups: ScrimDiscordSignup[];
  /** Set once the night has started and not ended. */
  latestMatch: LatestMatch | null;
  /** Set once the night has ended and has a scored match. */
  standings: ScrimLeaderboardRow[] | null;
}

/** Runs one notification, logging instead of throwing — the no-throw guarantee every export keeps. */
async function bestEffort(label: string, id: number, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`${label}(${id}) failed (non-fatal):`, e);
  }
}

/** Discord's `<t:…>` timestamp markup takes epoch seconds. */
const discordEpoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Whether the night is due its night message: it starts within the lead, or already has. */
function isReminderDue(night: ScrimNight, now: Date): boolean {
  return Date.parse(night.startsAt) - now.getTime() <= REMINDER_DUE_WITHIN_MS;
}

/** The latest match that has started (`scrimMatchHasStarted()`) in play order, so the next match takes
 *  over as soon as it holds the server. `null` before any has. */
async function getLatestMatch(db: SupabaseClient, matches: ScrimMatch[]): Promise<LatestMatch | null> {
  const match = [...matches].reverse().find(scrimMatchHasStarted);
  if (!match) return null;
  const final = parseScore(match.final_score);
  if (final) return { match, kind: 'final', ...final, round: null };

  const live = await getScrimLiveScore(db, match.id);
  if (live) return { match, kind: 'live', ...live };
  const kind = match.server_state === 'provisioning' ? 'starting' : match.server_state === 'live' ? 'ready' : 'waiting';
  return { match, kind, shirts: 0, skins: 0, round: null };
}

/** Everything the night message shows, read fresh through `db`. `null` when the night doesn't exist. */
async function loadMessageData(db: SupabaseClient, nightId: number, now: Date): Promise<NightMessageData | null> {
  const base = await getScrimNightForDiscord(db, nightId);
  if (!base) return null;
  const { night, signups } = base;
  if (!hasScrimNightStarted(night, now)) return { night, signups, latestMatch: null, standings: null };

  const matches = await getScrimNightMatches(nightId, db);
  if (!hasScrimNightEnded(night, now)) return { night, signups, latestMatch: await getLatestMatch(db, matches), standings: null };
  const standings = await getScrimNightStandings(db, matches);
  return { night, signups, latestMatch: null, standings: standings.length > 0 ? standings : null };
}

/** Definite ✅ or Maybe ❔ beside each player. */
const commitmentEmoji = (s: ScrimDiscordSignup) => (s.commitment === 'definite' ? '✅' : '❔');

/** Standings as a fixed-width `# Player W-L ADR` table in a code block (embed field values render in
 *  a proportional font otherwise). */
function standingsTable(rows: ScrimLeaderboardRow[]): string {
  const shown = rows.slice(0, MAX_STANDINGS_ROWS).map((r, i) => ({ rank: String(i + 1), name: r.player_name.replaceAll('`', "'"), record: `${r.wins}-${r.losses}`, adr: r.adr.toFixed(1) }));
  const nameWidth = Math.max('Player'.length, ...shown.map((r) => r.name.length));
  const recordWidth = Math.max('W-L'.length, ...shown.map((r) => r.record.length));
  const adrWidth = Math.max('ADR'.length, ...shown.map((r) => r.adr.length));
  const line = (rank: string, name: string, record: string, adr: string) =>
    `${rank.padStart(2)}  ${name.padEnd(nameWidth)}  ${record.padStart(recordWidth)}  ${adr.padStart(adrWidth)}`;
  return ['```', line('#', 'Player', 'W-L', 'ADR'), ...shown.map((r) => line(r.rank, r.name, r.record, r.adr)), '```'].join('\n');
}

/** The night message: the roster tagged in `content` (the one place mentions render, as in
 *  `discord-notify.ts`) and listed with each player's emoji in the embed, then the latest match's score
 *  or, once the night is over, the standings. Times use Discord's own timestamp markup, so they show in
 *  each reader's timezone and the relative form needs no editing. The night is linked from the title
 *  and a line in the description; neither unfurls into a preview card. */
function buildNightMessage(data: NightMessageData, now: Date): { content: string; embed: Embed } {
  const { night, signups, latestMatch, standings } = data;
  const epoch = discordEpoch(night.startsAt);
  const ended = hasScrimNightEnded(night, now);
  const status = ended
    ? '🏁 **Scrim night over**'
    : hasScrimNightStarted(night, now)
      ? '🟢 **Scrim night underway**'
      : `⏰ **Scrim night starts <t:${epoch}:R>**`;

  const fields: EmbedField[] = [
    { name: `Roster (${signups.length})`, value: signups.length > 0 ? joinWithinLimit(signups.map((s) => `${commitmentEmoji(s)} ${s.name}`), EMBED_FIELD_VALUE_MAX) : '—' },
  ];
  if (standings) fields.push({ name: 'Final standings', value: standingsTable(standings) });
  if (latestMatch) {
    const { match, kind, shirts, skins, round } = latestMatch;
    const result = {
      final: `🏁 **Final** ${shirts}-${skins}`,
      live: `🔴 **LIVE** ${shirts}-${skins}${round != null ? ` · Round ${round}` : ''}`,
      starting: '🟡 **Server starting**',
      ready: '🟢 **Server live** — waiting for the first round',
      waiting: '⏳ **Awaiting the result**',
    }[kind];
    fields.push({ name: `Match ${match.match_number}${match.map ? ` · ${match.map}` : ''}`, value: `${result}\n[Match page](${scrimMatchUrl(match.id)})` });
  }

  const tagLines = (['definite', 'maybe'] as const).flatMap((commitment) => {
    const tags = signups.filter((x) => x.commitment === commitment).map(playerTag);
    // Each list gets under half the content limit, so the two lines fit together.
    return tags.length > 0 ? [`${commitment === 'definite' ? 'Definite' : 'Maybe'}: ${joinWithinLimit(tags, MESSAGE_CONTENT_MAX / 2 - 100, ' ')}`] : [];
  });

  return {
    content: tagLines.join('\n'),
    embed: {
      title: `Scrim night · ${formatLeagueDateTime(night.startsAt)}`,
      description: `${status}\n<t:${epoch}:F>\n[Open the night](${scrimNightUrl(night.id)})`,
      color: ended ? COLOR_OVER : latestMatch?.kind === 'live' ? COLOR_LIVE : COLOR_UPCOMING,
      url: scrimNightUrl(night.id),
      author: { name: 'Scrims' },
      fields,
    },
  };
}

async function getState(db: SupabaseClient, nightId: number): Promise<DiscordState | null> {
  const { data, error } = await db
    .from('scrim_night_discord_state')
    .select('announcement_message_id, reminder_message_id, finalized_at')
    .eq('night_id', nightId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Posts the announcement: a line and a link to the night, as plain content so Discord unfurls the
 *  site's preview of it, which carries the start time. */
async function postAnnouncement(db: SupabaseClient, url: string, night: ScrimNight): Promise<void> {
  const content = `📅 **Scrim night scheduled**\n${scrimNightUrl(night.id)}`;
  const result = await postWebhookEmbed(url, content, null);
  if (!result.ok) throw new Error(result.error);
  if (result.id) {
    await db
      .from('scrim_night_discord_state')
      .upsert({ night_id: night.id, announcement_message_id: result.id }, { onConflict: 'night_id' })
      .throwOnError();
  }
}

/** Posts the night message, then deletes the announcement it replaces. Claims
 *  `scrim_night_discord_state.reminder_sent_at` atomically first, so two racing calls never both post.
 *  A post that fails, or comes back with no message id to edit, gives the claim back so the next
 *  `syncScrimNightMessage()` posts again; an unreleased claim would leave the night with no message for
 *  good. The announcement goes only once the new message's id is stored, so a failed post never leaves
 *  the channel with neither. */
async function postNightMessage(db: SupabaseClient, url: string, data: NightMessageData, now: Date): Promise<void> {
  const nightId = data.night.id;
  const table = () => db.from('scrim_night_discord_state');
  // The announcement may never have posted, so there may be no row to claim yet; seed one without
  // overwriting an existing row.
  await table().upsert({ night_id: nightId, reminder_sent_at: null }, { onConflict: 'night_id', ignoreDuplicates: true }).throwOnError();
  const { data: claimed } = await table()
    .update({ reminder_sent_at: now.toISOString() })
    .eq('night_id', nightId)
    .is('reminder_sent_at', null)
    .select('night_id, announcement_message_id')
    .throwOnError();
  if (!claimed || claimed.length === 0) return; // Already sent, or lost the race to a concurrent call.

  const message = buildNightMessage(data, now);
  const result = await postWebhookEmbed(url, message.content, message.embed);
  if (!result.ok || !result.id) {
    await table().update({ reminder_sent_at: null }).eq('night_id', nightId).throwOnError();
    throw new Error(result.ok ? 'Discord returned no id for the posted message' : result.error);
  }
  await table().update({ reminder_message_id: result.id }).eq('night_id', nightId).throwOnError();

  const announcementId = claimed[0].announcement_message_id;
  if (announcementId) {
    const deleted = await deleteWebhookMessage(url, announcementId);
    if (!deleted.ok) throw new Error(deleted.error);
    await table().update({ announcement_message_id: null }).eq('night_id', nightId).throwOnError();
  }
}

/** Announces a night that has just been scheduled. A night starting within the hour skips the
 *  announcement and gets the night message right away. */
export async function notifyScrimNightScheduled(db: SupabaseClient, nightId: number): Promise<void> {
  const url = matchNotificationsWebhookUrl();
  if (!url) return;
  return bestEffort('notifyScrimNightScheduled', nightId, async () => {
    const now = new Date();
    const data = await loadMessageData(db, nightId, now);
    if (!data || hasScrimNightEnded(data.night, now)) return;
    if (isReminderDue(data.night, now)) await postNightMessage(db, url, data, now);
    else await postAnnouncement(db, url, data.night);
  });
}

/** Posts the night message an hour before the night starts, replacing the announcement. Called by
 *  `POST /api/cron/scrim-reminder`, fired once by the pg_cron job `scheduleScrimNightReminder()`
 *  queues. Skips a night that is gone, has ended or started, or whose start is not within
 *  `REMINDER_WINDOW_MS`; a night whose job never fired gets its message from the next
 *  `syncScrimNightMessage()`. */
export async function notifyScrimNightReminder(db: SupabaseClient, nightId: number): Promise<void> {
  const url = matchNotificationsWebhookUrl();
  if (!url) return;
  return bestEffort('notifyScrimNightReminder', nightId, async () => {
    const now = new Date();
    const data = await loadMessageData(db, nightId, now);
    if (!data) return;
    const msUntilStart = Date.parse(data.night.startsAt) - now.getTime();
    if (hasScrimNightEnded(data.night, now) || msUntilStart <= 0 || msUntilStart > REMINDER_WINDOW_MS) return;
    await postNightMessage(db, url, data, now);
  });
}

/** Rebuilds the night message and edits it in place. Before the night message exists it posts it once
 *  the night is due one; an announcement is left as it is. An ended night is edited to its final
 *  standings once (`finalized_at`), and a reopened one back to its match. A message that can't be
 *  edited (deleted from the channel) is left alone, since a re-post would ping everyone again. Call
 *  after anything that changes it. */
export async function syncScrimNightMessage(db: SupabaseClient, nightId: number): Promise<void> {
  const url = matchNotificationsWebhookUrl();
  if (!url) return;
  return bestEffort('syncScrimNightMessage', nightId, async () => {
    const now = new Date();
    const [data, state] = await Promise.all([loadMessageData(db, nightId, now), getState(db, nightId)]);
    if (!data) return;
    const ended = hasScrimNightEnded(data.night, now);

    const messageId = state?.reminder_message_id ?? null;
    if (!messageId) {
      if (!ended && isReminderDue(data.night, now)) await postNightMessage(db, url, data, now);
      return;
    }
    if (ended && state?.finalized_at) return;

    const message = buildNightMessage(data, now);
    const result = await editWebhookEmbed(url, messageId, message.content, message.embed);
    if (!result.ok) throw new Error(result.error);
    if (ended || state?.finalized_at) {
      await db
        .from('scrim_night_discord_state')
        .update({ finalized_at: ended ? now.toISOString() : null })
        .eq('night_id', nightId)
        .throwOnError();
    }
  });
}

/** Syncs the night a scrim match belongs to after its live or final score changes. A league match, or
 *  one that no longer exists, is a no-op. */
export async function notifyScrimMatchProgress(db: SupabaseClient, matchId: number): Promise<void> {
  if (!matchNotificationsWebhookUrl()) return;
  return bestEffort('notifyScrimMatchProgress', matchId, async () => {
    const { data, error } = await db.from('matches').select('scrim_night_id').eq('id', matchId).maybeSingle();
    if (error) throw error;
    const nightId = (data as { scrim_night_id: number | null } | null)?.scrim_night_id;
    if (nightId != null) await syncScrimNightMessage(db, nightId);
  });
}

/** Queues the night's one-shot reminder (`schedule_scrim_night_reminder()`, a pg_cron job). A night's
 *  start never changes, so this runs once, when the night is scheduled. */
export async function scheduleScrimNightReminder(db: SupabaseClient, nightId: number, startsAt: string): Promise<void> {
  if (!matchNotificationsWebhookUrl()) return;
  return bestEffort('scheduleScrimNightReminder', nightId, async () => {
    const { data, error } = await db.rpc('schedule_scrim_night_reminder', { p_night_id: nightId, p_starts_at: startsAt });
    if (error) throw error;
    if (!data) throw new Error('the "cron_secret" Vault secret is not configured');
  });
}

/** The ids of the Discord messages posted for a night. Read before a drop-out that may remove the night:
 *  the state row goes with it. */
export async function getScrimNightMessageIds(db: SupabaseClient, nightId: number): Promise<string[]> {
  if (!matchNotificationsWebhookUrl()) return [];
  try {
    const state = await getState(db, nightId);
    return [state?.announcement_message_id, state?.reminder_message_id].filter((id): id is string => !!id);
  } catch (e) {
    console.error(`getScrimNightMessageIds(${nightId}) failed (non-fatal):`, e);
    return [];
  }
}

/** Deletes a removed night's Discord messages (ids from `getScrimNightMessageIds()`). */
export async function deleteScrimNightMessages(nightId: number, messageIds: string[]): Promise<void> {
  const url = matchNotificationsWebhookUrl();
  if (!url) return;
  return bestEffort('deleteScrimNightMessages', nightId, async () => {
    const results = await Promise.all(messageIds.map((id) => deleteWebhookMessage(url, id)));
    const failed = results.flatMap((r) => (r.ok ? [] : [r.error]));
    if (failed.length > 0) throw new Error(failed.join('; '));
  });
}
