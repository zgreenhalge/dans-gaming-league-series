// Best-effort Discord webhook announcements for scrim nights, posted to the same channel as the match
// notifications (`DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL`, see `discord-notify.ts`) and built from
// the same webhook primitives (`discord-webhook.ts`). Every export is safe to call unconditionally: a
// missing webhook URL is a no-op, and a failure is logged rather than thrown, so none of the routes
// that call these can fail over a notification. (`ops_errors` has no scrim-night entity, so a failure
// lands in the function log.)
//
// A night has up to two messages, both stored in `scrim_night_discord_state`:
//   - the announcement, posted when the night is started (`notifyScrimNightScheduled()`), and
//   - the starting message, posted when the night starts (`notifyScrimNightStarting()`, called from
//     `POST /api/cron/scrim-start`, which a one-shot pg_cron job queued by
//     `scheduleScrimNightStart()` fires). A new post is what pings people; an edit does not.
// Every roster change (a signup, a changed commitment, a drop-out, a check-in) rebuilds the roster from
// the database and edits whichever of the two exist in place (`syncScrimNightRoster()`), so neither goes
// stale — the match notifications' "one message edited in place" pattern. A night that ends stops being
// edited, and a night removed with its last player has its messages deleted
// (`deleteScrimNightMessages()`).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteWebhookMessage,
  editWebhookEmbed,
  playerTag,
  postWebhookEmbed,
  type Embed,
} from './discord-webhook';
import { getScrimNightForDiscord, type ScrimDiscordSignup } from './queries/scrims';
import { hasScrimNightEnded, type ScrimNight } from './scrim-schedule';
import { SITE_URL } from './seo/site';
import { formatLeagueDateTime } from './util';

const COLOR_SCHEDULED = 0x1abc9c; // teal — distinct from the match notification colors
const COLOR_STARTING = 0xfee75c; // Discord's "yellow", as for a match reminder
// How far from the start the starting message may fire and still post: a pg_cron job fires at the
// start by construction; this tolerates pg_net delivery lag and clock skew.
const STARTING_WINDOW_MS = 30 * 60 * 1000;

type MessageKind = 'announcement' | 'starting';
const MESSAGE_COLUMN = { announcement: 'announcement_message_id', starting: 'starting_message_id' } as const;

interface DiscordState {
  announcement_message_id: string | null;
  starting_message_id: string | null;
}

function webhookUrl(): string | undefined {
  return process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL || undefined;
}

/** Runs one notification, logging instead of throwing — the no-throw guarantee every export keeps. */
async function bestEffort(label: string, nightId: number, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`${label}(${nightId}) failed (non-fatal):`, e);
  }
}

function nightUrl(nightId: number): string {
  return `${SITE_URL}/scrims/${nightId}`;
}

/** The roster as one embed field: a ✅ marks a player who has checked in. */
function rosterField(name: string, signups: ScrimDiscordSignup[]): { name: string; value: string; inline: boolean } {
  const lines = signups.map((s) => `${s.checkedIn ? '✅ ' : ''}${s.name}`);
  return { name: `${name} (${signups.length})`, value: lines.length > 0 ? lines.join('\n') : '—', inline: true };
}

/** A night's message: the roster tagged in `content` (the one place mentions render, as in
 *  `discord-notify.ts`) and listed by name, Definite then Maybe, in the embed. The time uses Discord's
 *  own timestamp markup, so it shows in each reader's timezone and the relative form counts down
 *  without being edited. */
function buildScrimNightMessage(
  night: ScrimNight,
  signups: ScrimDiscordSignup[],
  kind: MessageKind,
): { content: string; embed: Embed } {
  const definite = signups.filter((s) => s.commitment === 'definite');
  const maybe = signups.filter((s) => s.commitment === 'maybe');
  const epoch = Math.floor(Date.parse(night.startsAt) / 1000);
  const statusLine =
    kind === 'announcement'
      ? `📅 **Scrim night scheduled**\n<t:${epoch}:F> · <t:${epoch}:R>`
      : `🚦 **Scrim night is starting**\n<t:${epoch}:F>`;

  const tagLines = [
    definite.length > 0 ? `Definite: ${definite.map(playerTag).join(' ')}` : '',
    maybe.length > 0 ? `Maybe: ${maybe.map(playerTag).join(' ')}` : '',
  ].filter(Boolean);

  return {
    content: tagLines.join('\n'),
    embed: {
      title: `Scrim night · ${formatLeagueDateTime(night.startsAt)}`,
      description: statusLine,
      color: kind === 'announcement' ? COLOR_SCHEDULED : COLOR_STARTING,
      url: nightUrl(night.id),
      author: { name: 'Scrims' },
      fields: [rosterField('Definite', definite), rosterField('Maybe', maybe)],
    },
  };
}

