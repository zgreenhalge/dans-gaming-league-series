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

/** Shared embed layout for both notification kinds — season on its own title line, week/match on
 *  the next, then the status line, the roster, and an explicit link line (in addition to the title
 *  itself being a clickable link via `url`). */
function buildMatchEmbed(parts: MatchEmbedParts): { title: string; description: string; color: number; url: string } {
  const roster = `${parts.shirtNames} vs ${parts.skinNames}${parts.map ? ` on ${parts.map}` : ''}`;
  return {
    title: `${parts.seasonName}\n${parts.weekMatchLabel}`,
    description: `${parts.statusLine}\n\n${roster}\n${parts.matchUrl}`,
    color: parts.color,
    url: parts.matchUrl,
  };
}

async function postEmbed(
  supabaseAdmin: SupabaseClient,
  matchId: number,
  operation: string,
  webhookUrl: string,
  embed: { title: string; description?: string; color: number; url: string },
): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      await recordOpsError(supabaseAdmin, 'match', matchId, operation, `Webhook returned ${res.status}`);
      return;
    }
    await clearOpsError(supabaseAdmin, 'match', matchId, operation);
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'match', matchId, operation, `Webhook post failed: ${(e as Error).message}`);
  }
}

/** Posted once a match's server transitions to `live` (provisionMatchServer()). Connect info is
 *  deliberately never included — it's per-player, not something to broadcast to a channel. */
export async function notifyMatchServerLive(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const teamNames = await getMatchTeamNames(matchId).catch(() => null);
  if (!teamNames) return;
  await postEmbed(supabaseAdmin, matchId, OPERATION_SERVER_LIVE, webhookUrl, buildMatchEmbed({
    seasonName: teamNames.seasonName,
    weekMatchLabel: teamNames.weekMatchLabel,
    statusLine: '🟢 Server is live',
    shirtNames: teamNames.shirtNames,
    skinNames: teamNames.skinNames,
    color: COLOR_LIVE,
    matchUrl: `${SITE_URL}/matches/${matchId}`,
  }));
}

/** Posted once a match's final score is committed (`PATCH /api/matches/[id]/score`). Callers should
 *  only invoke this on the transition into "played" — an admin correcting an already-played score
 *  should not re-fire it. */
export async function notifyMatchScoreReported(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
  if (!webhookUrl) return; // Not configured — skip before doing any DB work.

  const [teamNames, { data: match }] = await Promise.all([
    getMatchTeamNames(matchId).catch(() => null),
    supabase.from('matches').select('final_score, picked_map, shirts_pick').eq('id', matchId).maybeSingle(),
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
  await postEmbed(supabaseAdmin, matchId, OPERATION_SCORE, webhookUrl, buildMatchEmbed({
    seasonName: teamNames.seasonName,
    weekMatchLabel: teamNames.weekMatchLabel,
    statusLine: `🏁 Match complete\nFinal Score: ${finalScore}`,
    shirtNames: teamNames.shirtNames,
    skinNames: teamNames.skinNames,
    map,
    color: COLOR_SCORE,
    matchUrl: `${SITE_URL}/matches/${matchId}`,
  }));
}
