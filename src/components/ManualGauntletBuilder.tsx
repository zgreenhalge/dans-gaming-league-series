'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Player {
  id: number;
  name: string;
}

interface MatchSummary {
  id: number;
  shirts: string[];
  skins: string[];
  played: boolean;
}

interface RoundSummary {
  round_number: number;
  matches: MatchSummary[];
}

interface Props {
  regularSeasonId: number;
  gauntletExists: boolean;
  players: Player[];
  rounds: RoundSummary[];
}

export function ManualGauntletBuilder({ regularSeasonId, gauntletExists, players, rounds }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roundNumber, setRoundNumber] = useState('1');
  const [shirts1, setShirts1] = useState<number | ''>('');
  const [shirts2, setShirts2] = useState<number | ''>('');
  const [skins1, setSkins1] = useState<number | ''>('');
  const [skins2, setSkins2] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);

  async function createShell() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${regularSeasonId}/gauntlet/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to create gauntlet.');
        return;
      }
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  const selected = [shirts1, shirts2, skins1, skins2];
  const allPicked = selected.every((v) => v !== '');
  const allDistinct = new Set(selected).size === 4;
  const roundNumberValid = /^\d+$/.test(roundNumber) && Number(roundNumber) >= 1;

  async function addMatch() {
    if (!allPicked || !allDistinct || !roundNumberValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${regularSeasonId}/gauntlet/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_number: Number(roundNumber),
          shirts: [shirts1, shirts2],
          skins: [skins1, skins2],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to create match.');
        return;
      }
      setShirts1('');
      setShirts2('');
      setSkins1('');
      setSkins2('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (!gauntletExists) {
    return (
      <div className="flex flex-col gap-4">
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          No gauntlet exists for this season yet. Create an empty gauntlet shell to start
          hand-building rounds into.
        </div>
        {error && <div className="text-[12px] text-[var(--color-accent-red-fg)]">{error}</div>}
        <button
          type="button"
          onClick={createShell}
          disabled={creating}
          className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40 self-start"
        >
          {creating ? 'Creating…' : 'Create Gauntlet Shell'}
        </button>
      </div>
    );
  }

  const playerSelect = (value: number | '', onChange: (v: number | '') => void, label: string) => (
    <div className="flex flex-col gap-1">
      <div className="tracked text-[9px] text-[var(--color-text-secondary)]">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
        className="font-mono text-[13px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
      >
        <option value="">—</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {rounds.length > 0 && (
        <div>
          <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Existing Rounds</div>
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            {rounds.map((r) => (
              <div key={r.round_number} className="px-4 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0">
                <div className="font-display text-[13px] font-semibold mb-1">Round {r.round_number}</div>
                {r.matches.map((m) => (
                  <div key={m.id} className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {m.shirts.join(' & ')} vs {m.skins.join(' & ')} {m.played ? '(played)' : '(pending)'}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Add Match</div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 max-w-[120px]">
            <div className="tracked text-[9px] text-[var(--color-text-secondary)]">Round Number</div>
            <input
              type="number"
              min={1}
              value={roundNumber}
              onChange={(e) => setRoundNumber(e.target.value)}
              className="font-mono text-[13px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {playerSelect(shirts1, setShirts1, 'Shirts 1')}
            {playerSelect(shirts2, setShirts2, 'Shirts 2')}
            {playerSelect(skins1, setSkins1, 'Skins 1')}
            {playerSelect(skins2, setSkins2, 'Skins 2')}
          </div>
          {allPicked && !allDistinct && (
            <div className="text-[12px] text-[var(--color-accent-red-fg)]">All four players must be distinct.</div>
          )}
          {error && <div className="text-[12px] text-[var(--color-accent-red-fg)]">{error}</div>}
          <button
            type="button"
            onClick={addMatch}
            disabled={submitting || !allPicked || !allDistinct || !roundNumberValid}
            className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40 self-start"
          >
            {submitting ? 'Adding…' : 'Add Match'}
          </button>
        </div>
      </div>
    </div>
  );
}
