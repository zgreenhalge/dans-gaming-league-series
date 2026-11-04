import { signedColor } from '@/lib/util';

/** Places a player moved since the end of the previous week (`getSeasonRankChanges()`): `▲2` in
 *  green, `▼1` in red, nothing when they didn't move. */
export function RankChange({ change }: { change: number | undefined }) {
  if (!change) return null;
  const up = change > 0;
  return (
    <span
      className="ml-1 font-mono text-[10px]"
      style={{ color: signedColor(change, 0) }}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(change)} since last week`}
      aria-label={`${up ? 'up' : 'down'} ${Math.abs(change)} since last week`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(change)}
    </span>
  );
}
