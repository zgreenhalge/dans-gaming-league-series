// Best-effort Discord messages for scrim nights, posted through the match notifications' webhook
// (`discord-webhook.ts`). Every export is safe to call unconditionally: a missing webhook is a no-op,
// and a failure is logged rather than thrown, so no caller can fail over a notification (`ops_errors`
// has no scrim-night entity).
//
// A night has two messages in turn, both built by `buildNightMessage()` and stored in
// `scrim_night_discord_state`:
//   1. The announcement, posted when the night is scheduled. It is edited in place as the roster
//      changes, and tags no one.
//   2. The night message, posted an hour before the start by the one-shot job
//      `scheduleScrimNightReminder()` queues (a night scheduled less than an hour out gets it straight
//      away). The announcement is deleted first, so the channel never shows both. The night message
//      adds a "starting" countdown and tags the roster, and is then edited in place by
//      `syncScrimNightMessage()`.
// Both show the roster (✅ checked in, ✔️ Definite, ❔ Maybe) with counts. The night message also shows
// the latest started match's running or final score until the next match's server starts, and the
// final standings once the night has been ended. A night that goes idle ends on the clock with no write
// to react to, so its message keeps its last state until the next sync.
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
import { signupCounts } from './scrim-seats';
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

/** ✅ beside a player who has checked in, else ✔️ for Definite or ❔ for Maybe. */
const statusEmoji = (s: ScrimDiscordSignup) => (s.checkedIn ? '✅' : s.commitment === 'definite' ? '✔️' : '❔');

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

/** The status line: the night's own state, and before it starts either "scheduled" (the announcement
 *  phase) or the countdown (once the night message is due, `isReminderDue()`). */
function statusLine(night: ScrimNight, now: Date): string {
  const epoch = discordEpoch(night.startsAt);
  if (hasScrimNightEnded(night, now)) return '🏁 **Scrim night over**';
  if (hasScrimNightStarted(night, now)) return '🟢 **Scrim night underway**';
  return isReminderDue(night, now) ? `⏰ **Scrim starting <t:${epoch}:R>!**` : '📅 **Scrim night scheduled**';
}

/** Each tag list gets under half the content limit (less room for its label), so both fit together. */
const TAG_LIST_MAX = MESSAGE_CONTENT_MAX / 2 - 100;

/** The roster as `Definite: …` and `Maybe: …` lines of name-color role tags, for a message's `content`
 *  (the one place mentions render, as in `discord-notify.ts`). */
function tagLines(signups: ScrimDiscordSignup[]): string[] {
  return (['definite', 'maybe'] as const).flatMap((commitment) => {
    const tags = signups.filter((s) => s.commitment === commitment).map(playerTag);
    return tags.length > 0 ? [`${commitment === 'definite' ? 'Definite' : 'Maybe'}: ${joinWithinLimit(tags, TAG_LIST_MAX, ' ')}`] : [];
  });
}

/** The message for a night. Every phase lists the roster with each player's emoji and the counts, and
 *  the latest match's score or, once the night is over, the standings. Once the night message is due
 *  (`isReminderDue()`) it also tags the roster; before that, as the announcement, it tags no one. Times
 *  use Discord's own timestamp markup, so they show in each reader's timezone and the relative form
 *  needs no editing. The night is linked from the title and a line in the description. */
