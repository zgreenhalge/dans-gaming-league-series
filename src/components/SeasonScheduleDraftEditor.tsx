'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  validateDraftIntegrity,
  validateDraftCompleteness,
  type DraftScheduleWeek,
} from '@/lib/season-schedule-validation';
import type { DoubleheaderPolicy } from '@/lib/season-schedule';

interface Player {
  id: number;
  name: string;
}

interface Props {
  seasonId: number;
  players: Player[];
  initialWeeks: DraftScheduleWeek[];
}

type SlotKey = 'shirts0' | 'shirts1' | 'skins0' | 'skins1';

function updateMatchSlot(week: DraftScheduleWeek, matchNumber: number, slot: SlotKey, playerId: number): DraftScheduleWeek {
  return {
    ...week,
    matches: week.matches.map((m) => {
      if (m.match_number !== matchNumber) return m;
      const shirts: [number, number] = [...m.shirts];
      const skins: [number, number] = [...m.skins];
      if (slot === 'shirts0') shirts[0] = playerId;
      else if (slot === 'shirts1') shirts[1] = playerId;
      else if (slot === 'skins0') skins[0] = playerId;
      else skins[1] = playerId;
      return { ...m, shirts, skins };
    }),
  };
}

/** Full roster in every dropdown, no exclusion — unlike gauntlet's slot pickers (where a seed can
 * only occupy one bracket slot, ever), a player here can legitimately occupy two slots the same
 * week (a doubleheader), so there's nothing to prune. validateDraftIntegrity() catches the
 * mistakes (3+ appearances, self-paired matches) that unrestricted picking can produce. */
function PlayerSelect({ players, value, onChange }: { players: Player[]; value: number; onChange: (id: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="font-mono text-[12px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
    >
      {players.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

export function SeasonScheduleDraftEditor({ seasonId, players, initialWeeks }: Props) {
  const router = useRouter();
  const [weeks, setWeeks] = useState<DraftScheduleWeek[]>(initialWeeks);
  const [doubleheaderPolicy, setDoubleheaderPolicy] = useState<DoubleheaderPolicy>('auto');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playerName = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  const rosterPlayerIds = useMemo(() => players.map((p) => p.id), [players]);
  const integrity = useMemo(() => validateDraftIntegrity(weeks), [weeks]);
  const completeness = useMemo(() => validateDraftCompleteness(weeks, rosterPlayerIds), [weeks, rosterPlayerIds]);

  const busy = generating || saving || confirming || clearing;

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doubleheaderPolicy }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to generate the schedule.');
        return;
      }
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to save the draft.');
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDraft() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/schedule/confirm`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to confirm the schedule.');
        return;
      }
      router.push(`/seasons/${seasonId}`);
    } finally {
      setConfirming(false);
    }
  }

  async function clearDraft() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/schedule`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to clear the draft.');
        return;
      }
      router.refresh();
    } finally {
      setClearing(false);
    }
  }

  if (weeks.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          No matchup draft yet — generate one from the current roster ({players.length} players).
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={doubleheaderPolicy === 'never'}
              onChange={(e) => setDoubleheaderPolicy(e.target.checked ? 'never' : 'auto')}
            />
            Never double-header (fails to generate if the roster size needs one)
          </label>
        </div>
        {error && <div className="font-mono text-[12px] text-[var(--color-accent-red-fg)]">{error}</div>}
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40 self-start"
        >
          {generating ? 'Generating…' : 'Generate Schedule'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {weeks.map((week) => (
          <div key={week.week_number} className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="tracked text-[9px] text-[var(--color-text-secondary)]">Week {week.week_number}</div>
              <label className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
                Bye
                <select
                  value={week.bye_player_id ?? ''}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : null;
                    setWeeks((prev) => prev.map((w) => (w.week_number === week.week_number ? { ...w, bye_player_id: v } : w)));
                  }}
                  className="font-mono text-[12px] px-2 py-1 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
                >
                  <option value="">— none —</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-col gap-2">
              {week.matches.map((m) => (
                <div key={m.match_number} className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-[var(--color-text-secondary)]">
                  <span className="tracked text-[9px] w-14 shrink-0">Match {m.match_number}</span>
                  <PlayerSelect
                    players={players}
                    value={m.shirts[0]}
                    onChange={(id) => setWeeks((prev) => prev.map((w) => (w.week_number === week.week_number ? updateMatchSlot(w, m.match_number, 'shirts0', id) : w)))}
                  />
                  <PlayerSelect
                    players={players}
                    value={m.shirts[1]}
                    onChange={(id) => setWeeks((prev) => prev.map((w) => (w.week_number === week.week_number ? updateMatchSlot(w, m.match_number, 'shirts1', id) : w)))}
                  />
                  <span>vs</span>
                  <PlayerSelect
                    players={players}
                    value={m.skins[0]}
                    onChange={(id) => setWeeks((prev) => prev.map((w) => (w.week_number === week.week_number ? updateMatchSlot(w, m.match_number, 'skins0', id) : w)))}
                  />
                  <PlayerSelect
                    players={players}
                    value={m.skins[1]}
                    onChange={(id) => setWeeks((prev) => prev.map((w) => (w.week_number === week.week_number ? updateMatchSlot(w, m.match_number, 'skins1', id) : w)))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!integrity.ok && (
        <div className="font-mono text-[12px] text-[var(--color-accent-red-fg)] flex flex-col gap-0.5">
          {integrity.issues.map((issue, i) => (
            <div key={i}>{issue.message}</div>
          ))}
        </div>
      )}

      <div
        className="font-mono text-[12px] px-3 py-2 border"
        style={
          completeness.complete
            ? { borderColor: 'var(--color-accent-green-border)', background: 'var(--color-accent-green-bg)', color: 'var(--color-accent-green-fg)' }
            : { borderColor: 'var(--color-border-primary)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }
        }
      >
        {completeness.complete ? (
          '✓ Every pair plays together and against each other at least once.'
        ) : (
          <div className="flex flex-col gap-1">
            {completeness.missingTeammatePairs.length > 0 && (
              <div>{completeness.missingTeammatePairs.length} pair{completeness.missingTeammatePairs.length === 1 ? '' : 's'} never teamed: {completeness.missingTeammatePairs.slice(0, 5).map(([a, b]) => `${playerName.get(a) ?? a} & ${playerName.get(b) ?? b}`).join(', ')}{completeness.missingTeammatePairs.length > 5 ? ', …' : ''}</div>
            )}
            {completeness.missingOpponentPairs.length > 0 && (
              <div>{completeness.missingOpponentPairs.length} pair{completeness.missingOpponentPairs.length === 1 ? '' : 's'} never opposed: {completeness.missingOpponentPairs.slice(0, 5).map(([a, b]) => `${playerName.get(a) ?? a} & ${playerName.get(b) ?? b}`).join(', ')}{completeness.missingOpponentPairs.length > 5 ? ', …' : ''}</div>
            )}
          </div>
        )}
      </div>

      {error && <div className="font-mono text-[12px] text-[var(--color-accent-red-fg)]">{error}</div>}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={busy || !integrity.ok}
          className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button
          type="button"
          onClick={confirmDraft}
          disabled={busy || !integrity.ok || !completeness.complete}
          className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40"
        >
          {confirming ? 'Confirming…' : 'Confirm Schedule'}
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-dotted disabled:opacity-40"
        >
          {generating ? 'Regenerating…' : 'Regenerate (discards edits)'}
        </button>
        <button
          type="button"
          onClick={clearDraft}
          disabled={busy}
          className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors underline decoration-dotted disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Clear Draft'}
        </button>
      </div>
    </div>
  );
}
