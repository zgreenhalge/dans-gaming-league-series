// Best-effort Discord webhook notifications for #match-notifications (#395). Every export here is
// safe to call unconditionally — a missing DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL or a webhook
// failure never throws, matching the rest of this codebase's best-effort hooks (ops-errors.ts,
// afterBestEffort()). A real failure (the webhook itself
// erroring, not just being unconfigured) is recorded to ops_errors — entity 'match', operation
// 'discord_notify_server_live'/'discord_notify_live_score'/'discord_notify_score'/'discord_notify_reminder'
// — so it's visible in the admin console's Activity feed instead of only a Vercel function log
// nobody's tailing; cleared automatically the next notification of that same kind that succeeds.
// Each notification kind uses a distinct operation key (not a shared 'discord_notify') so one kind's
// failure can't clear another's still-live one — see ops-errors.ts's own docstring on why `operation`
// is part of the key.
//
// All four are built from `getMatchMeta()` (seo/og.ts) — the same data the site's own link-preview
// OG card and meta description use when a match URL is unfurled — rather than re-deriving the
// title/roster/map here.
//
// One message is the source of truth per match: `notifyMatchServerLive()` posts with `?wait=true`
// (the only way a webhook POST returns the created message's id) and stores it in
// `match_discord_state.notification_message_id`, the same per-match Discord state table
// `discord-threads.ts` already keys its `thread_id` off of. `notifyMatchLiveScore()` and
// `notifyMatchScoreReported()` then edit that message in place via Discord's webhook-message PATCH
// endpoint instead of posting a second one.
//
// `notifyMatchLiveScore()` fires on every `going_live`/`round_end` MatchZy event (wired from the
// `matchzy-log` ingest route, right after `putLiveScoreEvent()` writes `live_match_score` — the same
// table the site's own live ticker/`MatchScoreHero` subscribe to via Realtime) so the running score
// stays current on the one message instead of the channel getting a new post per round. It takes the
// event name and the row `putLiveScoreEvent()` already wrote as parameters rather than re-reading
// them, and never falls back to posting a fresh message on failure — a missed round's edit just
// means the next one tries again, not that the channel needs spam.
//
// `notifyMatchScoreReported()` falls back to posting a new message if there's nothing to edit yet —
// notifications were off when the server went live, that post failed, or the message was deleted out
// from under the bot.
//
// `notifyMatchReminder()` posts a separate message (not an edit of the tracked
// notification_message_id lineage above) roughly an hour before a scheduled match, called from
// `POST /api/cron/match-reminder` — itself invoked once, per match, by a Postgres pg_cron job that
// `schedule_match_reminder()` schedules for the exact minute whenever a match's `scheduled_at` is
// set (see `src/app/api/matches/[id]/schedule/route.ts`). There is no polling and no retry: the
// pg_cron job is one-shot and self-unschedules once it fires, so a failed post here has nothing
// re-triggering it — `match_discord_state.reminder_sent_at` is claimed atomically before posting to
// guard against a duplicate rather than a missed one.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMatchMeta } from './seo/og';
import { getMatchBoxScore, type MatchBoxScorePlayer, type MatchDiscordPlayer } from './queries/match';
import type { LiveScoreRow } from './demo/liveScore';
import { recordOpsError, clearOpsError } from './ops-errors';
import { SITE_URL } from './seo/site';
import { discordErrorDetail } from './discord-threads';
import { formatDuration } from './util';

type MatchMeta = NonNullable<Awaited<ReturnType<typeof getMatchMeta>>>;

const COLOR_SERVER_LIVE = 0x57f287; // Discord's "green" — server provisioned, nothing played yet
const COLOR_LIVE_SCORE = 0xed4245; // Discord's "red" — a round is actually in progress
const COLOR_SCORE = 0x5865f2; // Discord's "blurple" — final result
const COLOR_REMINDER = 0xfee75c; // Discord's "yellow" — distinct from the other three
const OPERATION_SERVER_LIVE = 'discord_notify_server_live';
const OPERATION_LIVE_SCORE = 'discord_notify_live_score';
const OPERATION_SCORE = 'discord_notify_score';
const OPERATION_REMINDER = 'discord_notify_reminder';
// A pg_cron job fires this ~1h before scheduled_at by construction; this window just tolerates
// clock skew/pg_net delivery lag while still catching the real failure mode it guards against — the
// match having been rescheduled away from the time the job was originally queued for.
const REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;

