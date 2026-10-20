'use client';

import { useMemo, useState } from 'react';
import type { RatedPlayer } from '@/lib/queries';
import { evaluateMatchup, hasDuplicatePick, rankSplits, type Matchup } from '@/lib/win-probability';
import { WinProbabilityBar } from './WinProbabilityBar';
import SectionLabel from './SectionLabel';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import { InfoTooltip } from './InfoTooltip';
import { SELECT_CLS } from './adminButtonStyles';

const PROVISIONAL_NOTE =
  'One or more players are early in their rating history, so these predictions carry extra uncertainty.';

/** Slots in pick order: shirts 1, shirts 2, skins 1, skins 2. */
type Picks = [number | null, number | null, number | null, number | null];

export function WinProbabilityCalculator({ players }: { players: RatedPlayer[] }) {
  const [picks, setPicks] = useState<Picks>([null, null, null, null]);
  const byId = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players]);

  function setPick(slot: number, value: string) {
    setPicks((prev) => prev.map((id, i) => (i === slot ? (value === '' ? null : Number(value)) : id)) as Picks);
  }

  if (players.length < 4) return <EmptyState message="Not enough players with ratings yet." />;

  const duplicate = hasDuplicatePick(picks);
  const chosen = picks.map((id) => (id == null ? null : byId.get(id) ?? null));
  const four = !duplicate && chosen.every((p) => p != null) ? (chosen as RatedPlayer[]) : null;
  const matchup = four ? evaluateMatchup(four.slice(0, 2), four.slice(2)) : null;
  const splits = four ? rankSplits(four) : null;

  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <TeamPicker label="Shirts" players={players} picks={[picks[0], picks[1]]} slots={[0, 1]} onPick={setPick} />
          <TeamPicker label="Skins" players={players} picks={[picks[2], picks[3]]} slots={[2, 3]} onPick={setPick} />
        </div>
        <ErrorText error={duplicate ? "A player can only be on one side." : null} className="mt-3" />
      </section>

      {matchup && four && (
        <section>
          <SectionLabel>Win probability</SectionLabel>
          <WinProbabilityBar
            pShirtsWin={matchup.pShirtsWin}
            shirtsF={null}
            skinsF={null}
            provisional={matchup.provisional}
            played={false}
            shirtsWon={false}
          />
          <PlayerRatings players={four} />
        </section>
      )}

      {splits && (
        <section>
          <SectionLabel>
            All three splits, most even first
            {splits.some((s) => s.provisional) && <InfoTooltip className="ml-1.5">{PROVISIONAL_NOTE}</InfoTooltip>}
          </SectionLabel>
          <ol className="flex flex-col border border-[var(--color-border-primary)] divide-y divide-[var(--color-border-primary)]">
            {splits.map((s, i) => (
              <SplitRow key={i} split={s} best={i === 0} byId={byId} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function TeamPicker({
  label,
  players,
  picks,
  slots,
  onPick,
}: {
  label: string;
  players: RatedPlayer[];
  picks: (number | null)[];
  slots: number[];
  onPick: (slot: number, value: string) => void;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-col gap-2">
        {slots.map((slot, i) => (
          <select
            key={slot}
            aria-label={`${label} player ${i + 1}`}
            className={SELECT_CLS}
            value={picks[i] ?? ''}
            onChange={(e) => onPick(slot, e.target.value)}
          >
            <option value="">Pick a player…</option>
            {players.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.name}
              </option>
            ))}
          </select>
        ))}
      </div>
    </div>
  );
}

function PlayerRatings({ players }: { players: RatedPlayer[] }) {
  return (
    <ul className="mt-5 max-w-md mx-auto grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[12px]">
      {players.map((p) => (
        <li key={p.playerId} className="flex justify-between gap-3">
          <span className="truncate">{p.name}</span>
          <span className="text-[var(--color-text-secondary)]">EHOG {p.ehogRating.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

function SplitRow({ split, best, byId }: { split: Matchup; best: boolean; byId: Map<number, RatedPlayer> }) {
  const team = (t: Matchup['shirts']) => t.map((p) => byId.get(p.playerId)?.name ?? '?').join(' + ');
  const shirtsPct = Math.round(split.pShirtsWin * 100);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 font-mono text-[12px]">
      <span>
        {team(split.shirts)} <span className="text-[var(--color-text-secondary)]">vs</span> {team(split.skins)}
      </span>
      <span>
        {shirtsPct}% – {100 - shirtsPct}%{best ? ' · most even' : ''}
      </span>
    </li>
  );
}
