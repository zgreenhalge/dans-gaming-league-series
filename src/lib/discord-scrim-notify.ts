// Best-effort Discord messages for scrim nights, posted through the match notifications' webhook
// (`discord-webhook.ts`). Every export is safe to call unconditionally: a missing webhook is a no-op,
// and a failure is logged and recorded to `ops_errors` (entity `scrim_night`) rather than thrown, so
// no caller can fail over a notification. Each kind of failure has its own operation key (below), so
// one kind's success never clears another's still-live error, and a later success of the same kind
// clears its own.
//
// A night has two messages in turn, both built by `buildNightMessage()` and stored in
// `scrim_night_discord_state`:
//   1. The announcement, posted when the night is scheduled. It is edited in place as the roster
//      changes.
//   2. The night message, posted an hour before the start by the one-shot job
//      `scheduleScrimNightReminder()` queues (a night scheduled less than an hour out gets it straight
//      away). The announcement is deleted first, so the channel never shows both. It is then edited in
//      place by `syncScrimNightMessage()`.
// Both show the start and the roster (✅ checked in, ✔️ Definite, ❔ Maybe) under a heading of its
// counts, with the night's state (a countdown, then underway or over) as the message text above the
// embed. The night message also shows the latest started match's running or final score until the next match's server starts, and the final standings once
// the night has ended. A night that goes idle ends on the clock with no write to react to, so each
// sync of a night that hasn't ended queues a one-shot job for the instant it would end
// (`scheduleScrimNightEndSync()`), which syncs it once more. A new post is what notifies the channel; an
// edit does not.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REMINDER_WINDOW_MS,
  EMBED_FIELD_VALUE_MAX,
  deleteWebhookMessage,
  joinWithinLimit,
  matchNotificationsWebhookUrl,
  editWebhookEmbed,
  postWebhookEmbed,
  type Embed,
  type EmbedField,
} from './discord-webhook';
import {
  getScrimLiveScore,
  getScrimNightDiscordState,
  getScrimNightForDiscord,
  getScrimNightIdOfMatch,
  getScrimNightMatches,
  getScrimNightStandings,
  type ScrimDiscordSignup,
  type ScrimLeaderboardRow,
  type ScrimMatch,
} from './queries/scrims';
import { scrimMatchHasStarted } from './scrim-matches';
import { signupCounts } from './scrim-seats';
import { hasScrimNightEnded, hasScrimNightStarted, scrimNightEnd, type ScrimNight } from './scrim-schedule';
import { scrimMatchUrl, scrimNightUrl } from './seo/site';
import { claimReminderSent, releaseReminderClaim, type ClaimTarget } from './discord-claim';
import { clearOpsError, recordOpsError } from './ops-errors';
import { parseScore } from './util';

/** `ops_errors` operation keys, one per kind of failure on a night. */
const OPERATION_ANNOUNCE = 'scrim_announce';
const OPERATION_ANNOUNCEMENT_EDIT = 'scrim_announcement_edit';
const OPERATION_NIGHT_MESSAGE = 'scrim_night_message';
const OPERATION_SCHEDULE_REMINDER = 'scrim_schedule_reminder';
const OPERATION_SCHEDULE_END_SYNC = 'scrim_schedule_end_sync';

const COLOR_UPCOMING = 0xfee75c; // Discord's "yellow", as for a match reminder
const COLOR_LIVE = 0xed4245; // Discord's "red" — a match is being played
const COLOR_OVER = 0x5865f2; // Discord's "blurple" — the night has ended
/** A night is due its night message within this long of its start: the hour's lead plus 5 minutes of
 *  slack, since a pg_cron job fires on the minute, a little before a start with seconds on it. */
const REMINDER_DUE_WITHIN_MS = 65 * 60 * 1000;
/** Standings listed in the message; a night has a handful of players. */
const MAX_STANDINGS_ROWS = 10;

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

/** Runs one step of a night's Discord message under its `ops_errors` operation: a failure is recorded
 *  (and rethrown for the caller's own handling), a success clears the earlier failure. */
