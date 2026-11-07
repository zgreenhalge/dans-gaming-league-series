import type { Row } from './fakeSupabase';
import type { ScrimSignupEntry } from '@/lib/queries';

/** A `scrim_nights` row starting `offsetMs` from the real clock — for route tests, since the scrim
 *  routes read the clock themselves. */
export function scrimNightStartingIn(offsetMs: number, id = 5): Row {
  return { id, starts_at: new Date(Date.now() + offsetMs).toISOString(), ended_at: null };
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
