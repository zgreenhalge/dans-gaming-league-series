// Best-effort Discord webhook notifications for #match-notifications (#395). Every export here is
// safe to call unconditionally — a missing DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL or a webhook
// failure never throws, matching the rest of this codebase's best-effort hooks (ops-errors.ts, the
// score route's post-commit hooks via afterBestEffort()). A real failure (the webhook itself
// erroring, not just being unconfigured) is recorded to ops_errors — entity 'match', operation
// 'discord_notify_server_live'/'discord_notify_live_score'/'discord_notify_score' — so it's visible
// in the admin console's Activity feed instead of only a Vercel function log nobody's tailing;
// cleared automatically the next notification of that same kind that succeeds. The three
// notifications use distinct operation keys (not a shared 'discord_notify') so one kind's failure
// can't clear another's still-live one — see ops-errors.ts's own docstring on why `operation` is
// part of the key.
//
// All three are built from `getMatchMeta()` (seo/og.ts) — the same data the site's own link-preview
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMatchMeta } from './seo/og';
import { getMatchBoxScore, type MatchBoxScorePlayer, type MatchDiscordPlayer } from './queries/match';
import type { LiveScoreRow } from './demo/liveScore';
import { recordOpsError, clearOpsError } from './ops-errors';
import { SITE_URL } from './seo/site';

const COLOR_SERVER_LIVE = 0x57f287; // Discord's "green" — server provisioned, nothing played yet
const COLOR_LIVE_SCORE = 0xed4245; // Discord's "red" — a round is actually in progress
const COLOR_SCORE = 0x5865f2; // Discord's "blurple" — final result
const OPERATION_SERVER_LIVE = 'discord_notify_server_live';
const OPERATION_LIVE_SCORE = 'discord_notify_live_score';
const OPERATION_SCORE = 'discord_notify_score';

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
  shirtPlayers: MatchDiscordPlayer[];
  skinPlayers: MatchDiscordPlayer[];
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

/** Renders a team's box score as one line per player — bolded name, then K/A/D and ADR. Plain names
 *  only: embed field values don't render mentions as tags (see `playerTag()`), so there's no role-tag
 *  path here — the roster line in `content` (`buildMatchContent()`) is where players get tagged. */
function boxScoreLines(players: MatchBoxScorePlayer[]): string {
  return players.map((p) => `**${p.name}** — ${p.kills}/${p.assists}/${p.deaths} K/A/D · ${p.adr} ADR`).join('\n');
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
    if (parts.boxScore.shirts.length > 0) fields.push({ name: 'Shirts', value: boxScoreLines(parts.boxScore.shirts) });
    if (parts.boxScore.skins.length > 0) fields.push({ name: 'Skins', value: boxScoreLines(parts.boxScore.skins) });
    if (fields.length > 0) embed.fields = fields;
  }
  return embed;
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
      await recordOpsError(supabaseAdmin, 'match', matchId, operation, `Webhook post returned ${res.status}`);
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
      await recordOpsError(supabaseAdmin, 'match', matchId, operation, `Webhook edit returned ${res.status}`);
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
 *  `match_discord_state` the same way `rememberNotificationMessage()` below writes it. */
async function getStoredMessageId(supabaseAdmin: SupabaseClient, matchId: number): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('match_discord_state')
    .select('notification_message_id')
    .eq('match_id', matchId)
    .maybeSingle();
  return (data as { notification_message_id: string | null } | null)?.notification_message_id ?? null;
}

/** Stores the message a later notification for this match should edit in place, keyed the same way
 *  `discord-threads.ts` keys `match_discord_state.thread_id`. */
async function rememberNotificationMessage(supabaseAdmin: SupabaseClient, matchId: number, messageId: string): Promise<void> {
  await supabaseAdmin
    .from('match_discord_state')
    .upsert({ match_id: matchId, notification_message_id: messageId }, { onConflict: 'match_id' });
}

/** Posted once a match's server transitions to `live` (provisionMatchServer()). Connect info is
 *  deliberately never included — it's per-player, not something to broadcast to a channel. */
export async function notifyMatchServerLive(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const meta = await getMatchMeta(matchId).catch(() => null);
  if (!meta) return;
  const embed = buildMatchEmbed({
    matchId,
    seasonName: meta.seasonName,
    weekMatchLabel: meta.weekMatchLabel,
    statusLine: '🟢 **Server is live**',
    shirtPlayers: meta.shirtPlayers,
    skinPlayers: meta.skinPlayers,
    map: meta.mapName,
    color: COLOR_SERVER_LIVE,
    image: meta.image,
  });
  const content = buildMatchContent(meta.shirtPlayers, meta.skinPlayers);
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
 *  event, for a `null` row, or if `notifyMatchServerLive()` never left a message on record. */
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

  const roundLabel = liveScore.round != null ? ` · Round ${liveScore.round}` : '';
  const embed = buildMatchEmbed({
    matchId,
    seasonName: meta.seasonName,
    weekMatchLabel: meta.weekMatchLabel,
    statusLine: `🔴 **LIVE**\n**${liveScore.shirts}-${liveScore.skins}**${roundLabel}`,
    shirtPlayers: meta.shirtPlayers,
    skinPlayers: meta.skinPlayers,
    map: meta.mapName,
    color: COLOR_LIVE_SCORE,
    image: meta.image,
  });
  const content = buildMatchContent(meta.shirtPlayers, meta.skinPlayers);
  await editEmbed(supabaseAdmin, matchId, OPERATION_LIVE_SCORE, webhookUrl, existingMessageId, content, embed);
}

/** Posted once a match's final score is committed (`PATCH /api/matches/[id]/score`). Callers should
 *  only invoke this on the transition into "played" — an admin correcting an already-played score
 *  should not re-fire it. `meta.score` is only populated for a genuinely played match (gated on
 *  `isPlayedScore()` inside `getMatchMeta()`), which also excludes S3's pre-staged `"0-0"` rows —
 *  see the glossary on why `null` alone was never a sufficient played check. */
export async function notifyMatchScoreReported(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const [meta, boxScore, existingMessageId] = await Promise.all([
    getMatchMeta(matchId).catch(() => null),
    getMatchBoxScore(matchId).catch(() => null),
    getStoredMessageId(supabaseAdmin, matchId),
  ]);
  if (!meta || !meta.score) return;

  const embed = buildMatchEmbed({
    matchId,
    seasonName: meta.seasonName,
    weekMatchLabel: meta.weekMatchLabel,
    statusLine: `🏁 **Match complete**\n**Final: ${meta.score.shirts}-${meta.score.skins}**`,
    shirtPlayers: meta.shirtPlayers,
    skinPlayers: meta.skinPlayers,
    map: meta.mapName,
    color: COLOR_SCORE,
    image: meta.image,
    boxScore: boxScore ?? undefined,
  });
  const content = buildMatchContent(meta.shirtPlayers, meta.skinPlayers);

  if (existingMessageId && await editEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, existingMessageId, content, embed)) {
    return;
  }
  const messageId = await postNewEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, content, embed);
  if (messageId) await rememberNotificationMessage(supabaseAdmin, matchId, messageId);
}
