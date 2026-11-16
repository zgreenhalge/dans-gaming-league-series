// Best-effort Discord webhook messages for scrim nights, posted to the same channel as the match
// notifications (`DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL`, see `discord-notify.ts`) and built from
// the same webhook primitives (`discord-webhook.ts`). Every export is safe to call unconditionally: a
// missing webhook URL is a no-op, and a failure is logged rather than thrown, so none of the routes
// that call these can fail over a notification. (`ops_errors` has no scrim-night entity, so a failure
// lands in the function log.)
//
// A night has two messages over its life, both stored in `scrim_night_discord_state`:
//   1. The announcement, posted when the night is scheduled (`notifyScrimNightScheduled()`): its start
//      time and a link to the night, which Discord unfurls into the site's own preview card.
//   2. The night message, posted an hour before the start (`notifyScrimNightReminder()`, called from
//      `POST /api/cron/scrim-reminder`, which a one-shot pg_cron job queued by
//      `scheduleScrimNightReminder()` fires). It deletes the announcement and carries the night from
//      then on: the roster with each player's Definite/Maybe emoji, then the latest match's running
//      and final score with a link to it — until the next match starts and takes its place — and, once
//      the night has ended, the final standings in place of that score. A night scheduled less than an
//      hour out gets this message straight away instead of an announcement.
// `syncScrimNightMessage()` rebuilds the night message from the database and edits it in place after
// anything that changes it: a signup, a check-in, a drop-out, a match's live or final score, a discard,
// the night ending or reopening. A night that ends on the clock has no write to react to, so
// `finalizeEndedScrimNights()` (`POST /api/cron/scrim-finalize`, every five minutes) catches those.
// A new post is what pings people; an edit does not. A night removed with its last player has its
// messages deleted (`deleteScrimNightMessages()`).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REMINDER_WINDOW_MS,
  deleteWebhookMessage,
  editWebhookEmbed,
  playerTag,
  postWebhookEmbed,
  type Embed,
  type EmbedField,
} from './discord-webhook';
import {
  buildScrimNightLeaderboard,
  getScrimNightForDiscord,
  getScrimNightMatches,
  type ScrimDiscordSignup,
  type ScrimLeaderboardRow,
  type ScrimMatch,
} from './queries/scrims';
import { hasScrimNightEnded, hasScrimNightStarted, type ScrimNight } from './scrim-schedule';
import { scrimMatchHref, scrimNightHref } from './crumbs';
import { SITE_URL } from './seo/site';
import { formatLeagueDateTime, isPlayedScore, parseScore } from './util';

const COLOR_UPCOMING = 0xfee75c; // Discord's "yellow", as for a match reminder
const COLOR_LIVE = 0xed4245; // Discord's "red" — a match is being played
const COLOR_OVER = 0x5865f2; // Discord's "blurple" — the night has ended
/** How long before the start the night message posts. */
const REMINDER_LEAD_MS = 60 * 60 * 1000;
/** Slack on the lead: a pg_cron job fires on the minute, a little before a start with seconds on it. */
const REMINDER_LEAD_SLACK_MS = 5 * 60 * 1000;
/** Standings listed in the message; a night has a handful of players. */
const MAX_STANDINGS_ROWS = 10;

interface DiscordState {
  announcement_message_id: string | null;
  reminder_message_id: string | null;
  finalized_at: string | null;
}

/** What the night message shows of the latest match that has started: its score, running or final. */
interface LatestMatch {
  match: ScrimMatch;
  live: boolean;
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

function webhookUrl(): string | undefined {
  return process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL || undefined;
}

/** Runs one notification, logging instead of throwing — the no-throw guarantee every export keeps. */
async function bestEffort(label: string, id: number, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`${label}(${id}) failed (non-fatal):`, e);
  }
}

const nightUrl = (nightId: number) => `${SITE_URL}${scrimNightHref(nightId)}`;
const matchUrl = (matchId: number) => `${SITE_URL}${scrimMatchHref(matchId)}`;

/** Whether the night is due its night message: it starts within the lead, or already has. */
function isReminderDue(night: ScrimNight, now: Date): boolean {
  return Date.parse(night.startsAt) - now.getTime() <= REMINDER_LEAD_MS + REMINDER_LEAD_SLACK_MS;
}

/** The latest match that has started — scored, or with a live score — in play order, so the next
 *  match takes over as soon as its server reports a score. `null` before any has. */
async function getLatestMatch(db: SupabaseClient, matches: ScrimMatch[]): Promise<LatestMatch | null> {
  const unplayed = matches.filter((m) => !isPlayedScore(m.final_score)).map((m) => m.id);
  const liveById = new Map<number, { shirts: number; skins: number; round: number | null }>();
  if (unplayed.length > 0) {
    const { data, error } = await db.from('live_match_score').select('match_id, shirts_score, skins_score, round').in('match_id', unplayed);
    if (error) throw error;
    for (const r of (data ?? []) as { match_id: number; shirts_score: number; skins_score: number; round: number | null }[]) {
      liveById.set(r.match_id, { shirts: r.shirts_score, skins: r.skins_score, round: r.round });
    }
  }
  for (const match of [...matches].reverse()) {
    const final = parseScore(match.final_score);
    if (final) return { match, live: false, ...final, round: null };
    const live = liveById.get(match.id);
    if (live) return { match, live: true, ...live };
  }
  return null;
}

