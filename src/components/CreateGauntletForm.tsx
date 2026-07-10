'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Set once a preview has been fetched — nothing is written to the DB until the admin confirms it.
  const [preview, setPreview] = useState<BuildResult | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);

  async function loadPreview() {
    if (!seasonId) return;
    setError(null);
    setPreviewing(true);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/gauntlet/preview`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to preview the gauntlet bracket.');
        return;
      }
      setPreview({ shape: body.shape as Shape, pods: (body.pods as BracketPod[]) ?? [] });
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    if (!seasonId) return;
    setError(null);
    setConfirming(true);
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
      setPreview(null);
    } finally {
      setConfirming(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setError(null);
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

  if (preview) {
    const { shape, pods } = preview;
    return (
      <div className="flex flex-col gap-4">
        <div className="border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] px-4 py-3">
          <div className="tracked text-[10px] text-[var(--color-accent-amber-fg)] mb-1">Preview — Nothing Saved Yet</div>
          <div className="font-mono text-[12px] text-[var(--color-text-primary)]">
            {shape.qualifiers} qualifiers, {shape.games} games across {shape.rounds} round
            {shape.rounds === 1 ? '' : 's'}. Review the shape below, then confirm to write it — or
            cancel and change the season or start date first.
          </div>
        </div>
        <GauntletBracketDiagram pods={pods} currentPlayerId={null} />
        {error && <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={confirm}
            disabled={confirming}
            className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40"
          >
            {confirming ? 'Saving…' : 'Confirm & Build'}
          </button>
          <button
            type="button"
            onClick={cancelPreview}
            disabled={confirming}
            className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <div className="tracked text-[9px] text-[var(--color-text-secondary)]">
            Doesn&apos;t fit? Build a custom bracket by hand instead — it opens pre-loaded with this
            same shape:
          </div>
          <Link
            href={`/admin/seasons/gauntlet/manual/${seasonId}`}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline decoration-dotted w-fit"
          >
            Build manually →
          </Link>
        </div>
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
        onClick={loadPreview}
        disabled={previewing || !seasonId}
        className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40 self-start"
      >
        {previewing ? 'Loading Preview…' : 'Preview Bracket'}
      </button>
    </div>
  );
}
