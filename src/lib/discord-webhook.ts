// The Discord incoming-webhook primitives every best-effort notifier shares (`discord-notify.ts` for
// matches, `discord-scrim-notify.ts` for scrim nights): post an embed message and get its id back,
// edit it in place, delete it, and tag a player. Each call reports its outcome as a value instead of
// throwing, so a notifier decides where a failure is recorded. Only the webhook URL and the message
// content differ between notifiers; the HTTP shapes live here once.

import { discordErrorDetail } from './discord-threads';

/** The webhook URL the match and scrim notifiers post to, or `undefined` when unset (every notifier
 *  then no-ops). */
export function matchNotificationsWebhookUrl(): string | undefined {
  return process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL || undefined;
}

/** How far from its target time a reminder may fire and still post. A pg_cron job fires ~1h before
 *  the start by construction; this tolerates clock skew and pg_net delivery lag while still catching a
 *  reminder whose target has moved away. */
export const REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;

export type EmbedField = { name: string; value: string; inline?: boolean };
export type Embed = {
  title: string;
  description: string;
  color: number;
  url: string;
  author: { name: string };
  thumbnail?: { url: string };
  fields?: EmbedField[];
};

/** The outcome of a webhook call: `error` is a ready-to-record message. */
export type WebhookResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** A player's name-color role mention (`<@&roleId>`) when they have one, else their plain name
 *  bolded — the same "tag if linked, else plain name" fallback `discord-threads.ts`'s `openingPost()`
 *  uses for user mentions. Only usable in a webhook message's `content`: Discord does not render
 *  mentions typed inside an embed (title, description, or field values) as tags at all — they show as
 *  literal `<@&...>` text there. */
export function playerTag(player: { name: string; discordNameRoleId: string | null }): string {
  return player.discordNameRoleId ? `<@&${player.discordNameRoleId}>` : `**${player.name}**`;
}

/** Posts a new message and returns its id (via `?wait=true`, the only way a webhook POST returns
 *  one) so a later call can edit it in place. `id` is `null` when Discord's response didn't parse. With
 *  no `embed`, the message is its `content` alone, and a link in it unfurls into Discord's own preview. */
export async function postWebhookEmbed(
  webhookUrl: string,
  content: string,
  embed: Embed | null,
): Promise<WebhookResult<{ id: string | null }>> {
  try {
    const res = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds: embed ? [embed] : [] }),
    });
    if (!res.ok) return { ok: false, error: await discordErrorDetail('Webhook post', res) };
    const posted = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: posted?.id ?? null };
  } catch (e) {
    return { ok: false, error: `Webhook post failed: ${(e as Error).message}` };
  }
}

/** Edits a previously-posted webhook message in place. A caller should fall back to
 *  `postWebhookEmbed()` on a failure (the message may have been deleted). */
export async function editWebhookEmbed(
  webhookUrl: string,
  messageId: string,
  content: string,
  embed: Embed,
): Promise<WebhookResult> {
  try {
    const res = await fetch(`${webhookUrl}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds: [embed] }),
    });
    if (!res.ok) return { ok: false, error: await discordErrorDetail('Webhook edit', res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Webhook edit failed: ${(e as Error).message}` };
  }
}

/** Deletes a previously-posted webhook message. A message that is already gone (404) counts as
 *  deleted. */
export async function deleteWebhookMessage(webhookUrl: string, messageId: string): Promise<WebhookResult> {
  try {
    const res = await fetch(`${webhookUrl}/messages/${messageId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) return { ok: false, error: await discordErrorDetail('Webhook delete', res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Webhook delete failed: ${(e as Error).message}` };
  }
}
