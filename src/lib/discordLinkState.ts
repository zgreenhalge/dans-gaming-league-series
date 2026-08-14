import { hmacSign, hmacVerify } from "./hmacSign";

// Signed state param for the Discord account-linking OAuth2 flow (#394): proves the callback's
// code exchange writes discord_id onto the same player who actually initiated the link, since
// Discord hands our own `state` value back unmodified but doesn't itself vouch for who it belongs
// to. Same signed-token shape as playerClaim.ts, scoped to this flow's own short TTL.
const LINK_STATE_TTL_MS = 10 * 60 * 1000;

export function signDiscordLinkState(playerId: number): string {
  const expires = Date.now() + LINK_STATE_TTL_MS;
  const sig = hmacSign(`${playerId}:${expires}`);
  return Buffer.from(JSON.stringify({ playerId, expires, sig })).toString("base64url");
}

export function verifyDiscordLinkState(state: string): { playerId: number } | null {
  try {
    const { playerId, expires, sig } = JSON.parse(Buffer.from(state, "base64url").toString());
    if (typeof playerId !== "number" || typeof expires !== "number" || Date.now() > expires) return null;
    if (!hmacVerify(`${playerId}:${expires}`, sig)) return null;
    return { playerId };
  } catch {
    return null;
  }
}
