// How full a scrim night is, from its signups: the counts behind the seats (`Seats`,
// `src/components/ScrimSeats.tsx`) on the scrims calendar and the home page's Upcoming panel and week
// strip. Pure, so it stays out of the components that draw it.

import { SCRIM_MATCH_SIZE, type ScrimCommitment } from './scrim-schedule';

export interface SignupCounts {
  definite: number;
  maybe: number;
}

export type NightFill = 'full' | 'could-fill' | 'short';

/** A night's definite and maybe signup counts. */
export function signupCounts(signups: { commitment: ScrimCommitment }[]): SignupCounts {
  const definite = signups.filter((s) => s.commitment === 'definite').length;
  return { definite, maybe: signups.length - definite };
}

/** How full a night is: `full` once `SCRIM_MATCH_SIZE` players are definite, `could-fill` when its
 *  maybes would get it there, otherwise `short`. */
export function nightFill(definite: number, maybe: number): NightFill {
  if (definite >= SCRIM_MATCH_SIZE) return 'full';
  return definite + maybe >= SCRIM_MATCH_SIZE ? 'could-fill' : 'short';
}

/** Of a day's nights' signup counts, the one that speaks for the day: the most definite signups, then
 *  the most maybes. `null` for a day with no nights. */
export function leadNight(counts: SignupCounts[]): SignupCounts | null {
  return counts.reduce<SignupCounts | null>(
    (best, c) => (best === null || c.definite > best.definite || (c.definite === best.definite && c.maybe > best.maybe) ? c : best),
    null,
  );
}

/** A day's nights as one day cell shows them: the lead night's counts (`leadNight()`) and its fill —
 *  `short` for a day with no nights — and the counts across every night that day. */
export function dayNightFill(nights: { signups: { commitment: ScrimCommitment }[] }[]): { lead: SignupCounts | null; fill: NightFill; total: SignupCounts } {
  const counts = nights.map((n) => signupCounts(n.signups));
  const lead = leadNight(counts);
  const total = counts.reduce((sum, c) => ({ definite: sum.definite + c.definite, maybe: sum.maybe + c.maybe }), { definite: 0, maybe: 0 });
  return { lead, fill: lead ? nightFill(lead.definite, lead.maybe) : 'short', total };
}
