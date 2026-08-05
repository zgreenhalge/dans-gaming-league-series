/**
 * Sets up a collector's output map and steamid membership set: one empty `Partial<T>` per roster
 * player, plus the `Set` most collectors use to gate events to known players. Callers that don't
 * need the membership check (e.g. collectors that only ever look up their own roster's steamIds)
 * can destructure just `{ out }`.
 */
export function initCollector<T>(steamIds: string[]): { out: Map<string, Partial<T>>; steamSet: Set<string> } {
  const out = new Map<string, Partial<T>>();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});
  return { out, steamSet };
}

/**
 * The round an event belongs to (`total_rounds_played + 1`), or `null` when that round isn't in
 * `liveRounds` — warmup/knife events and anything after the demo's recorded rounds. The one place
 * this offset-and-liveness check is decided, so every collector gates events the same way.
 */
export function roundOf(event: { total_rounds_played: number }, liveRounds: Set<number>): number | null {
  const round = event.total_rounds_played + 1;
  return liveRounds.has(round) ? round : null;
}

/**
 * Buckets `events` by `roundOf()`, dropping anything outside `liveRounds`. Preserves each
 * round's original event order — callers that need a specific order (e.g. by tick) sort the
 * bucket themselves after retrieving it.
 */
export function groupByRound<E extends { total_rounds_played: number }>(
  events: E[],
  liveRounds: Set<number>,
): Map<number, E[]> {
  const byRound = new Map<number, E[]>();
  for (const e of events) {
    const round = roundOf(e, liveRounds);
    if (round == null) continue;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(e);
  }
  return byRound;
}
