import { AccentTag } from './AccentTag';

/** Status pill for an UPCOMING season: "Sign up now" while the viewer isn't on its roster,
 *  "Soon" once they are. */
export function UpcomingSeasonTag({ needsSignup }: { needsSignup: boolean }) {
  return <AccentTag>{needsSignup ? 'Sign up now' : 'Soon'}</AccentTag>;
}
