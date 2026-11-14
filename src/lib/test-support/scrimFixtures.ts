import type { Row } from './fakeSupabase';
import type { ScrimSignupEntry } from '@/lib/queries';

/** A `scrim_nights` row starting `offsetMs` from the real clock, with activity on it now, so one that
 *  has started is still running — for route tests, since the scrim routes read the clock themselves. */
export function scrimNightStartingIn(offsetMs: number, id = 5): Row {
  const now = Date.now();
  return { id, starts_at: new Date(now + offsetMs).toISOString(), ended_at: null, last_active_at: new Date(now).toISOString() };
}

/** `night` with nothing done on it for `idleMs` up to now — over once that passes `SCRIM_NIGHT_IDLE_MS`. */
export function idleFor(night: Row, idleMs: number): Row {
  return { ...night, last_active_at: new Date(Date.now() - idleMs).toISOString() };
}

/** A `ScrimSignupEntry` for component tests: named `P<id>`, not checked in, unless `overrides` says. */
export function scrimSignup(player_id: number, commitment: ScrimSignupEntry['commitment'], overrides: Partial<ScrimSignupEntry> = {}): ScrimSignupEntry {
  return {
    player_id,
    player_name: `P${player_id}`,
    steam_avatar_url: null,
    commitment,
    signed_up_at: '2099-01-01T00:00:00Z',
    checked_in_at: null,
    ...overrides,
  };
}