function buildNightMessage(data: NightMessageData, now: Date): { content: string; embed: Embed } {
  const { night, signups, latestMatch, standings } = data;
  const ended = hasScrimNightEnded(night, now);
  const { definite, maybe } = signupCounts(signups);
  const checkedIn = signups.filter((s) => s.checkedIn).length;
  const fields: EmbedField[] = [
    {
      name: `Roster (${signups.length}) · ${definite} definite · ${maybe} maybe · ${checkedIn} checked in`,
      value: signups.length > 0 ? joinWithinLimit(signups.map((s) => `${statusEmoji(s)} ${s.name}`), EMBED_FIELD_VALUE_MAX) : '—',
    },
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

  return {
    content: isReminderDue(night, now) ? tagLines(signups).join('\n') : '',
    embed: {
      title: `Scrim night · ${formatLeagueDateTime(night.startsAt)}`,
      description: `${statusLine(night, now)}\n<t:${discordEpoch(night.startsAt)}:F>\n[Open the night](${scrimNightUrl(night.id)})`,
      color: ended ? COLOR_OVER : latestMatch?.kind === 'live' ? COLOR_LIVE : COLOR_UPCOMING,
      url: scrimNightUrl(night.id),
      author: { name: 'Scrims' },
      fields,
    },
  };
}

/** Posts the night's message and returns its id. Throws when Discord refuses it or returns no id to
 *  edit it by. */
async function postMessage(url: string, data: NightMessageData, now: Date): Promise<string> {
  const message = buildNightMessage(data, now);
  const result = await postWebhookEmbed(url, message.content, message.embed);
  if (!result.ok) throw new Error(result.error);
  if (!result.id) throw new Error('Discord returned no id for the posted message');
  return result.id;
}

/** Edits a posted message to the night's current state. Throws when Discord refuses the edit. */
async function editMessage(url: string, messageId: string, data: NightMessageData, now: Date): Promise<void> {
  const message = buildNightMessage(data, now);
  const result = await editWebhookEmbed(url, messageId, message.content, message.embed);
  if (!result.ok) throw new Error(result.error);
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

/** Records a just-posted message's id on the night's state row. The row's foreign key to the night
 *  refuses the write once the night is gone (its last player dropped out while the message was posting,
 *  before its id was on record to delete), and the message is then taken down rather than left in the
 *  channel for a night that no longer exists. */
async function storeMessageIds(
  db: SupabaseClient,
  url: string,
  nightId: number,
  columns: { announcement_message_id?: string | null; reminder_message_id?: string },
  postedMessageId: string,
): Promise<void> {
  try {
    await db.from('scrim_night_discord_state').upsert({ night_id: nightId, ...columns }, { onConflict: 'night_id' }).throwOnError();
  } catch (e) {
    await deleteWebhookMessage(url, postedMessageId);
    throw e;
  }
}

/** Posts the announcement. */
async function postAnnouncement(db: SupabaseClient, url: string, data: NightMessageData, now: Date): Promise<void> {
  const messageId = await postMessage(url, data, now);
  await storeMessageIds(db, url, data.night.id, { announcement_message_id: messageId }, messageId);
}

/** Deletes the announcement it replaces, then posts the night message. Claims
 *  `scrim_night_discord_state.reminder_sent_at` atomically first, so two racing calls never both post.
 *  If the delete or the post fails, the claim is given back so the next `syncScrimNightMessage()` tries
 *  again; an unreleased claim would leave the night with no message for good. The announcement goes
 *  first so the channel never shows both; its id stays on record until the night message's is stored,
 *  and deleting it again is harmless. */
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

  let messageId: string;
  try {
    const announcementId = claimed[0].announcement_message_id;
    if (announcementId) {
      const deleted = await deleteWebhookMessage(url, announcementId);
      if (!deleted.ok) throw new Error(deleted.error);
    }
    messageId = await postMessage(url, data, now);
  } catch (e) {
    await table().update({ reminder_sent_at: null }).eq('night_id', nightId).throwOnError();
    throw e;
  }
  await storeMessageIds(db, url, nightId, { reminder_message_id: messageId, announcement_message_id: null }, messageId);
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
    else await postAnnouncement(db, url, data, now);
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

/** Rebuilds the night's message and edits it in place: the announcement's roster until the night
 *  message is due (then it posts that, replacing the announcement), the night message after. An ended
 *  night is edited to its final standings once (`finalized_at`), and a reopened one back to its match.
 *  A message that can't be edited (deleted from the channel) is left alone and logged, since a re-post
 *  would ping everyone again. Call after anything that changes it. */
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
      if (ended) return;
      if (isReminderDue(data.night, now)) return postNightMessage(db, url, data, now);
      if (state?.announcement_message_id) await editMessage(url, state.announcement_message_id, data, now);
      return;
    }
    if (ended && state?.finalized_at) return;

    await editMessage(url, messageId, data, now);
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