type EmbedField = { name: string; value: string; inline?: boolean };
type Embed = {
  title: string;
  description: string;
  color: number;
  url: string;
  author: { name: string };
  thumbnail?: { url: string };
  fields?: EmbedField[];
};

interface MatchEmbedParts {
  matchId: number;
  seasonName: string;
  weekMatchLabel: string;
  statusLine: string;
  map?: string | null;
  color: number;
  image?: string | null;
  boxScore?: { shirts: MatchBoxScorePlayer[]; skins: MatchBoxScorePlayer[] };
}

/** A player's name-color role mention (`<@&roleId>`) when they have one, else their plain name
 *  bolded — the same "tag if linked, else plain name" fallback `discord-threads.ts`'s `openingPost()`
 *  uses for user mentions. Only usable in a webhook message's `content`: Discord does not render
 *  mentions typed inside an embed (title, description, or field values) as tags at all — they show as
 *  literal `<@&...>` text there — so this is for the roster line in `buildMatchContent()` below, never
 *  for the box score, which lives in an embed field. */
function playerTag(player: MatchDiscordPlayer): string {
  return player.discordNameRoleId ? `<@&${player.discordNameRoleId}>` : `**${player.name}**`;
}

/** The webhook message's plain `content`, sent alongside the embed — a "Shirts vs Skins" roster line
 *  tagging each player by their name-color role (or bolding their name, for anyone not yet linked).
 *  This is the one place in the message mentions actually render as tags; the embed itself (title,
 *  description, fields) never parses them. Present on all three notification kinds, since it's the
 *  only place players are named once the box score drops the roster from the description below. */
function buildMatchContent(shirtPlayers: MatchDiscordPlayer[], skinPlayers: MatchDiscordPlayer[]): string {
  return `${shirtPlayers.map(playerTag).join(' & ')} vs ${skinPlayers.map(playerTag).join(' & ')}`;
}

/** Renders a team's box score as a fixed-width `Player  K/A/D  ADR` table inside a code block —
 *  embed field values render in Discord's default (non-monospace) font otherwise, so alignment needs
 *  the fence. Plain names, not tags: players are already tagged once in the roster line in `content`
 *  (`buildMatchContent()`), and Discord doesn't parse mentions (or any markdown, including bold) inside
 *  a code block anyway. Column widths are computed from this team's own rows, not shared across both
 *  fields, since the two are independent fields with no visual alignment between them. */
function boxScoreTable(players: MatchBoxScorePlayer[]): string {
  const rows = players.map((p) => ({ name: p.name, kad: `${p.kills}/${p.assists}/${p.deaths}`, adr: String(p.adr) }));
  const nameWidth = Math.max('Player'.length, ...rows.map((r) => r.name.length));
  const kadWidth = Math.max('K/A/D'.length, ...rows.map((r) => r.kad.length));
  const adrWidth = Math.max('ADR'.length, ...rows.map((r) => r.adr.length));
  const line = (name: string, kad: string, adr: string) =>
    `${name.padEnd(nameWidth)}  ${kad.padStart(kadWidth)}  ${adr.padStart(adrWidth)}`;
  return ['```', line('Player', 'K/A/D', 'ADR'), '', ...rows.map((r) => line(r.name, r.kad, r.adr)), '```'].join('\n');
}

/** Shared embed layout for all three notification kinds. The season name is the embed's `author`
 *  line (Discord's small "eyebrow" text above the title — the same role it plays for real
 *  sports/esports score bots), the title is just "Week N · Match M" (short enough to never wrap
 *  oddly, and doubles as a clickable link to the match page via `url`) — the description doesn't
 *  repeat that link, since the title already carries it. `matchUrl`/the thumbnail are derived here
 *  (from `matchId`/`image`) rather than by each caller, since all three need the same ones.
 *
 *  Players are never named in the embed itself — the roster line in the message's `content`
 *  (`buildMatchContent()`) is the one place mentions render as tags, so the description is just the
 *  map (if known) then the status block. A post-match box score, when given, becomes two full-width
 *  (non-inline) fields, Shirts then Skins stacked. */
