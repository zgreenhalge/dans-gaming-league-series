'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface GauntletRow {
  regularSeasonId: number;
  regularSeasonName: string;
  gauntletName: string;
  seeded: boolean;
  started: boolean;
}

type SeedBands = { byes: string[]; playing: string[]; relegated: string[] };

function GauntletLifecycleRow({ season }: { season: GauntletRow }) {
  const router = useRouter();
  const [resetArmed, setResetArmed] = useState(false);
  const [forceArmed, setForceArmed] = useState(false);
  const [forceConfirmText, setForceConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seededResult, setSeededResult] = useState<SeedBands | null>(null);

  async function seed() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${season.regularSeasonId}/gauntlet/seed`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to seed gauntlet.');
        return;
      }
      setSeededResult(body.seed_bands as SeedBands);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reset(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${season.regularSeasonId}/gauntlet`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to reset gauntlet.');
        setResetArmed(false);
        setForceArmed(false);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-[14px] font-semibold">{season.gauntletName}</div>
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {season.regularSeasonName} —{' '}
            {season.started
              ? 'in progress'
              : season.seeded
                ? 'seeded, round 1 not yet played'
                : 'shape built, not yet seeded'}
          </div>
          {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1">{error}</div>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/admin/seasons/gauntlet/manual/${season.regularSeasonId}`}
            className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
          >
            Manage Bracket
          </Link>
          {!season.seeded && !season.started && (
            <button
              type="button"
              onClick={seed}
              disabled={busy}
              className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)] hover:brightness-110 transition-all disabled:opacity-40"
            >
              {busy ? 'Seeding…' : 'Seed Bracket'}
            </button>
          )}

          {season.started ? (
            !forceArmed && (
              <button
                type="button"
                onClick={() => setForceArmed(true)}
                className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors underline decoration-dotted"
              >
                Force reset…
              </button>
            )
          ) : resetArmed ? (
            <>
              <button
                type="button"
                onClick={() => reset(false)}
                disabled={busy}
                className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)] hover:brightness-110 transition-all disabled:opacity-40"
              >
                {busy ? 'Resetting…' : 'Confirm Reset'}
              </button>
              <button
                type="button"
                onClick={() => setResetArmed(false)}
                disabled={busy}
                className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setResetArmed(true)}
              className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {forceArmed && (
        <div className="mt-3 pt-3 border-t border-[var(--color-accent-red-border)] flex flex-col gap-2">
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">
            This gauntlet has already started. Force-resetting permanently discards every match and
            stat played in it — there is no undo. Type the gauntlet name to confirm:
          </div>
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">{season.gauntletName}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={forceConfirmText}
              onChange={(e) => setForceConfirmText(e.target.value)}
              placeholder="Gauntlet name"
              className="font-mono text-[12px] px-2 py-1 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-red-border)]"
            />
            <button
              type="button"
              onClick={() => reset(true)}
              disabled={busy || forceConfirmText !== season.gauntletName}
              className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)] hover:brightness-110 transition-all disabled:opacity-40"
            >
              {busy ? 'Resetting…' : 'Force Delete'}
            </button>
            <button
              type="button"
              onClick={() => {
                setForceArmed(false);
                setForceConfirmText('');
              }}
              disabled={busy}
              className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {seededResult && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border-tertiary)] flex flex-col gap-2">
          {seededResult.byes.length > 0 && (
            <div>
              <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-0.5">Bye to the final</div>
              <div className="font-mono text-[12px]">{seededResult.byes.join(', ')}</div>
            </div>
          )}
          <div>
            <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-0.5">Playing round 1</div>
            <div className="font-mono text-[12px]">{seededResult.playing.join(', ')}</div>
          </div>
          {seededResult.relegated.length > 0 && (
            <div>
              <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-0.5">Relegated</div>
              <div className="font-mono text-[12px]">{seededResult.relegated.join(', ')}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Lists active seasons that already have a gauntlet (automated or manual), with per-row actions
 * for wherever it is in its lifecycle: unseeded automated shapes can be seeded (from the regular
 * season's current leaderboard) or reset; manual gauntlets link back to the manual builder instead
 * of seeding; once any match has been scored, only a force reset is available. */
export function GauntletLifecycleList({ seasons }: { seasons: GauntletRow[] }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {seasons.map((s) => (
        <GauntletLifecycleRow key={s.regularSeasonId} season={s} />
      ))}
    </div>
  );
}
