'use client';

// Dispatch a demo reparse for every match id passed in, a few at a time. Progress is watched on the
// existing `/admin/jobs` dashboard (background_jobs already tracks each dispatched match live) rather
// than a bespoke progress UI here.

import { useState } from 'react';

const CONCURRENCY = 3;

export function BulkReparseButton({ matchIds }: { matchIds: number[] }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [ran, setRan] = useState(false);

  async function runAll() {
    setBusy(true);
    setRan(true);
    setDone(0);
    setFailed(0);

    let cursor = 0;
    let doneCount = 0;
    let failedCount = 0;

    async function worker() {
      while (cursor < matchIds.length) {
        const id = matchIds[cursor++];
        try {
          const res = await fetch(`/api/matches/${id}/demo/dispatch`, { method: 'POST' });
          if (res.ok) doneCount++;
          else failedCount++;
        } catch {
          failedCount++;
        }
        setDone(doneCount);
        setFailed(failedCount);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, matchIds.length) }, worker));
    setBusy(false);
  }

  if (matchIds.length === 0) return null;

  return (
    <div className="flex items-center gap-3 mb-4">
      <button
        onClick={runAll}
        disabled={busy}
        className="font-mono text-[11px] px-2.5 py-1 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
      >
        {busy ? `Dispatching… (${done + failed}/${matchIds.length})` : `Reparse all ${matchIds.length} matches with demos`}
      </button>
      {ran && !busy && (
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          Dispatched {done}{failed > 0 ? `, ${failed} failed` : ''} —{' '}
          <a href="/admin/jobs" className="text-[var(--color-accent-blue-fg)] hover:underline">
            watch progress
          </a>
        </span>
      )}
    </div>
  );
}
