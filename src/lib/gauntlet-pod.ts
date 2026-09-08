// Shared constants/derivations for gauntlet pod scheduling — a pod's two games share the same 4
// players reshuffled across factions, so they can never actually be played at once. Used by both
// writers of a pod's schedule (PATCH /api/matches/[id]/schedule for a human edit,
// discord-event-sync.ts for a synced Discord Scheduled Event) so the gap can't drift between them.

/** The fixed gap between a pod's two games, once its Game 1 start time is known. */
export const POD_GAME_GAP_MS = 30 * 60 * 1000;

/** `POD_GAME_GAP_MS`, formatted for UI copy and Discord message text. */
export const POD_GAME_GAP_LABEL = '30 minutes';

/** Game 2's `scheduled_at`, derived from Game 1's — `null` in, `null` out (clearing Game 1's time
 * clears Game 2's too). */
export function podGame2ScheduledAt(game1ScheduledAt: string | null): string | null {
  if (!game1ScheduledAt) return null;
  return new Date(new Date(game1ScheduledAt).getTime() + POD_GAME_GAP_MS).toISOString();
}
