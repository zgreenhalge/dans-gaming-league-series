import Link from 'next/link';
import { h2hPairHref } from '@/lib/crumbs';
import type { H2HData } from '@/lib/queries';
import { rankDuos, rankRivals } from '@/lib/queries';
import PlayerAvatar from './PlayerAvatar';
import RatingCircle from './RatingCircle';

/** How many pairs each home-page list shows. */
export const TOP_PAIRS_LIMIT = 3;

type Tone = 'green' | 'amber';

const TONE: Record<Tone, { panel: string; header: string; title: string; label: string; ringStart: string; ringEnd: string }> = {
  green: {
    panel: 'border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)]',
    header: 'border-[var(--color-accent-green-border)]',
    title: 'text-[var(--color-accent-green-strong)]',
    label: 'text-[var(--color-accent-green-fg)]',
    ringStart: 'white',
    ringEnd: 'var(--color-accent-green-fill)',
  },
  amber: {
    panel: 'border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)]',
    header: 'border-[var(--color-accent-amber-border)]',
    title: 'text-[var(--color-accent-amber-strong)]',
    label: 'text-[var(--color-accent-amber-fg)]',
    ringStart: 'black',
    ringEnd: 'var(--color-accent-red-fg)',
  },
};

interface PairRow {
  key: string;
  href: string;
  players: [H2HData['players'][number], H2HData['players'][number]];
  label: string;
  meta: string;
  rating: number;
  ratingTitle: string;
}

/** Resolves a ranked pair's two players from the roster and builds its row; a pair with a player
 *  missing from the roster is dropped. */
function pairRow(
  data: H2HData,
  ids: [number, number],
  type: 'partner' | 'opponent',
  fields: { separator: string; meta: string; rating: number; ratingTitle: string },
): PairRow[] {
  const a = data.players.find((p) => p.id === ids[0]);
  const b = data.players.find((p) => p.id === ids[1]);
  if (!a || !b) return [];
  return [{
    key: `${a.id}-${b.id}`,
    href: h2hPairHref('/statistics', a.name, b.name, type),
    players: [a, b],
    label: `${a.name} ${fields.separator} ${b.name}`,
    meta: fields.meta,
    rating: fields.rating,
    ratingTitle: fields.ratingTitle,
  }];
}

function PairsPanel({ title, tone, rows }: { title: string; tone: Tone; rows: PairRow[] }) {
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
            <PlayerAvatar name={r.players[0].name} imageUrl={r.players[0].steam_avatar_url} size="sm" />
            <div className="-ml-1.5"><PlayerAvatar name={r.players[1].name} imageUrl={r.players[1].steam_avatar_url} size="sm" /></div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-[14px] truncate">{r.label}</div>
            <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">{r.meta}</div>
          </div>
          <RatingCircle
            value={r.rating}
            colorStart={t.ringStart}
            colorEnd={t.ringEnd}
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
  const rows = rankDuos(data.duos, TOP_PAIRS_LIMIT).flatMap(({ duo, rating }) =>
    pairRow(data, [duo.playerA, duo.playerB], 'partner', {
      separator: '&',
      meta: `${duo.gamesPlayed} games · ${duo.wins}-${duo.losses}`,
      rating,
      ratingTitle: '50% games played together² · 30% win rate² · 20% round win rate²',
    }),
  );
  return <PairsPanel title="Top duos" tone="green" rows={rows} />;
}

/** The home page's Hottest Rivalries: the career opponents with the highest rivalry rating
 *  (`rankRivals()`), each linking to that pair's career H2H matchup. The record counts the first
 *  player's wins first. */
export function HottestRivalriesPanel({ data }: { data: H2HData }) {
  const rows = rankRivals(data.rivals, TOP_PAIRS_LIMIT).flatMap(({ rival, rating }) =>
    pairRow(data, [rival.playerA, rival.playerB], 'opponent', {
      separator: 'vs',
      meta: `${rival.meetings} meetings · ${rival.aWins}-${rival.bWins}`,
      rating,
      ratingTitle: '50% times faced² · 30% game outcome closeness² · 20% avg round closeness²',
    }),
  );
  return <PairsPanel title="Hottest Rivalries" tone="amber" rows={rows} />;
}
