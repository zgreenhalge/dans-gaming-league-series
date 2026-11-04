/** Places a player moved in the standings (`rankChangesSinceLastWeek()`, `rankMovementForWeek()`):
 *  `▲n` in green, `▼n` in red, nothing when they didn't move. */
export function RankChange({ change }: { change: number | null | undefined }) {
  if (!change) return null;
  const up = change > 0;
  const label = `${up ? 'up' : 'down'} ${Math.abs(change)} since last week`;
  return (
    <span
      className={`ml-1 font-mono text-[10px] ${up ? 'text-[var(--color-accent-green-fg)]' : 'text-[var(--color-accent-red-fg)]'}`}
      title={label}
      aria-label={label}
    >
      {up ? '▲' : '▼'}
      {Math.abs(change)}
    </span>
  );
}
