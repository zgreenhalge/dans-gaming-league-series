import { StatusPill } from './StatusPill';

/** Status pill for an UPCOMING season: "Sign up now" while the viewer isn't on its roster,
 *  "Soon" once they are. */
export function UpcomingSeasonTag({ needsSignup }: { needsSignup: boolean }) {
  return <StatusPill variant="accent">{needsSignup ? 'Sign up now' : 'Soon'}</StatusPill>;
}
