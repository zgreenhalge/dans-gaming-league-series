/** The small win / loss badge ("W" / "L") used wherever a result sits beside a match — the player
 *  page's Last 5 and the home page's Match history. */
export function WLChip({ won }: { won: boolean }) {
  return (
    <span className={`wl-chip wl-chip--sm ${won ? 'wl-chip--win' : 'wl-chip--loss'}`} aria-label={won ? 'Win' : 'Loss'}>
      {won ? 'W' : 'L'}
    </span>
  );
}
