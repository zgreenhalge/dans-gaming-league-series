// Shared constants/derivations for gauntlet pod scheduling — a pod's two games share the same 4
// players reshuffled across factions, so they can never actually be played at once. Auto-pairing
// Game 2's time off Game 1's is specific to ingesting a synced Discord Scheduled Event
// (discord-event-sync.ts), the one write path where only Game 1's thread carries a time to derive
// from. A human editing a match's schedule (PATCH /api/matches/[id]/schedule) always sets that one
// match's own time — Game 1 and Game 2 are independently editable there.

/** The fixed gap `discord-event-sync.ts` places between a pod's two games once its Game 1 start
 *  time is known from a synced Discord Scheduled Event. */
export const POD_GAME_GAP_MS = 30 * 60 * 1000;

/** Game 2's `scheduled_at`, derived from Game 1's when a Discord Scheduled Event sync resolves
 *  Game 1's time — `null` in, `null` out (clearing Game 1's time clears Game 2's too). */
export function podGame2ScheduledAt(game1ScheduledAt: string | null): string | null {
  if (!game1ScheduledAt) return null;
  return new Date(new Date(game1ScheduledAt).getTime() + POD_GAME_GAP_MS).toISOString();
}

interface PodGame {
  matchId: number;
  gameNumber: 1 | 2;
  siblingId: number;
}

/** Both games of a materialized pod, each tagged with its own game number and its sibling's match
 * id — the single definition of "Game 1 is whichever match `match1_id` names" every caller that
 * enumerates or looks up a pod's games should share, rather than re-deriving it from the two ids. */
export function podGames(pod: { match1_id: number; match2_id: number }): [PodGame, PodGame] {
  return [
    { matchId: pod.match1_id, gameNumber: 1, siblingId: pod.match2_id },
    { matchId: pod.match2_id, gameNumber: 2, siblingId: pod.match1_id },
  ];
}

/** Given a pod row and one of its own match ids, the *other* match in the pod plus which game
 * number that other match is. */
export function getPodSibling(
  pod: { match1_id: number; match2_id: number },
  matchId: number,
): { siblingId: number; siblingGameNumber: 1 | 2 } {
  const [g1, g2] = podGames(pod);
  const sibling = g1.matchId === matchId ? g2 : g1;
  return { siblingId: sibling.matchId, siblingGameNumber: sibling.gameNumber };
}
