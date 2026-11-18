/**
 * Shared setup for tests asserting that something re-syncs a scrim night's Discord message
 * (`syncScrimNightMessage()` / `notifyScrimMatchProgress()` in `discord-scrim-notify.ts`).
 *
 * A night whose message is already posted is edited in place by every sync, so a test only has to
 * count the edits: `watchNightMessageEdits()` points the webhook at a stub and records each PATCH to
 * that message. `scrimNightMessageTables()` is the matching fake-DB rows (a night with its message
 * posted) and `scrimNightMessageRpcs` the one RPC a sync calls.
 */

import { createFakeSupabaseClient, type FakeDb, type RpcHandler } from './fakeSupabase';

const WEBHOOK = 'https://discord.example/webhook';
const MESSAGE_ID = 'night';
const EDIT = `PATCH ${WEBHOOK}/messages/${MESSAGE_ID}`;

/** Empty tables a sync reads (besides `players`, `scrim_nights`, `scrim_signups` and `matches`), plus a `scrim_night_discord_state` row for `nightId` with its message posted. */
export function scrimNightMessageTables(nightId: number): Partial<FakeDb> {
  return {
    scrim_night_discord_state: [
      { night_id: nightId, announcement_message_id: null, reminder_message_id: MESSAGE_ID, reminder_sent_at: '2026-01-01T00:00:00Z', finalized_at: null },
    ],
    player_match_stats: [],
    match_server_state: [],
    live_match_score: [],
    ops_errors: [],
  };
}

/** The RPC a sync of a live night calls (queueing the clock-driven end sync). */
export const scrimNightMessageRpcs: Record<string, RpcHandler> = { schedule_one_shot_post: () => true };

/** A fake client with `scrimNightMessageRpcs` and any `extraRpcs`. */
export const clientWithNightMessageRpcs = (db: FakeDb, extraRpcs: Record<string, RpcHandler> = {}) =>
  createFakeSupabaseClient(db, { ...scrimNightMessageRpcs, ...extraRpcs });

/** Enables the Discord webhook and stubs `fetch`; every edit to the night message is appended to
 *  `edits`. Call `stop()` when done. */
export function watchNightMessageEdits(): { edits: string[]; stop: () => void } {
  const edits: string[] = [];
  const realFetch = globalThis.fetch;
  process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL = WEBHOOK;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    const call = `${init?.method} ${url}`;
    if (call === EDIT) edits.push(call);
    return { ok: true, status: 200, json: async () => ({ id: 'new' }) } as unknown as Response;
  }) as typeof fetch;
  return {
    edits,
    stop: () => {
      delete process.env.DISCORD_MATCH_NOTIFICATIONS_WEBHOOK_URL;
      globalThis.fetch = realFetch;
    },
  };
}
