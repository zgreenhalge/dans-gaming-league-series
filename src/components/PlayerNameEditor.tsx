'use client';

// Self-service rename (issue #268), shown only on a player's own profile page. Mirrors the
// pencil-in-place pattern `PlayerRow.tsx` uses for the admin console — a small ✎ affordance next to
// the name that swaps in an input + Save/✕ — sized up for the hero heading instead of a table cell.
// Backed by `PATCH /api/players/me/name`, which enforces the letters-only rule and the once-a-week
// cooldown; this component only mirrors that validation client-side so Save disables early.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { normalizePlayerName, isValidPlayerName, PLAYER_NAME_MIN_LENGTH, PLAYER_NAME_MAX_LENGTH } from '@/lib/util';

export default function PlayerNameEditor({ playerId, name }: { playerId: number; name: string }) {
  const router = useRouter();
  const { update } = useSession();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = normalizePlayerName(value);
  const valid = isValidPlayerName(trimmed);

  function cancel() {
    setValue(name);
    setError(null);
    setEditing(false);
  }

  async function save() {
    if (!valid || trimmed === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/players/me/name', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; nextEligibleAt?: string };
      if (!res.ok) {
        setError(
          body.nextEligibleAt
            ? `${body.error} You can try again on ${new Date(body.nextEligibleAt).toLocaleDateString()}.`
            : body.error ?? 'Failed to update',
        );
        return;
      }
      await update({ playerId, playerName: trimmed });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <div className="font-display text-[42px] font-semibold leading-tight">{name}</div>
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit name"
          className="text-[16px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={value}
          autoFocus
          maxLength={PLAYER_NAME_MAX_LENGTH}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') cancel();
          }}
          className="font-display text-[28px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]"
        />
        <button
          onClick={save}
          disabled={!valid || busy}
          className="tracked text-[10px] font-semibold px-2 py-1.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] disabled:opacity-40 transition-colors"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>
      {value.trim() && !valid && (
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          {PLAYER_NAME_MIN_LENGTH}-{PLAYER_NAME_MAX_LENGTH} letters — spaces allowed between words, no numbers or symbols.
        </div>
      )}
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>}
    </div>
  );
}
