import type { ReplayRound } from '../replay/types';

/** A minimal, fully-valid `ReplayRound` with every required field defaulted — shared by every
 *  replay-related test file (`replay.test.ts`, `draw.test.ts`) so a `ReplayRound` fixture is built
 *  in exactly one place instead of each file growing its own (weaker, unsafely-cast) version. */
export function round(partial: Partial<ReplayRound> = {}): ReplayRound {
  return {
    round: 1,
    startTick: 0,
    endTick: 1000,
    freezeEndTick: 0,
    sideByFaction: { SHIRTS: 'CT', SKINS: 'T' },
    frames: [],
    events: [],
    grenades: [],
    shots: [],
    blinds: [],
    hurts: [],
    bombCarrier: [],
    ...partial,
  };
}
