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

/** The two facts every round-membership check needs — `MatchContext` satisfies this structurally
 *  (it carries both), so any call site with a `context: MatchContext` in scope can just pass
 *  `context` itself. Kept as its own type (not `MatchContext`) so `_shared.ts` doesn't import the
 *  much larger `MatchContext` just for this. */
export interface RoundBounds {
  liveRounds: Set<number>;
  /** Tick the live match begins at (`findMatchStartTick`). 0 means "no tick filtering" (the demo
   *  had no `begin_new_match`, matching `findMatchStartTick`'s own fallback). */
  matchStartTick: number;
  /** Each live round's own `round_end` tick and settle tick (`computeSettleTicks()` in
   *  `matchContext.ts`), keyed by round number — see `roundOf()`'s trailing-action correction. */
  settleWindowByRound: Map<number, { endTick: number; settleTick: number }>;
}

/**
 * The round an event belongs to (`total_rounds_played + 1`), or `null` when the event is before
 * the live match starts or that round isn't in `liveRounds` — warmup/knife events and anything
 * after the demo's recorded rounds. The tick check matters on its own, not just as a belt for the
 * round-number one: a warmup event's `total_rounds_played` isn't guaranteed to be disjoint from
 * the live match's round numbers (MatchZy's round counter doesn't reliably reset at
 * `begin_new_match`), so a warmup death can otherwise land in `liveRounds` by coincidence and get
 * counted as a real round's event — `buildRoundSides()` already applies this same `tick >=
 * matchStartTick` filter to `round_end` events for the same reason.
 *
 * `total_rounds_played` also increments the instant `round_end` fires, but real trailing action —
 * a planted bomb detonating on its own fuse timer, lingering grenade/molotov damage, a gunfight
 * blow landing a few ticks late — can still produce an event after that tick and before the round
 * actually resets (#518). `total_rounds_played` already reports the *next* round by then, so the
 * naive offset is corrected back to the previous round whenever the event's tick falls strictly
 * after that round's own `round_end` tick and at or before its settle tick
 * (`computeSettleTicks()`) — a real next-round event can never land that early, since nothing
 * about the next round starts until after it. The one place this offset-and-liveness check is
 * decided, so every collector gates events the same way.
 */
export function roundOf(
  event: { total_rounds_played: number; tick: number },
  bounds: RoundBounds,
): number | null {
  if (event.tick < bounds.matchStartTick) return null;
  let round = event.total_rounds_played + 1;
  const prevWindow = bounds.settleWindowByRound.get(round - 1);
  if (prevWindow && event.tick > prevWindow.endTick && event.tick <= prevWindow.settleTick) {
    round -= 1;
  }
  return bounds.liveRounds.has(round) ? round : null;
}

/**
 * Buckets `events` by `roundOf()`, dropping anything outside `liveRounds` or before the match
 * starts. Preserves each round's original event order — callers that need a specific order (e.g.
 * by tick) sort the bucket themselves after retrieving it.
 */
export function groupByRound<E extends { total_rounds_played: number; tick: number }>(
  events: E[],
  bounds: RoundBounds,
): Map<number, E[]> {
  const byRound = new Map<number, E[]>();
  for (const e of events) {
    const round = roundOf(e, bounds);
    if (round == null) continue;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(e);
  }
  return byRound;
}
