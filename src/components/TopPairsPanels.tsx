import Link from 'next/link';
import { h2hPairHref } from '@/lib/crumbs';
import type { H2HData } from '@/lib/queries';
import { rankDuos, rankRivals } from '@/lib/queries';
import PlayerAvatar from './PlayerAvatar';
import RatingCircle from './RatingCircle';

/** How many pairs each home-page list shows. */
export const TOP_PAIRS_LIMIT = 3;

type Tone = 'green' | 'amber';

const TONE: Record<Tone, { panel: string; header: string; title: string; label: string }> = {
  green: {
    panel: 'border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)]',
    header: 'border-[var(--color-accent-green-border)]',
    title: 'text-[var(--color-accent-green-strong)]',
    label: 'text-[var(--color-accent-green-fg)]',
  },
  amber: {
    panel: 'border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)]',
    header: 'border-[var(--color-accent-amber-border)]',
    title: 'text-[var(--color-accent-amber-strong)]',
    label: 'text-[var(--color-accent-amber-fg)]',
  },
};

function PairsPanel({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: Tone;
  rows: { key: string; href: string; names: [string, string]; avatars: [string | null, string | null]; label: string; meta: string; rating: number; ratingTitle: string }[];
}) {
  const t = TONE[tone];
  if (rows.length === 0) return null;
  return (
    <div className={`border ${t.panel}`}>
      <div className={`px-5 py-3 border-b ${t.header} flex items-baseline justify-between gap-3`}>
        <span className={`font-display text-[18px] font-semibold ${t.title}`}>{title}</span>
        <span className={`tracked text-[10px] ${t.label}`}>Career · top {TOP_PAIRS_LIMIT}</span>
      </div>
      {rows.map((r, i) => (
        <Link
          key={r.key}
          href={r.href}
          className={`lift-row flex items-center gap-3 px-4 py-2.5 border-b ${t.header} last:border-b-0`}
        >
          <span className={`display-numeral text-[12px] w-3.5 ${t.label}`}>{i + 1}</span>
          <div className="flex shrink-0">
            <PlayerAvatar name={r.names[0]} imageUrl={r.avatars[0]} size="sm" />
            <div className="-ml-1.5"><PlayerAvatar name={r.names[1]} imageUrl={r.avatars[1]} size="sm" /></div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-[14px] truncate">{r.label}</div>
            <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">{r.meta}</div>
          </div>
          <RatingCircle
            value={r.rating}
            colorStart={tone === 'green' ? 'white' : 'black'}
            colorEnd={tone === 'green' ? 'var(--color-accent-green-fill)' : 'var(--color-accent-red-fg)'}
            size="xs"
            title={r.ratingTitle}
          />
        </Link>
      ))}
    </div>
  );
}

/** The home page's Top duos: the career partners with the highest friendship rating
 *  (`rankDuos()`), each linking to that pair's career H2H matchup. */
export function TopDuosPanel({ data }: { data: H2HData }) {
  const player = new Map(data.players.map((p) => [p.id, p]));
  const rows = rankDuos(data.duos, TOP_PAIRS_LIMIT).flatMap(({ duo, rating }) => {
    const a = player.get(duo.playerA);
    const b = player.get(duo.playerB);
    if (!a || !b) return [];
    return [{
      key: `${duo.playerA}-${duo.playerB}`,
      href: h2hPairHref('/statistics', a.name, b.name, 'partner'),
      names: [a.name, b.name] as [string, string],
      avatars: [a.steam_avatar_url, b.steam_avatar_url] as [string | null, string | null],
      label: `${a.name} & ${b.name}`,
      meta: `${duo.gamesPlayed} games · ${duo.wins}-${duo.losses}`,
      rating,
      ratingTitle: '50% games played together² · 30% win rate² · 20% round win rate²',
    }];
  });
  return <PairsPanel title="Top duos" tone="green" rows={rows} />;
}

/** The home page's Hottest Rivalries: the career opponents with the highest rivalry rating
 *  (`rankRivals()`), each linking to that pair's career H2H matchup. The record counts the first
 *  player's wins first. */
export function HottestRivalriesPanel({ data }: { data: H2HData }) {
  const player = new Map(data.players.map((p) => [p.id, p]));
  const rows = rankRivals(data.rivals, TOP_PAIRS_LIMIT).flatMap(({ rival, rating }) => {
    const a = player.get(rival.playerA);
    const b = player.get(rival.playerB);
    if (!a || !b) return [];
    return [{
      key: `${rival.playerA}-${rival.playerB}`,
      href: h2hPairHref('/statistics', a.name, b.name, 'opponent'),
      names: [a.name, b.name] as [string, string],
      avatars: [a.steam_avatar_url, b.steam_avatar_url] as [string | null, string | null],
      label: `${a.name} vs ${b.name}`,
      meta: `${rival.meetings} meetings · ${rival.aWins}-${rival.bWins}`,
      rating,
      ratingTitle: '50% times faced² · 30% game outcome closeness² · 20% avg round closeness²',
    }];
  });
  return <PairsPanel title="Hottest Rivalries" tone="amber" rows={rows} />;
}
