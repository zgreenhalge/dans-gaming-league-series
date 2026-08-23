'use client';

// For Nerds calculator (#60): lets a visitor plug in a hypothetical duo/rivalry's raw record and
// see the actual "Best Friends"/"Closest Rivals" formula score it would produce, normalized against
// the real current league-wide maxes (`computeDuoMaxes`/`computeRivalMaxes`, `src/lib/queries/h2h.ts`)
// so the number means something rather than being normalized against user-typed maxes.

import { useState } from 'react';
import { friendsScore, rivalScore, type DuoScoreMaxes, type RivalScoreMaxes } from '@/lib/queries/h2h';

const inputCls =
  'w-full font-mono text-[13px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]';
const labelCls = 'font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]';

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className={inputCls}
      />
    </label>
  );
}

function ScoreOut({ score }: { score: number }) {
  return (
    <div className="mt-3 font-mono text-[13px]">
      <span className={labelCls}>Score</span>
      <div className="text-[24px] font-semibold text-[var(--color-text-primary)]">
        {Math.round(score * 100)}
        <span className="text-[13px] font-normal text-[var(--color-text-secondary)]"> / 100</span>
      </div>
    </div>
  );
}

export function FriendsCalculator({ maxes }: { maxes: DuoScoreMaxes }) {
  const [gamesPlayed, setGamesPlayed] = useState(20);
  const [wins, setWins] = useState(14);
  const [roundsWon, setRoundsWon] = useState(140);
  const [roundsPlayed, setRoundsPlayed] = useState(240);

  const score = friendsScore(gamesPlayed, Math.min(wins, gamesPlayed), roundsWon, roundsPlayed, maxes);

  return (
    <div className="border border-[var(--color-border-tertiary)] rounded p-4">
      <div className="font-display text-[15px] font-semibold mb-3">Friends Rating calculator</div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Games played" value={gamesPlayed} onChange={setGamesPlayed} />
        <NumberField label="Games won" value={wins} onChange={setWins} />
        <NumberField label="Rounds won" value={roundsWon} onChange={setRoundsWon} />
        <NumberField label="Rounds played" value={roundsPlayed} onChange={setRoundsPlayed} />
      </div>
      <ScoreOut score={score} />
    </div>
  );
}

export function RivalCalculator({ maxes }: { maxes: RivalScoreMaxes }) {
  const [meetings, setMeetings] = useState(20);
  const [aWins, setAWins] = useState(10);
  const [bWins, setBWins] = useState(10);
  const [aRoundsWon, setARoundsWon] = useState(120);
  const [bRoundsWon, setBRoundsWon] = useState(120);

  const score = rivalScore(meetings, aWins, bWins, aRoundsWon, bRoundsWon, maxes);

  return (
    <div className="border border-[var(--color-border-tertiary)] rounded p-4">
      <div className="font-display text-[15px] font-semibold mb-3">Rival Rating calculator</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <NumberField label="Meetings" value={meetings} onChange={setMeetings} />
        </div>
        <NumberField label="Player A wins" value={aWins} onChange={setAWins} />
        <NumberField label="Player B wins" value={bWins} onChange={setBWins} />
        <NumberField label="Player A rounds won" value={aRoundsWon} onChange={setARoundsWon} />
        <NumberField label="Player B rounds won" value={bRoundsWon} onChange={setBRoundsWon} />
      </div>
      <ScoreOut score={score} />
    </div>
  );
}
