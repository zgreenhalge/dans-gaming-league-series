import Link from 'next/link';
import { careerH2HHref, h2hPairHref } from '@/lib/crumbs';
import type { H2HData } from '@/lib/queries';
import { duoBreakdownScorer, rankDuos, rankRivals, rivalBreakdownScorer } from '@/lib/queries';
import { DuoHeader, DuoRow, RivalHeader, RivalRow } from './H2HRows';

/** How many pairs each home-page list shows. */
export const TOP_PAIRS_LIMIT = 3;

/** A card shaped like `H2HSection`'s Best Friends / Closest Rivals: the title links to the career H2H
 *  tab, `tooltip` explains the rating it ranks by. */
function PairsCard({ title, tooltip, children }: { title: string; tooltip: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-5 py-3 border-b border-[var(--color-border-tertiary)] flex items-baseline justify-between gap-3">
        <Link
          href={careerH2HHref()}
          title={tooltip}
          className="font-display text-[18px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-site-accent)] transition-colors"
        >
          {title}
        </Link>
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Career</span>
      </div>
      {children}
    </div>
  );
}

/** The home page's Top duos: the career partners with the highest friendship rating
 *  (`rankDuos()`), each row showing rating, games and W-L and linking to that pair's career H2H
 *  matchup. Renders nothing before any pair has played together. */
export function TopDuosPanel({ data }: { data: H2HData }) {
  const ranked = rankDuos(data.duos, TOP_PAIRS_LIMIT);
  if (ranked.length === 0) return null;
  const breakdown = duoBreakdownScorer(data.duos);
  const player = new Map(data.players.map((p) => [p.id, p]));
  return (
    <PairsCard title="Top duos" tooltip="50% games played together² · 30% win rate² · 20% round win rate²">
      <DuoHeader compact />
      {ranked.map(({ duo, rating }, i) => {
        const a = player.get(duo.playerA);
        const b = player.get(duo.playerB);
        if (!a || !b) return null;
        return (
          <DuoRow
            key={`${duo.playerA}-${duo.playerB}`}
            compact
            rank={i + 1}
            duo={duo}
            rating={rating}
            breakdown={breakdown(duo)}
            a={a}
            b={b}
            href={h2hPairHref('/statistics', a.name, b.name, 'partner')}
          />
        );
      })}
    </PairsCard>
  );
}

/** The home page's Hottest Rivalries: the career opponents with the highest rivalry rating
 *  (`rankRivals()`), each row showing both players' matches won and the rating, linking to that
 *  pair's career H2H matchup. Renders nothing before any pair has met. */
export function HottestRivalriesPanel({ data }: { data: H2HData }) {
  const ranked = rankRivals(data.rivals, TOP_PAIRS_LIMIT);
  if (ranked.length === 0) return null;
  const breakdown = rivalBreakdownScorer(data.rivals);
  const player = new Map(data.players.map((p) => [p.id, p]));
  return (
    <PairsCard title="Hottest Rivalries" tooltip="50% times faced² · 30% game outcome closeness² · 20% avg round closeness²">
      <RivalHeader compact />
      {ranked.map(({ rival, rating }) => {
        const a = player.get(rival.playerA);
        const b = player.get(rival.playerB);
        if (!a || !b) return null;
        return (
          <RivalRow
            key={`${rival.playerA}-${rival.playerB}`}
            compact
            rival={rival}
            rating={rating}
            breakdown={breakdown(rival)}
            a={a}
            b={b}
            href={h2hPairHref('/statistics', a.name, b.name, 'opponent')}
          />
        );
      })}
    </PairsCard>
  );
}