function buildMatchEmbed(parts: MatchEmbedParts): Embed {
  const matchUrl = `${SITE_URL}/matches/${parts.matchId}`;
  const mapLine = parts.map ? `on ${parts.map}\n\n` : '';
  const embed: Embed = {
    title: parts.weekMatchLabel,
    description: `${mapLine}${parts.statusLine}`,
    color: parts.color,
    url: matchUrl,
    author: { name: parts.seasonName },
  };
  if (parts.image) embed.thumbnail = { url: `${SITE_URL}${parts.image}` };
  if (parts.boxScore) {
    const fields: EmbedField[] = [];
    if (parts.boxScore.shirts.length > 0) fields.push({ name: 'Shirts', value: boxScoreTable(parts.boxScore.shirts) });
    if (parts.boxScore.skins.length > 0) fields.push({ name: 'Skins', value: boxScoreTable(parts.boxScore.skins) });
    if (fields.length > 0) embed.fields = fields;
  }
  return embed;
}

/** Builds a notification's `content` (roster line) and `embed` together from `getMatchMeta()`'s
 *  result — the one assembly step all three notification kinds share, so each just supplies what
 *  actually varies between them (`statusLine`/`color`/`boxScore`). */
function buildMatchMessage(
  matchId: number,
  meta: MatchMeta,
  opts: { statusLine: string; color: number; boxScore?: { shirts: MatchBoxScorePlayer[]; skins: MatchBoxScorePlayer[] } },
): { content: string; embed: Embed } {
  return {
    content: buildMatchContent(meta.shirtPlayers, meta.skinPlayers),
    embed: buildMatchEmbed({
      matchId,
      seasonName: meta.seasonName,
      weekMatchLabel: meta.weekMatchLabel,
      statusLine: opts.statusLine,
      map: meta.mapName,
      color: opts.color,
      image: meta.image,
      boxScore: opts.boxScore,
    }),
  };
}

/** Posts a new message and returns its id (via `?wait=true`, the only way a webhook POST returns
 *  one) so a later call can edit it in place — `null` if unconfigured, if the post failed, or if
 *  Discord's response didn't parse. */
async function postNewEmbed(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  operation: string,
  webhookUrl: string,
  content: string,
  embed: Embed,
): Promise<string | null> {
  try {
    const res = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds: [embed] }),
    });
    if (!res.ok) {
      await recordOpsError(supabaseAdmin, 'match', matchId, operation, await discordErrorDetail('Webhook post', res));
      return null;
    }
    await clearOpsError(supabaseAdmin, 'match', matchId, operation);
    const posted = (await res.json().catch(() => null)) as { id?: string } | null;
    return posted?.id ?? null;
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'match', matchId, operation, `Webhook post failed: ${(e as Error).message}`);
    return null;
  }
}

/** Edits a previously-posted webhook message in place. Returns whether it succeeded — a caller
 *  should fall back to `postNewEmbed()` on `false` (the message may have been deleted). */