/** Everything the night message shows, read fresh through `db`. `null` when the night doesn't exist. */
async function loadMessageData(db: SupabaseClient, nightId: number, now: Date): Promise<NightMessageData | null> {
  const base = await getScrimNightForDiscord(db, nightId);
  if (!base) return null;
  const { night, signups } = base;
  if (!hasScrimNightStarted(night, now)) return { night, signups, latestMatch: null, standings: null };

  const matches = await getScrimNightMatches(nightId, db);
  if (!hasScrimNightEnded(night, now)) return { night, signups, latestMatch: await getLatestMatch(db, matches), standings: null };
  const playerIds = [...new Set(matches.flatMap((m) => m.players.map((p) => p.player_id)))];
  const playersRes = playerIds.length > 0 ? await db.from('players').select('id, name, steam_avatar_url').in('id', playerIds) : { data: [], error: null };
  if (playersRes.error) throw playersRes.error;
  const playersById = new Map(((playersRes.data ?? []) as { id: number; name: string; steam_avatar_url: string | null }[]).map((p) => [p.id, p]));
  const standings = buildScrimNightLeaderboard(matches, playersById);
  return { night, signups, latestMatch: null, standings: standings.length > 0 ? standings : null };
}

/** Definite ✅ or Maybe ❔ beside each player. */
const commitmentEmoji = (s: ScrimDiscordSignup) => (s.commitment === 'definite' ? '✅' : '❔');

/** Standings as a fixed-width `# Player W-L ADR` table in a code block (embed field values render in
 *  a proportional font otherwise). */
