// Best-effort Discord webhook notifications for #match-notifications (#395). Every export here is
// safe to call unconditionally — a missing DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL or a webhook
// failure never throws, matching the rest of this codebase's best-effort hooks (ops-errors.ts, the
// score route's post-commit hooks via afterBestEffort()). A real failure (the webhook itself
// erroring, not just being unconfigured) is recorded to ops_errors — entity 'match', operation
// 'discord_notify_server_live'/'discord_notify_score' — so it's visible in the admin console's
// Activity feed instead of only a Vercel function log nobody's tailing; cleared automatically the
// next notification of that same kind that succeeds. The two notifications use distinct operation
// keys (not a shared 'discord_notify') so a live-notification failure and a score-notification
// failure for the same match can't clear each other out — see ops-errors.ts's own docstring on why
// `operation` is part of the key.
//
// Both notifications are built from `getMatchMeta()` (seo/og.ts) — the same data the site's own
// link-preview OG card and meta description use when a match URL is unfurled — rather than
// re-deriving the title/roster/score/map/box-score here. `cache()`-wrapped functions like it are
// already called from route handlers elsewhere in this codebase (session.ts's `requireSession()`);
// outside a React Server Component render `cache()` just degrades to a plain call, no memoization,
// no error.
//
// One message is the source of truth per match: `notifyMatchServerLive()` posts with `?wait=true`
// (the only way a webhook POST returns the created message's id) and stores it in
// `match_discord_state.notification_message_id`, the same per-match Discord state table
// `discord-threads.ts` already keys its `thread_id` off of. `notifyMatchScoreReported()` then edits
// that message in place via Discord's webhook-message PATCH endpoint instead of posting a second
// one. If there's no stored message id — notifications were off when the server went live, that
// call failed, or the message was deleted out from under the bot — it falls back to posting a new
// message so the score still gets announced.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMatchMeta } from './seo/og';
import type { MatchBoxScorePlayer } from './queries/match';
import { recordOpsError, clearOpsError } from './ops-errors';
import { SITE_URL } from './seo/site';

const COLOR_LIVE = 0x57f287; // Discord's "green"
const COLOR_SCORE = 0x5865f2; // Discord's "blurple"
const OPERATION_SERVER_LIVE = 'discord_notify_server_live';
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
  seasonName: string;
  weekMatchLabel: string;
  statusLine: string;
  shirtNames: string;
  skinNames: string;
  map?: string | null;
  color: number;
  matchUrl: string;
  thumbnailUrl?: string | null;
  boxScore?: { shirts: MatchBoxScorePlayer[]; skins: MatchBoxScorePlayer[] };
}

/** Renders a team's box score as a fixed-width `Player  K/A/D  ADR` table inside a code block —
 *  embed field values render in Discord's default (non-monospace) font otherwise, so alignment needs
 *  the fence. Column widths are computed from this team's own rows, not shared across both fields,
 *  since the two are independent inline fields with no visual alignment between them. */
function boxScoreBlock(players: MatchBoxScorePlayer[]): string {
  const rows = players.map((p) => ({ name: p.name, kad: `${p.kills}/${p.assists}/${p.deaths}`, adr: String(p.adr) }));
  const nameWidth = Math.max('Player'.length, ...rows.map((r) => r.name.length));
  const kadWidth = Math.max('K/A/D'.length, ...rows.map((r) => r.kad.length));
  const adrWidth = Math.max('ADR'.length, ...rows.map((r) => r.adr.length));
  const line = (name: string, kad: string, adr: string) =>
    `${name.padEnd(nameWidth)}  ${kad.padStart(kadWidth)}  ${adr.padStart(adrWidth)}`;
  return ['```', line('Player', 'K/A/D', 'ADR'), ...rows.map((r) => line(r.name, r.kad, r.adr)), '```'].join('\n');
}