async function editEmbed(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  operation: string,
  webhookUrl: string,
  messageId: string,
  content: string,
  embed: Embed,
): Promise<boolean> {
  try {
    const res = await fetch(`${webhookUrl}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds: [embed] }),
    });
    if (!res.ok) {
      await recordOpsError(supabaseAdmin, 'match', matchId, operation, await discordErrorDetail('Webhook edit', res));
      return false;
    }
    await clearOpsError(supabaseAdmin, 'match', matchId, operation);
    return true;
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'match', matchId, operation, `Webhook edit failed: ${(e as Error).message}`);
    return false;
  }
}

/** The message a notification for this match should edit in place, if one's on record yet — reads
 *  `match_discord_state` the same way `rememberNotificationMessage()` below writes it. Never throws
 *  (a transient Supabase failure is treated as "nothing to edit yet", same as a genuinely empty row) —
 *  every exported notify function here relies on that to keep its own no-throw guarantee. */
async function getStoredMessageId(supabaseAdmin: SupabaseClient, matchId: number): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from('match_discord_state')
      .select('notification_message_id')
      .eq('match_id', matchId)
      .maybeSingle();
    return (data as { notification_message_id: string | null } | null)?.notification_message_id ?? null;
  } catch {
    return null;
  }
}

/** Stores the message a later notification for this match should edit in place, keyed the same way
 *  `discord-threads.ts` keys `match_discord_state.thread_id`. Never throws — a failed write here just
 *  means the next notification for this match won't find an id to edit and posts a fresh message
 *  instead of updating in place, which is a worse UX but not a reason to break the caller's own
 *  no-throw guarantee. */
async function rememberNotificationMessage(supabaseAdmin: SupabaseClient, matchId: number, messageId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('match_discord_state')
      .upsert({ match_id: matchId, notification_message_id: messageId }, { onConflict: 'match_id' });
  } catch (e) {
    console.error(`rememberNotificationMessage(${matchId}) failed (non-fatal):`, e);
  }
}

/** Posted once a match's server transitions to `live` (provisionMatchServer()). Connect info is
 *  deliberately never included — it's per-player, not something to broadcast to a channel. */
export async function notifyMatchServerLive(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const meta = await getMatchMeta(matchId).catch(() => null);
  if (!meta) return;
  const { content, embed } = buildMatchMessage(matchId, meta, { statusLine: '🟢 **Server is live**', color: COLOR_SERVER_LIVE });
  const messageId = await postNewEmbed(supabaseAdmin, matchId, OPERATION_SERVER_LIVE, webhookUrl, content, embed);
  if (messageId) await rememberNotificationMessage(supabaseAdmin, matchId, messageId);
}

/** Posted on every `going_live`/`round_end` MatchZy event — edits the notification message in place
 *  with the running score, mirroring what `MatchScoreHero`/`LiveMatchTicker` already show from the
 *  same `live_match_score` row. `event` and `liveScore` come from the caller's own
 *  `putLiveScoreEvent()` call rather than being re-read here: `event` because `map_result` also
 *  writes a `live_match_score` row but shouldn't trigger this (its score gets superseded moments
 *  later by `notifyMatchScoreReported()` once the score route confirms the result — editing here too
 *  would just flicker), and `liveScore` to avoid a redundant read of the row the caller just wrote.
 *  No-ops (silently — there's nothing to fix by posting a fresh message mid-match) for any other
 *  event, for a `null` row, if `notifyMatchServerLive()` never left a message on record, or if the
 *  match already has a final score on record — a delayed/retried `round_end` delivery arriving after
 *  `notifyMatchScoreReported()` has already edited the message to its final box score must not
 *  regress it back to "LIVE", the same race `map_result` is guarded against above. */
export async function notifyMatchLiveScore(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  event: string,
  liveScore: LiveScoreRow | null,
): Promise<void> {
  if (event !== 'going_live' && event !== 'round_end') return;
  if (!liveScore) return;
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const existingMessageId = await getStoredMessageId(supabaseAdmin, matchId);
  if (!existingMessageId) return;

  const meta = await getMatchMeta(matchId).catch(() => null);
  if (!meta) return;
  if (meta.score) return; // Already scored — a late round_end must not overwrite the final result.

  const roundLabel = liveScore.round != null ? ` · Round ${liveScore.round}` : '';
  const { content, embed } = buildMatchMessage(matchId, meta, {
    statusLine: `🔴 **LIVE**\n**${liveScore.shirts}-${liveScore.skins}**${roundLabel}`,
    color: COLOR_LIVE_SCORE,
  });
  await editEmbed(supabaseAdmin, matchId, OPERATION_LIVE_SCORE, webhookUrl, existingMessageId, content, embed);
}

/** Posted (or, once one exists, edited in place) every time a match's score is written —
 *  `writeMatchScore()` (`matchScore.ts`) calls this unconditionally, including an admin's later
 *  correction, so the message stays in sync with whatever `matches.final_score`/box score actually
 *  are rather than going stale after a fix. Editing in place means a correction that changes nothing
 *  just re-writes the same content, not a duplicate post. `meta.score` is only populated for a
 *  genuinely played match (gated on `isPlayedScore()` inside `getMatchMeta()`), which also excludes
 *  S3's pre-staged `"0-0"` rows — see the glossary on why `null` alone was never a sufficient played
 *  check; a call on a not-yet-played match is a no-op below rather than posting a premature result.
 *  Never throws — `writeMatchScore()` relies on that to call it unguarded inside its own `Promise.all`. */
export async function notifyMatchScoreReported(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const [meta, boxScore, existingMessageId] = await Promise.all([
    getMatchMeta(matchId).catch(() => null),
    getMatchBoxScore(matchId).catch(() => null),
    getStoredMessageId(supabaseAdmin, matchId),
  ]);
  if (!meta || !meta.score) return;

  const { content, embed } = buildMatchMessage(matchId, meta, {
    statusLine: `🏁 **Match complete**\n**Final: ${meta.score.shirts}-${meta.score.skins}**`,
    color: COLOR_SCORE,
    boxScore: boxScore ?? undefined,
  });

  if (existingMessageId && await editEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, existingMessageId, content, embed)) {
    return;
  }
  const messageId = await postNewEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, content, embed);
  if (messageId) await rememberNotificationMessage(supabaseAdmin, matchId, messageId);
}

/** Posted by `POST /api/cron/match-reminder`, itself fired once by a one-shot Postgres pg_cron job
 *  `schedule_match_reminder()` schedules for `scheduled_at - 1h` whenever a match is (re)scheduled.
 *  `scheduled_at` is re-read here rather than trusted from the job's queue-time snapshot — a
 *  reschedule/unschedule between queueing and firing must not post a stale reminder, which is also
 *  why this checks a window around "now" rather than assuming the job fired exactly on time.
 *
 *  Claims `match_discord_state.reminder_sent_at` atomically (an `UPDATE ... WHERE reminder_sent_at
 *  IS NULL`) before posting, not after — two racing calls for the same match must never both post,
 *  which matters more here than the alternative failure mode it accepts: a webhook failure at the
 *  exact moment of the claim leaves the reminder marked sent with nothing actually posted, and
 *  nothing retries it, since the pg_cron job that triggered this is already consumed. That failure
 *  is still recorded to ops_errors like any other, just without a second attempt — this notification
 *  kind is inherently single-shot, unlike `notifyMatchLiveScore()`, which gets another try next
 *  round. */
export async function notifyMatchReminder(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  // A single getMatchMeta() read covers everything below (scheduledAtRaw, score) — no separate
  // matches pre-check, since the eligibility window rarely excludes anything in practice (the
  // pg_cron job that calls this already computed the right fire time; only a reschedule in the gap
  // makes it miss) and a pre-check would just add a redundant round trip to the common case.
  const meta = await getMatchMeta(matchId).catch(() => null);
  if (!meta) return;
  if (!meta.scheduledAtRaw) return; // Unscheduled since the job was queued.
  if (meta.score) return; // Already played.

  const msUntilMatch = new Date(meta.scheduledAtRaw).getTime() - Date.now();
  if (msUntilMatch <= 0 || msUntilMatch > REMINDER_WINDOW_MS) return; // Rescheduled away from this job's target time.

  // schedule_match_reminder() always upserts a match_discord_state row before this ever fires, but
  // this doesn't rely on that invariant holding across the DB/app boundary — ON CONFLICT DO NOTHING
  // first guarantees a row to claim, without ever clobbering an already-set reminder_sent_at.
  await supabaseAdmin
    .from('match_discord_state')
    .upsert({ match_id: matchId, reminder_sent_at: null }, { onConflict: 'match_id', ignoreDuplicates: true });

  const { data: claimed } = await supabaseAdmin
    .from('match_discord_state')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .is('reminder_sent_at', null)
    .select('match_id');
  if (!claimed || claimed.length === 0) return; // Already sent, or lost the race to a concurrent call.

  const { content, embed } = buildMatchMessage(matchId, meta, {
    statusLine: `⏰ **Starting in ${formatDuration(msUntilMatch)}**${meta.scheduledAt ? `\n${meta.scheduledAt}` : ''}`,
    color: COLOR_REMINDER,
  });
  await postNewEmbed(supabaseAdmin, matchId, OPERATION_REMINDER, webhookUrl, content, embed);
}