function standingsTable(rows: ScrimLeaderboardRow[]): string {
  const shown = rows.slice(0, MAX_STANDINGS_ROWS).map((r, i) => ({ rank: String(i + 1), name: r.player_name, record: `${r.wins}-${r.losses}`, adr: r.adr.toFixed(1) }));
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
  const epoch = Math.floor(Date.parse(night.startsAt) / 1000);
  const ended = hasScrimNightEnded(night, now);
  const status = ended
    ? '🏁 **Scrim night over**'
    : hasScrimNightStarted(night, now)
      ? '🟢 **Scrim night underway**'
      : `⏰ **Scrim night starts <t:${epoch}:R>**`;

  const fields: EmbedField[] = [
    { name: `Roster (${signups.length})`, value: signups.length > 0 ? signups.map((s) => `${commitmentEmoji(s)} ${s.name}`).join('\n') : '—' },
  ];
  if (standings) fields.push({ name: 'Final standings', value: standingsTable(standings) });
  if (latestMatch) {
    const { match, live, shirts, skins, round } = latestMatch;
    const result = live ? `🔴 **LIVE** ${shirts}-${skins}${round != null ? ` · Round ${round}` : ''}` : `🏁 **Final** ${shirts}-${skins}`;
    fields.push({ name: `Match ${match.match_number}${match.map ? ` · ${match.map}` : ''}`, value: `${result}\n[Match page](${matchUrl(match.id)})` });
  }

  const tagLines = [
    signups.some((s) => s.commitment === 'definite') ? `Definite: ${signups.filter((s) => s.commitment === 'definite').map(playerTag).join(' ')}` : '',
    signups.some((s) => s.commitment === 'maybe') ? `Maybe: ${signups.filter((s) => s.commitment === 'maybe').map(playerTag).join(' ')}` : '',
  ].filter(Boolean);

  return {
    content: tagLines.join('\n'),
    embed: {
      title: `Scrim night · ${formatLeagueDateTime(night.startsAt)}`,
      description: `${status}\n<t:${epoch}:F>\n[Open the night](${nightUrl(night.id)})`,
      color: ended ? COLOR_OVER : latestMatch?.live ? COLOR_LIVE : COLOR_UPCOMING,
      url: nightUrl(night.id),
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

/** Posts the announcement: the start time and a link to the night, as plain content so Discord
 *  unfurls the site's preview of it. */
async function postAnnouncement(db: SupabaseClient, url: string, night: ScrimNight): Promise<void> {
  const epoch = Math.floor(Date.parse(night.startsAt) / 1000);
  const content = `📅 **Scrim night scheduled** — <t:${epoch}:F> (<t:${epoch}:R>)\n${nightUrl(night.id)}`;
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
 *  `scrim_night_discord_state.reminder_sent_at` atomically first, so two racing calls never both post;
 *  nothing retries a post that fails after the claim except a later `syncScrimNightMessage()`, which
 *  finds the claim taken and leaves it. Posting before deleting means a failed post never leaves the
 *  channel with neither message. */
async function postNightMessage(db: SupabaseClient, url: string, data: NightMessageData, now: Date): Promise<void> {
  const nightId = data.night.id;
  // The announcement may never have posted, so there may be no row to claim yet; seed one without
  // overwriting an existing row.
  await db
    .from('scrim_night_discord_state')
    .upsert({ night_id: nightId, reminder_sent_at: null }, { onConflict: 'night_id', ignoreDuplicates: true })
    .throwOnError();
  const { data: claimed } = await db
    .from('scrim_night_discord_state')
    .update({ reminder_sent_at: now.toISOString() })
    .eq('night_id', nightId)
    .is('reminder_sent_at', null)
    .select('night_id, announcement_message_id')
    .throwOnError();
  if (!claimed || claimed.length === 0) return; // Already sent, or lost the race to a concurrent call.

  const message = buildNightMessage(data, now);
  const result = await postWebhookEmbed(url, message.content, message.embed);
  if (!result.ok) throw new Error(result.error);
  if (result.id) {
    await db.from('scrim_night_discord_state').update({ reminder_message_id: result.id }).eq('night_id', nightId).throwOnError();
  }

  const announcementId = claimed[0].announcement_message_id;
  if (announcementId) {
    const deleted = await deleteWebhookMessage(url, announcementId);
    if (!deleted.ok) throw new Error(deleted.error);
    await db.from('scrim_night_discord_state').update({ announcement_message_id: null }).eq('night_id', nightId).throwOnError();
  }
}

/** Announces a night that has just been scheduled. A night starting within the hour skips the
 *  announcement and gets the night message right away. */
export async function notifyScrimNightScheduled(db: SupabaseClient, nightId: number): Promise<void> {
  const url = webhookUrl();
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
  const url = webhookUrl();
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
 *  after anything that changes it. `onlyEnded` skips a night that is still on — the sweep's filter. */
export async function syncScrimNightMessage(db: SupabaseClient, nightId: number, opts: { onlyEnded?: boolean } = {}): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  return bestEffort('syncScrimNightMessage', nightId, async () => {
    const now = new Date();
    const [data, state] = await Promise.all([loadMessageData(db, nightId, now), getState(db, nightId)]);
    if (!data) return;
    const ended = hasScrimNightEnded(data.night, now);
    if (opts.onlyEnded && !ended) return;

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
  if (!webhookUrl()) return;
  return bestEffort('notifyScrimMatchProgress', matchId, async () => {
    const { data, error } = await db.from('matches').select('scrim_night_id').eq('id', matchId).maybeSingle();
    if (error) throw error;
    const nightId = (data as { scrim_night_id: number | null } | null)?.scrim_night_id;
    if (nightId != null) await syncScrimNightMessage(db, nightId);
  });
}

/** Finalizes the night message of every night that has ended without a write to react to (it went
 *  idle on the clock): shows its standings. Called every five minutes by
 *  `POST /api/cron/scrim-finalize`. */
export async function finalizeEndedScrimNights(db: SupabaseClient): Promise<void> {
  if (!webhookUrl()) return;
  return bestEffort('finalizeEndedScrimNights', 0, async () => {
    const { data, error } = await db
      .from('scrim_night_discord_state')
      .select('night_id')
      .not('reminder_message_id', 'is', null)
      .is('finalized_at', null);
    if (error) throw error;
    for (const { night_id } of (data ?? []) as { night_id: number }[]) {
      await syncScrimNightMessage(db, night_id, { onlyEnded: true });
    }
  });
}

/** Queues the night's one-shot reminder (`schedule_scrim_night_reminder()`, a pg_cron job). A night's
 *  start never changes, so this runs once, when the night is scheduled. */
export async function scheduleScrimNightReminder(db: SupabaseClient, nightId: number, startsAt: string): Promise<void> {
  if (!webhookUrl()) return;
  return bestEffort('scheduleScrimNightReminder', nightId, async () => {
    const { data, error } = await db.rpc('schedule_scrim_night_reminder', { p_night_id: nightId, p_starts_at: startsAt });
    if (error) throw error;
    if (!data) throw new Error('the "cron_secret" Vault secret is not configured');
  });
}

/** The ids of the Discord messages posted for a night. Read before a drop-out that may remove the night:
 *  the state row goes with it. */
export async function getScrimNightMessageIds(db: SupabaseClient, nightId: number): Promise<string[]> {
  if (!webhookUrl()) return [];
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
  const url = webhookUrl();
  if (!url) return;
  return bestEffort('deleteScrimNightMessages', nightId, async () => {
    const results = await Promise.all(messageIds.map((id) => deleteWebhookMessage(url, id)));
    const failed = results.flatMap((r) => (r.ok ? [] : [r.error]));
    if (failed.length > 0) throw new Error(failed.join('; '));
  });
}
