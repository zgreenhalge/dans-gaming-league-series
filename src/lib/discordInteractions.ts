// Discord Interactions HTTP endpoint support (#396) — signature verification and the minimal
// response-shape helpers the slash commands need. Deliberately not a dependency on
// discord-api-types/discord.js: this project only ever builds PING/PONG and a plain text message
// response, so a few inline types cover it without pulling in either package's full surface.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

let cachedKey: { hex: string; key: KeyObject } | null = null;

function publicKeyFromHex(hex: string): KeyObject {
  if (cachedKey?.hex === hex) return cachedKey.key;
  const raw = Buffer.from(hex, 'hex');
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  });
  cachedKey = { hex, key };
  return key;
}

/** Verifies a Discord Interactions request's Ed25519 signature over `timestamp + rawBody`, per
 *  Discord's required verification scheme (see the developer docs' "Security and Authorization").
 *  `rawBody` must be the exact bytes Discord sent — a re-serialized `JSON.stringify()` of the
 *  parsed body will not reproduce the same signature. */
export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const key = publicKeyFromHex(publicKeyHex);
    const signature = Buffer.from(signatureHex, 'hex');
    const message = Buffer.from(timestamp + rawBody);
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

export const INTERACTION_TYPE_PING = 1;
export const INTERACTION_TYPE_APPLICATION_COMMAND = 2;

const RESPONSE_TYPE_PONG = 1;
const RESPONSE_TYPE_CHANNEL_MESSAGE = 4;
const EPHEMERAL_FLAG = 1 << 6;

export interface DiscordInteractionOption {
  name: string;
  value: string | number;
}

export interface DiscordInteraction {
  type: number;
  data?: { name: string; options?: DiscordInteractionOption[] };
  member?: { user?: { id: string } };
  user?: { id: string };
}

export function pongResponse() {
  return { type: RESPONSE_TYPE_PONG };
}

/** A plain-text command reply. Public (visible to the whole channel) by default — these are
 *  league-wide lookups anyone in the channel benefits from seeing; pass `true` for one that's
 *  personal to the caller instead. */
export function messageResponse(content: string, ephemeral = false) {
  return {
    type: RESPONSE_TYPE_CHANNEL_MESSAGE,
    data: { content, flags: ephemeral ? EPHEMERAL_FLAG : undefined },
  };
}

export function optionValue(
  interaction: DiscordInteraction,
  name: string,
): string | number | undefined {
  return interaction.data?.options?.find((o) => o.name === name)?.value;
}

/** The caller's Discord user id — `member.user.id` in a guild context, `user.id` in a DM. */
export function callerDiscordId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}