async function getState(db: SupabaseClient, nightId: number): Promise<DiscordState | null> {
  const { data, error } = await db
    .from('scrim_night_discord_state')
    .select('announcement_message_id, starting_message_id')
    .eq('night_id', nightId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function rememberMessage(db: SupabaseClient, nightId: number, kind: MessageKind, messageId: string): Promise<void> {
  await db
    .from('scrim_night_discord_state')
    .upsert({ night_id: nightId, [MESSAGE_COLUMN[kind]]: messageId }, { onConflict: 'night_id' })
    .throwOnError();
}

/** Posts a message and stores its id for later edits. Throws when the post fails. */
async function postAndRemember(
  db: SupabaseClient,
  url: string,
  nightId: number,
  kind: MessageKind,
  message: { content: string; embed: Embed },
): Promise<void> {
  const result = await postWebhookEmbed(url, message.content, message.embed);
  if (!result.ok) throw new Error(result.error);
  if (result.id) await rememberMessage(db, nightId, kind, result.id);
}

/** Announces a night that has just been started: posts its announcement with the roster so far. */
export async function notifyScrimNightScheduled(db: SupabaseClient, nightId: number): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  return bestEffort('notifyScrimNightScheduled', nightId, async () => {
    const data = await getScrimNightForDiscord(db, nightId);
    if (!data || hasScrimNightEnded(data.night, new Date())) return;
    await postAndRemember(db, url, nightId, 'announcement', buildScrimNightMessage(data.night, data.signups, 'announcement'));
  });
}

/** Rebuilds the roster and edits the night's announcement and starting messages in place. An
 *  announcement that was never posted, or can no longer be edited (deleted from the channel), is posted
 *  fresh; a starting message that can't be edited is left alone, since a re-post would ping everyone again. A
 *  night that has ended is not touched. Call after any signup, commitment, check-in or drop-out. */
export async function syncScrimNightRoster(db: SupabaseClient, nightId: number): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  return bestEffort('syncScrimNightRoster', nightId, async () => {
    const [data, state] = await Promise.all([getScrimNightForDiscord(db, nightId), getState(db, nightId)]);
    if (!data || hasScrimNightEnded(data.night, new Date())) return;

    const failures: string[] = [];
    const announcementId = state?.announcement_message_id ?? null;
    const announcement = buildScrimNightMessage(data.night, data.signups, 'announcement');
    const edited = announcementId ? await editWebhookEmbed(url, announcementId, announcement.content, announcement.embed) : null;
    if (!edited?.ok) {
      try {
        await postAndRemember(db, url, nightId, 'announcement', announcement);
      } catch (e) {
        failures.push((e as Error).message);
      }
    }

    const startingId = state?.starting_message_id ?? null;
    if (startingId) {
      const starting = buildScrimNightMessage(data.night, data.signups, 'starting');
      const result = await editWebhookEmbed(url, startingId, starting.content, starting.embed);
      if (!result.ok) failures.push(result.error);
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
  });
}

/** Posts the starting message when the night starts. Called by `POST /api/cron/scrim-start`,
 *  fired once by the pg_cron job `scheduleScrimNightStart()` queues. Skips a night that is gone, has
 *  ended, or whose start is not within `STARTING_WINDOW_MS` of now. Claims
 *  `scrim_night_discord_state.starting_sent_at` atomically before posting, so two racing calls never
 *  both post; nothing retries a failed post, since the pg_cron job is already spent. */
export async function notifyScrimNightStarting(db: SupabaseClient, nightId: number): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  return bestEffort('notifyScrimNightStarting', nightId, async () => {
    const data = await getScrimNightForDiscord(db, nightId);
    if (!data) return;
    const msFromStart = Math.abs(Date.parse(data.night.startsAt) - Date.now());
    if (hasScrimNightEnded(data.night, new Date()) || msFromStart > STARTING_WINDOW_MS) return;

    // The announcement may never have posted, so there may be no row to claim yet; seed one without
    // overwriting an existing row.
    await db
      .from('scrim_night_discord_state')
      .upsert({ night_id: nightId, starting_sent_at: null }, { onConflict: 'night_id', ignoreDuplicates: true })
      .throwOnError();
    const { data: claimed } = await db
      .from('scrim_night_discord_state')
      .update({ starting_sent_at: new Date().toISOString() })
      .eq('night_id', nightId)
      .is('starting_sent_at', null)
      .select('night_id')
      .throwOnError();
    if (!claimed || claimed.length === 0) return; // Already sent, or lost the race to a concurrent call.

    await postAndRemember(db, url, nightId, 'starting', buildScrimNightMessage(data.night, data.signups, 'starting'));
  });
}

/** Queues the night's one-shot starting message (`schedule_scrim_night_start()`, a pg_cron job). A night's
 *  start never changes, so this runs once, when the night is started. */
export async function scheduleScrimNightStart(db: SupabaseClient, nightId: number, startsAt: string): Promise<void> {
  if (!webhookUrl()) return;
  return bestEffort('scheduleScrimNightStart', nightId, async () => {
    const { data, error } = await db.rpc('schedule_scrim_night_start', { p_night_id: nightId, p_starts_at: startsAt });
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
    return [state?.announcement_message_id, state?.starting_message_id].filter((id): id is string => !!id);
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
