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
// One message is the source of truth per match: `notifyMatchServerLive()` posts with `?wait=true`
// (the only way a webhook POST returns the created message's id) and stores it in
// `match_discord_state.notification_message_id`, the same per-match Discord state table
// `discord-threads.ts` already keys its `thread_id` off of. `notifyMatchScoreReported()` then edits
// that message in place via Discord's webhook-message PATCH endpoint instead of posting a second
// one. If there's no stored message id — notifications were off when the server went live, that
// call failed, or the message was deleted out from under the bot — it falls back to posting a new
// message so the score still gets announced.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getMatchTeamNames } from './queries/match';
import { recordOpsError, clearOpsError } from './ops-errors';
import { SITE_URL } from './seo/site';

const COLOR_LIVE = 0x57f287; // Discord's "green"
const COLOR_SCORE = 0x5865f2; // Discord's "blurple"
const OPERATION_SERVER_LIVE = 'discord_notify_server_live';
const OPERATION_SCORE = 'discord_notify_score';

interface MatchEmbedParts {
  seasonName: string;
  weekMatchLabel: string;
  statusLine: string;
  shirtNames: string;
  skinNames: string;
  map?: string | null;
  color: number;
  matchUrl: string;
}

/** Shared embed layout for both notification kinds. Discord embed titles are a single-line field —
 *  they don't reliably render `\n` — so the status is the (single-line) title, and the multi-line
 *  season/week, roster, and link go in the description, which does support line breaks. The title
 *  doubles as a clickable link to the match page via `url`. */
function buildMatchEmbed(parts: MatchEmbedParts): { title: string; description: string; color: number; url: string } {
  const roster = `${parts.shirtNames} vs ${parts.skinNames}${parts.map ? ` on ${parts.map}` : ''}`;
  return {
    title: parts.statusLine,
    description: `${parts.seasonName}\n${parts.weekMatchLabel}\n\n${roster}\n${parts.matchUrl}`,
    color: parts.color,
    url: parts.matchUrl,
  };
}

type Embed = { title: string; description: string; color: number; url: string };

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

  const teamNames = await getMatchTeamNames(matchId).catch(() => null);
  if (!teamNames) return;
  const embed = buildMatchEmbed({
    seasonName: teamNames.seasonName,
    weekMatchLabel: teamNames.weekMatchLabel,
    statusLine: '🟢 Server is live',
    shirtNames: teamNames.shirtNames,
    skinNames: teamNames.skinNames,
    color: COLOR_LIVE,
    matchUrl: `${SITE_URL}/matches/${matchId}`,
  });
  const messageId = await postNewEmbed(supabaseAdmin, matchId, OPERATION_SERVER_LIVE, webhookUrl, embed);
  if (messageId) await rememberNotificationMessage(supabaseAdmin, matchId, messageId);
}

/** Posted once a match's final score is committed (`PATCH /api/matches/[id]/score`). Callers should
 *  only invoke this on the transition into "played" — an admin correcting an already-played score
 *  should not re-fire it. */
export async function notifyMatchScoreReported(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const [teamNames, { data: match }, { data: discordState }] = await Promise.all([
    getMatchTeamNames(matchId).catch(() => null),
    supabase.from('matches').select('final_score, picked_map, shirts_pick').eq('id', matchId).maybeSingle(),
    supabaseAdmin.from('match_discord_state').select('notification_message_id').eq('match_id', matchId).maybeSingle(),
  ]);
  if (!teamNames || !match) return;
  const { final_score: finalScore, picked_map: pickedMap, shirts_pick: shirtsPick } = match as {
    final_score: string | null;
    picked_map: string | null;
    shirts_pick: string | null;
  };
  if (!finalScore) return;
  // Effective played map (glossary): shirts_pick when shirts made the pick, picked_map otherwise —
  // only one is ever populated per match.
  const map = shirtsPick ?? pickedMap;
  const embed = buildMatchEmbed({
    seasonName: teamNames.seasonName,
    weekMatchLabel: teamNames.weekMatchLabel,
    statusLine: `🏁 Match complete — Final: ${finalScore}`,
    shirtNames: teamNames.shirtNames,
    skinNames: teamNames.skinNames,
    map,
    color: COLOR_SCORE,
    matchUrl: `${SITE_URL}/matches/${matchId}`,
  });

  const existingMessageId = (discordState as { notification_message_id: string | null } | null)?.notification_message_id;
  if (existingMessageId && await editEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, existingMessageId, embed)) {
    return;
  }
  const messageId = await postNewEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, embed);
  if (messageId) await rememberNotificationMessage(supabaseAdmin, matchId, messageId);
}
