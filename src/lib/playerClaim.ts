import { hmacSign, hmacVerify } from "./hmacSign";

// Admin-issued claim links (#322): proves the caller was actually handed this specific unclaimed
// player row (by an admin, out of band), rather than letting any authenticated-but-unlinked visitor
// self-declare "I'm <any unclaimed name>" from an open list. `name` rides along in the token so the
// client can show a confirmation UI without a second round trip — it's plain, unsigned-for-reading
// base64url, so only display it, never trust it; `playerId` is what the signature protects.
const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signPlayerClaim(playerId: number, name: string): string {
  const expires = Date.now() + CLAIM_TTL_MS;
  const sig = hmacSign(`${playerId}:${expires}`);
  return Buffer.from(JSON.stringify({ playerId, name, expires, sig })).toString("base64url");
}

export function verifyPlayerClaim(token: string): { playerId: number; name: string } | null {
  try {
    const { playerId, name, expires, sig } = JSON.parse(Buffer.from(token, "base64url").toString());
    if (typeof playerId !== "number" || typeof expires !== "number" || Date.now() > expires) return null;
    if (!hmacVerify(`${playerId}:${expires}`, sig)) return null;
    return { playerId, name };
  } catch {
    return null;
  }
}