/** Shared embed layout for both notification kinds. The season name is the embed's `author` line
 *  (Discord's small "eyebrow" text above the title — the same role it plays for real sports/esports
 *  score bots), the title is just "Week N · Match M" (short enough to never wrap oddly, and doubles
 *  as a clickable link to the match page via `url`), and the description carries the (bold, single-
 *  line) status, the roster + map, and an explicit link line for clients that don't make a bolded
 *  embed title read as clickable at a glance. A post-match box score, when given, becomes two inline
 *  fields so Shirts/Skins sit side by side. */
function buildMatchEmbed(parts: MatchEmbedParts): Embed {
  const roster = `${parts.shirtNames} vs ${parts.skinNames}${parts.map ? ` on ${parts.map}` : ''}`;
  const embed: Embed = {
    title: parts.weekMatchLabel,
    description: `${parts.statusLine}\n\n${roster}\n${parts.matchUrl}`,
    color: parts.color,
    url: parts.matchUrl,
    author: { name: parts.seasonName },
  };
  if (parts.thumbnailUrl) embed.thumbnail = { url: parts.thumbnailUrl };
  if (parts.boxScore) {
    const fields: EmbedField[] = [];
    if (parts.boxScore.shirts.length > 0) fields.push({ name: '🎽 Shirts', value: boxScoreBlock(parts.boxScore.shirts), inline: true });
    if (parts.boxScore.skins.length > 0) fields.push({ name: '💀 Skins', value: boxScoreBlock(parts.boxScore.skins), inline: true });
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
  embed: Embed,
): Promise<string | null> {
  try {
    const res = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
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
  embed: Embed,
): Promise<boolean> {
  try {
    const res = await fetch(`${webhookUrl}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
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
    seasonName: meta.seasonName,
    weekMatchLabel: meta.weekMatchLabel,
    statusLine: '🟢 **Server is live**',
    shirtNames: meta.shirtNames,
    skinNames: meta.skinNames,
    map: meta.mapName,
    color: COLOR_LIVE,
    matchUrl: `${SITE_URL}/matches/${matchId}`,
    thumbnailUrl: meta.image ? `${SITE_URL}${meta.image}` : null,
  });
  const messageId = await postNewEmbed(supabaseAdmin, matchId, OPERATION_SERVER_LIVE, webhookUrl, embed);
  if (messageId) await rememberNotificationMessage(supabaseAdmin, matchId, messageId);
}

/** Posted once a match's final score is committed (`PATCH /api/matches/[id]/score`). Callers should
 *  only invoke this on the transition into "played" — an admin correcting an already-played score
 *  should not re-fire it. `meta.score` is only populated for a genuinely played match (gated on
 *  `isPlayedScore()` inside `getMatchMeta()`), which also excludes S3's pre-staged `"0-0"` rows —
 *  see the glossary on why `null` alone was never a sufficient played check. */
export async function notifyMatchScoreReported(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const [meta, { data: discordState }] = await Promise.all([
    getMatchMeta(matchId).catch(() => null),
    supabaseAdmin.from('match_discord_state').select('notification_message_id').eq('match_id', matchId).maybeSingle(),
  ]);
  if (!meta || !meta.score) return;

  const embed = buildMatchEmbed({
    seasonName: meta.seasonName,
    weekMatchLabel: meta.weekMatchLabel,
    statusLine: `🏁 **Match complete**\n**Final: ${meta.score.shirts}-${meta.score.skins}**`,
    shirtNames: meta.shirtNames,
    skinNames: meta.skinNames,
    map: meta.mapName,
    color: COLOR_SCORE,
    matchUrl: `${SITE_URL}/matches/${matchId}`,
    thumbnailUrl: meta.image ? `${SITE_URL}${meta.image}` : null,
    boxScore: { shirts: meta.shirtsBox, skins: meta.skinsBox },
  });

  const existingMessageId = (discordState as { notification_message_id: string | null } | null)?.notification_message_id;
  if (existingMessageId && await editEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, existingMessageId, embed)) {
    return;
  }
  const messageId = await postNewEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, embed);
  if (messageId) await rememberNotificationMessage(supabaseAdmin, matchId, messageId);
}
