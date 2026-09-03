'use client';

import type { DuoStats, H2HStats } from '@/lib/queries';
import { findDuo, findRival, normalizeRival } from '@/lib/h2h';
import { winRatePct } from '@/lib/util';
import { DuoDetail, RivalDetail, EmptyPanel, factionColor, type H2HPlayer } from './MatchupDetail';

type Faction = 'CT' | 'T' | null;

/**
 * This match's own 4 matchups (shirts pair vs. skins pair) plus the two teammate pairs,
 * styled after the pre-match Scouting Report's Friends/Rivals cards but fed this single
 * match's actual box score (via `computeH2H` on one match) instead of career history.
 */
export default function MatchH2H({
  shirtIds,
  skinIds,
  duos,
  rivals,
  players,
  shirtsF,
  skinsF,
}: {
  shirtIds: [number, number];
  skinIds: [number, number];
  duos: DuoStats[];
  rivals: H2HStats[];
  players: Map<number, H2HPlayer>;
  shirtsF: Faction;
  skinsF: Faction;
}) {
  const shirtsDuo = findDuo(duos, shirtIds[0], shirtIds[1]);
  const skinsDuo = findDuo(duos, skinIds[0], skinIds[1]);

  function findNormalized(shirtId: number, skinId: number): H2HStats | undefined {
    const r = findRival(rivals, shirtId, skinId);
    return r ? normalizeRival(r, shirtId) : undefined;
  }

  // columns = shirtIds[0], shirtIds[1] — rows = skinIds[0], skinIds[1] — same reading order as
  // the Scouting Report's Rivals grid.
  const rivalCells = [
    { shirtId: shirtIds[0], skinId: skinIds[0] },
    { shirtId: shirtIds[1], skinId: skinIds[0] },
    { shirtId: shirtIds[0], skinId: skinIds[1] },
    { shirtId: shirtIds[1], skinId: skinIds[1] },
  ].map(({ shirtId, skinId }) => ({ shirtId, skinId, rival: findNormalized(shirtId, skinId) }));

  const name = (id: number) => players.get(id)?.name ?? `#${id}`;

  return (
    <div className="mt-6">
      <div className="tracked text-[10px] mb-4" style={{ letterSpacing: '0.2em' }}>
        <span style={{ color: factionColor(shirtsF) }}>Match H2H</span>
        <span className="text-[var(--color-text-secondary)] mx-2">—</span>
        <span style={{ color: factionColor(shirtsF) }}>Friends</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {shirtsDuo ? (
          <DuoDetail
            duo={shirtsDuo}
            players={players}
            minimal
            headerLabel="Shirts"
            headerColor={factionColor(shirtsF)}
            friendshipRating={winRatePct(shirtsDuo.roundsWon, shirtsDuo.roundsPlayed)}
            ratingBreakdown="Round win rate this match"
            bestMapLabel="Played on"
          />
        ) : (
          <EmptyPanel label={`Shirts (${name(shirtIds[0])} & ${name(shirtIds[1])}) — no data`} />
        )}
        {skinsDuo ? (
          <DuoDetail
            duo={skinsDuo}
            players={players}
            minimal
            headerLabel="Skins"
            headerColor={factionColor(skinsF)}
            friendshipRating={winRatePct(skinsDuo.roundsWon, skinsDuo.roundsPlayed)}
            ratingBreakdown="Round win rate this match"
            bestMapLabel="Played on"
          />
        ) : (
          <EmptyPanel label={`Skins (${name(skinIds[0])} & ${name(skinIds[1])}) — no data`} />
        )}
      </div>

      <div className="tracked text-[10px] mt-6 mb-4" style={{ letterSpacing: '0.2em' }}>
        <span className="text-[var(--color-t)]">Match H2H</span>
        <span className="text-[var(--color-text-secondary)] mx-2">—</span>
        <span className="text-[var(--color-t)]">Rivals</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {rivalCells.map(({ shirtId, skinId, rival }) =>
          rival ? (
            <RivalDetail
              key={`${rival.playerA}-${rival.playerB}`}
              rival={rival}
              players={players}
              minimal
              rivalryRating={Math.round(rival.aStats.rwr)}
              ratingBreakdown="Round win rate this match"
            />
          ) : (
            <EmptyPanel key={`${shirtId}-${skinId}`} label={`${name(shirtId)} vs ${name(skinId)} — no data`} />
          ),
        )}
      </div>
    </div>
  );
}
