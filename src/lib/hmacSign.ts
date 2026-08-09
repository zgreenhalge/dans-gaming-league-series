import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC-SHA256 signature over `payload`, keyed by NEXTAUTH_SECRET. Shared by every short-lived
 * signed-token flow (Steam login handoff, player claim links) so the signing step can't drift
 * independently between them.
 */
export function hmacSign(payload: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verifies `signature` against a freshly computed one, in constant time — a plain `!==` compares
 * hex digests character-by-character and can leak the true signature through response timing.
 */
export function hmacVerify(payload: string, signature: string): boolean {
  const expected = Buffer.from(hmacSign(payload), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
