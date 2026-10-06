/** Status pill for an UPCOMING season: "Sign up now" while the viewer isn't on its roster,
 *  "Soon" once they are. */
export function UpcomingSeasonTag({ needsSignup }: { needsSignup: boolean }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 tracked text-[10px] font-semibold border shrink-0"
      style={{
        color: 'var(--color-site-accent)',
        background: 'color-mix(in srgb, var(--color-site-accent) 12%, transparent)',
        borderColor: 'var(--color-site-accent)',
      }}
    >
      {needsSignup ? 'Sign up now' : 'Soon'}
    </span>
  );
}
