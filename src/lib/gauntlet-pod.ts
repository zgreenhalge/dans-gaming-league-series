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
): { siblingId: number; siblingGameNumber: 1 | 2; callerIsGame2: boolean } {
  const [g1, g2] = podGames(pod);
  const caller = g1.matchId === matchId ? g1 : g2;
  const sibling = g1.matchId === matchId ? g2 : g1;
  return { siblingId: sibling.matchId, siblingGameNumber: sibling.gameNumber, callerIsGame2: caller.gameNumber === 2 };
}