async function tracked<T>(db: SupabaseClient, nightId: number, operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    await clearOpsError(db, 'scrim_night', nightId, operation);
    return result;
  } catch (e) {
    await recordOpsError(db, 'scrim_night', nightId, operation, e instanceof Error ? e.message : String(e));
    throw e;
  }
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

/** The night's state, shown as the message text above the embed so a countdown is not lost inside it:
 *  nothing for the announcement, a countdown once the night message is due (`isReminderDue()`), then
 *  underway or over. */
function stateLine(night: ScrimNight, now: Date): string {
  if (hasScrimNightEnded(night, now)) return '🏁 Over';
  if (hasScrimNightStarted(night, now)) return '🟢 Underway';
  return isReminderDue(night, now) ? `⏰ Starting <t:${discordEpoch(night.startsAt)}:R>!` : '';
}

/** The roster's heading: the total, then how many are definite, maybe and checked in. A count of zero
 *  has no label, so the heading never says "0 checked in". */
function rosterHeading(signups: ScrimDiscordSignup[]): string {
  const { definite, maybe } = signupCounts(signups);
  const counts: [number, string][] = [[definite, 'definite'], [maybe, 'maybe'], [signups.filter((s) => s.checkedIn).length, 'checked in']];
  return [`Roster (${signups.length})`, ...counts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`)].join(' · ');
}

/** The message for a night: the state as its text, and in the embed the start (once), the roster with
 *  each player's emoji, and the latest match's score or, once the night is over, the standings. Times
 *  use Discord's own timestamp markup, so they show in each reader's timezone. The night is linked
 *  from the title. */
function buildNightMessage(data: NightMessageData, now: Date): { content: string; embed: Embed } {
  const { night, signups, latestMatch, standings } = data;
  const ended = hasScrimNightEnded(night, now);
  const fields: EmbedField[] = [
    { name: rosterHeading(signups), value: signups.length > 0 ? joinWithinLimit(signups.map((s) => `${statusEmoji(s)} ${s.name}`), EMBED_FIELD_VALUE_MAX) : '—' },
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
    content: stateLine(night, now),
    embed: {
      title: 'Scrim night',
      description: `<t:${discordEpoch(night.startsAt)}:F>`,
      color: ended ? COLOR_OVER : latestMatch?.kind === 'live' ? COLOR_LIVE : COLOR_UPCOMING,
      url: scrimNightUrl(night.id),
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

/** Edits a posted message to the night's current state. Returns `false` when the message no longer
 *  exists (deleted from the channel); throws when Discord refuses the edit for any other reason. */
async function editMessage(url: string, messageId: string, data: NightMessageData, now: Date): Promise<boolean> {
  const message = buildNightMessage(data, now);
  const result = await editWebhookEmbed(url, messageId, message.content, message.embed);
  if (result.ok) return true;
  if (result.status === 404) return false;
  throw new Error(result.error);
}

/** Records a just-posted message's id on the night's state row. If that fails — the row's foreign key
 *  to the night refuses the write once the night is gone (its last player dropped out while the message
 *  was posting, before its id was on record to delete), or the database errored — the message is taken
 *  down rather than left in the channel untracked, and the caller's retry posts it fresh. */
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

/** Empties the night's state row — no message on record, no claim, not finalized — creating it if
 *  need be, so a message posted next starts from a clean slate. */
async function resetState(db: SupabaseClient, nightId: number): Promise<void> {
  const cleared = { night_id: nightId, announcement_message_id: null, reminder_message_id: null, reminder_sent_at: null, finalized_at: null };
  await db.from('scrim_night_discord_state').upsert(cleared, { onConflict: 'night_id' }).throwOnError();
}

/** `postNightMessage()` under its `ops_errors` operation. */
const postNightMessageTracked = (db: SupabaseClient, url: string, data: NightMessageData, now: Date) =>
  tracked(db, data.night.id, OPERATION_NIGHT_MESSAGE, () => postNightMessage(db, url, data, now));

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
 *  and deleting it again is harmless. Failing to store the new message's id gives the claim back too. */
async function postNightMessage(db: SupabaseClient, url: string, data: NightMessageData, now: Date): Promise<void> {
  const nightId = data.night.id;
  const target: ClaimTarget = { kind: 'night', id: nightId };
  // The announcement may never have posted, so `claimReminderSent()` seeds a row to claim if need be.
  const claimed = await claimReminderSent(db, target, now, ['announcement_message_id']);
  if (!claimed) return; // Already sent, or lost the race to a concurrent call.

  try {
    const announcementId = claimed.announcement_message_id;
    if (announcementId) {
      const deleted = await deleteWebhookMessage(url, announcementId);
      if (!deleted.ok) throw new Error(deleted.error);
    }
    const messageId = await postMessage(url, data, now);
    await storeMessageIds(db, url, nightId, { reminder_message_id: messageId, announcement_message_id: null }, messageId);
  } catch (e) {
    await releaseReminderClaim(db, target);
    throw e;
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
    if (isReminderDue(data.night, now)) await postNightMessageTracked(db, url, data, now);
    else await tracked(db, nightId, OPERATION_ANNOUNCE, () => postAnnouncement(db, url, data, now));
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
    await postNightMessageTracked(db, url, data, now);
  });
}

/** Rebuilds the night's message and edits it in place: the announcement's roster until the night
 *  message is due (then it posts that, replacing the announcement), the night message after. An ended
 *  night is edited to its final standings once (`finalized_at`), and a reopened one back to its match.
 *  A night message that can't be edited (deleted from the channel) is logged and left alone, since a
 *  re-post would ping everyone again. Call after anything that changes it. */
export async function syncScrimNightMessage(db: SupabaseClient, nightId: number): Promise<void> {
  const url = matchNotificationsWebhookUrl();
  if (!url) return;
  return bestEffort('syncScrimNightMessage', nightId, async () => {
    const now = new Date();
    const [data, state] = await Promise.all([loadMessageData(db, nightId, now), getScrimNightDiscordState(db, nightId)]);
    if (!data) return;
    const ended = hasScrimNightEnded(data.night, now);
    // Any activity pushes the end back, so every sync of a live night replaces the queued job.
    await scheduleScrimNightEndSync(db, data.night, now);

    const messageId = state?.reminder_message_id ?? null;
    if (!messageId) {
      if (!ended && isReminderDue(data.night, now)) return postNightMessageTracked(db, url, data, now);
      // Only the announcement exists: keep its roster current, or show an ended night as over. One
      // deleted from the channel is forgotten rather than failing every sync until the night message.
      const announcementId = state?.announcement_message_id;
      if (announcementId && !(await tracked(db, nightId, OPERATION_ANNOUNCEMENT_EDIT, () => editMessage(url, announcementId, data, now)))) {
        await db.from('scrim_night_discord_state').update({ announcement_message_id: null }).eq('night_id', nightId).throwOnError();
      }
      return;
    }
    if (ended && state?.finalized_at) return;

    await tracked(db, nightId, OPERATION_NIGHT_MESSAGE, async () => {
      if (!(await editMessage(url, messageId, data, now))) throw new Error('The night message no longer exists in the channel');
    });
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
    const nightId = await getScrimNightIdOfMatch(db, matchId);
    if (nightId != null) await syncScrimNightMessage(db, nightId);
  });
}

/** Queues the night's one-shot reminder (`schedule_scrim_night_reminder()`, a pg_cron job). A night's
 *  start never changes, so this runs once, when the night is scheduled. */
export async function scheduleScrimNightReminder(db: SupabaseClient, nightId: number, startsAt: string): Promise<void> {
  if (!matchNotificationsWebhookUrl()) return;
  return bestEffort('scheduleScrimNightReminder', nightId, async () => {
    await tracked(db, nightId, OPERATION_SCHEDULE_REMINDER, async () => {
      const { data, error } = await db.rpc('schedule_scrim_night_reminder', { p_night_id: nightId, p_starts_at: startsAt });
      if (error) throw error;
      if (!data) throw new Error('the "cron_secret" Vault secret is not configured');
    });
  });
}

/** Queues the one-shot job that syncs the night at the instant it would end on the clock
 *  (`scrimNightEnd()`), replacing the one queued before: the job `POST`s `/api/cron/scrim-night-sync`,
 *  whose `syncScrimNightMessage()` renders the final standings once the night has ended and is a plain
 *  edit if later activity moved the end (that sync has already queued the next job). A night that has
 *  ended queues nothing. Records `scrim_schedule_end_sync` on failure. */
async function scheduleScrimNightEndSync(db: SupabaseClient, night: ScrimNight, now: Date): Promise<void> {
  if (hasScrimNightEnded(night, now)) return;
  return bestEffort('scheduleScrimNightEndSync', night.id, () =>
    tracked(db, night.id, OPERATION_SCHEDULE_END_SYNC, async () => {
      const { data, error } = await db.rpc('schedule_one_shot_post', {
        p_job_name: `scrim_end_${night.id}`,
        p_path: '/api/cron/scrim-night-sync',
        p_body: { nightId: night.id },
        p_fire_at: new Date(scrimNightEnd(night)).toISOString(),
      });
      if (error) throw error;
      if (!data) throw new Error('the "cron_secret" Vault secret is not configured');
    }),
  );
}

/** What `postScrimNightMessage()` posted, or why it could not. */
export type ScrimPostResult =
  | { ok: true; posted: 'announcement' | 'night message' }
  | { ok: false; error: string; notFound?: true };

/** Posts the night's Discord message by hand (an admin's "Post announcement"): the announcement, or
 *  the night message once the night is due one (`isReminderDue()`). Any message on record is deleted
 *  first and the new id stored in its place, so it covers a night whose post failed, whose message was
 *  deleted from the channel, or that holds a duplicate. It also gives back a stuck `reminder_sent_at`
 *  claim, and re-queues the reminder and end-sync jobs (`scheduleScrimNightReminder()`,
 *  `scheduleScrimNightEndSync()`).
 *  Never throws: a failure is returned for the admin and recorded like any other post. */
export async function postScrimNightMessage(db: SupabaseClient, nightId: number): Promise<ScrimPostResult> {
  const url = matchNotificationsWebhookUrl();
  if (!url) return { ok: false, error: 'The Discord match notifications webhook is not configured' };
  try {
    const now = new Date();
    const data = await loadMessageData(db, nightId, now);
    if (!data) return { ok: false, error: 'Night not found', notFound: true };
    // Re-queued whatever the night's state, so a retry of a failed schedule clears its row; a start
    // already within the hour (or past) queues nothing and succeeds.
    await scheduleScrimNightReminder(db, nightId, data.night.startsAt);
    if (hasScrimNightEnded(data.night, now)) return { ok: false, error: 'The night is over' };
    await scheduleScrimNightEndSync(db, data.night, now);
    const due = isReminderDue(data.night, now);

    await tracked(db, nightId, due ? OPERATION_NIGHT_MESSAGE : OPERATION_ANNOUNCE, async () => {
      const state = await getScrimNightDiscordState(db, nightId);
      for (const id of [state?.announcement_message_id, state?.reminder_message_id]) {
        if (!id) continue;
        const deleted = await deleteWebhookMessage(url, id);
        if (!deleted.ok) throw new Error(deleted.error);
      }
      await resetState(db, nightId);
      if (due) await postNightMessage(db, url, data, now);
      else await postAnnouncement(db, url, data, now);
    });
    return { ok: true, posted: due ? 'night message' : 'announcement' };
  } catch (e) {
    console.error(`postScrimNightMessage(${nightId}) failed:`, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The ids of the Discord messages posted for a night. Read before a drop-out that may remove the night:
 *  the state row goes with it. */
export async function getScrimNightMessageIds(db: SupabaseClient, nightId: number): Promise<string[]> {
  if (!matchNotificationsWebhookUrl()) return [];
  try {
    const state = await getScrimNightDiscordState(db, nightId);
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
