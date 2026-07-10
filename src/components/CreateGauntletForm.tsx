'use client';

import { useState } from 'react';
import { GauntletBracketDiagram } from './GauntletBracketDiagram';
import type { BracketPod } from '@/lib/queries';

interface Props {
  seasons: { id: number; name: string }[];
}

type Shape = { qualifiers: number; games: number; rounds: number };
type BuildResult = { shape: Shape; pods: BracketPod[] };

export function CreateGauntletForm({ seasons }: Props) {
  const [seasonId, setSeasonId] = useState<number | ''>(seasons[0]?.id ?? '');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);

  async function submit() {
    if (!seasonId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/gauntlet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: startDate || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to build the gauntlet bracket.');
        return;
      }
      setResult({ shape: body.shape as Shape, pods: (body.pods as BracketPod[]) ?? [] });
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const { shape, pods } = result;
    return (
      <div className="flex flex-col gap-4">
        <div className="border border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] px-4 py-3">
          <div className="tracked text-[10px] text-[var(--color-accent-green-fg)] mb-1">Bracket Shape Built</div>
          <div className="font-mono text-[12px] text-[var(--color-text-primary)]">
            {shape.qualifiers} qualifiers, {shape.games} games across {shape.rounds} round
            {shape.rounds === 1 ? '' : 's'}. Nothing is playable yet — seed it from the &quot;Existing
            Gauntlets&quot; list below once the regular season is complete.
          </div>
        </div>
        <GauntletBracketDiagram pods={pods} currentPlayerId={null} />
      </div>
    );
  }

  if (seasons.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No active seasons are eligible — either nothing is ACTIVE, or every active season already has
        a gauntlet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-2">Season</div>
        <select
          value={seasonId}
          onChange={(e) => setSeasonId(Number(e.target.value))}
          className="w-full font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-2">Start Date (optional)</div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
        />
      </div>

      {error && <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !seasonId}
        className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40 self-start"
      >
        {submitting ? 'Building…' : 'Build Bracket'}
      </button>
    </div>
  );
}
