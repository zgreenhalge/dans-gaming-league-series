'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  validateDraftIntegrity,
  validateDraftCompleteness,
  type DraftScheduleWeek,
  type ValidationIssue,
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

/** A week counts as edited if its bye or any match slot differs from the last-saved draft it was
 * loaded from — matched by week_number/match_number rather than array position, since neither is
 * reorderable by the user but identity-by-key is the more robust comparison either way. Drives the
 * per-week "Edited" badge and the regenerate warning below. */
function isWeekEdited(week: DraftScheduleWeek, initialWeeks: DraftScheduleWeek[]): boolean {
  const original = initialWeeks.find((w) => w.week_number === week.week_number);
  if (!original) return true;
  if (original.bye_player_id !== week.bye_player_id) return true;
  if (original.matches.length !== week.matches.length) return true;

  const originalByMatch = new Map(original.matches.map((m) => [m.match_number, m]));
  return week.matches.some((m) => {
    const om = originalByMatch.get(m.match_number);
    if (!om) return true;
    return om.shirts[0] !== m.shirts[0] || om.shirts[1] !== m.shirts[1] || om.skins[0] !== m.skins[0] || om.skins[1] !== m.skins[1];
  });
}

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

/** Full roster in every dropdown — a player can legitimately occupy two slots the same week (a
 * doubleheader), so there's no exclusion across matches. Within one match, though, a player
 * already in one of its other 3 slots is shown greyed out (still visible, just unselectable) —
 * that would always be a self-paired match, which validateDraftIntegrity() would flag as an error
 * anyway, so it's caught here before the fact instead of after. */
function PlayerSelect({
  players,
  value,
  excludeIds,
  onChange,
}: {
  players: Player[];
  value: number;
  excludeIds: ReadonlySet<number>;
  onChange: (id: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="font-mono text-[12px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
    >
      {players.map((p) => (
        <option key={p.id} value={p.id} disabled={excludeIds.has(p.id)}>{p.name}</option>
      ))}
    </select>
  );
}

export function SeasonScheduleDraftEditor({ seasonId, players, initialWeeks }: Props) {
  const router = useRouter();
  const [weeks, setWeeks] = useState<DraftScheduleWeek[]>(initialWeeks);
  const [doubleheaderPolicy, setDoubleheaderPolicy] = useState<DoubleheaderPolicy>('auto');
  const [busyAction, setBusyAction] = useState<'generate' | 'save' | 'confirm' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playerName = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  const rosterPlayerIds = useMemo(() => players.map((p) => p.id), [players]);
  const integrity = useMemo(() => validateDraftIntegrity(weeks), [weeks]);
  const completeness = useMemo(() => validateDraftCompleteness(weeks, rosterPlayerIds), [weeks, rosterPlayerIds]);

  // Grouped by week_number so each week/match can render only the issues that concern it, instead
  // of one dump at the bottom of the page.
  const issuesByWeek = useMemo(() => {
    const map = new Map<number, ValidationIssue[]>();
    for (const issue of integrity.issues) {
      const arr = map.get(issue.week_number) ?? [];
      arr.push(issue);
      map.set(issue.week_number, arr);
    }
    return map;
  }, [integrity.issues]);

  const editedWeekNumbers = useMemo(
    () => weeks.filter((w) => isWeekEdited(w, initialWeeks)).map((w) => w.week_number),
    [weeks, initialWeeks],
  );

  const busy = busyAction !== null;

  /** Shared fetch/parse/error-report shape behind all four mutation actions below — returns the
   * parsed body on success, or null (having already called setError) on failure. */
  async function callApi(url: string, options: RequestInit, fallbackError: string): Promise<Record<string, unknown> | null> {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((body as { error?: string }).error ?? fallbackError);
      return null;
    }
    return body;
  }

  async function generate() {
    setBusyAction('generate');
    setError(null);
    try {
      const body = await callApi(
        `/api/seasons/${seasonId}/schedule`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doubleheaderPolicy }) },
        'Failed to generate the schedule.',
      );
      if (body) router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  /** PATCHes the current `weeks` state. Shared by save() and confirmDraft() — confirm operates on
   * the *persisted* draft, not this component's state, so it must save first or it would silently
   * materialize whatever was last saved instead of what's on screen. */
  async function saveDraft(): Promise<boolean> {
    const body = await callApi(
      `/api/seasons/${seasonId}/schedule`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeks }) },
      'Failed to save the draft.',
    );
    return body !== null;
  }

  async function save() {
    setBusyAction('save');
    setError(null);
    try {
      if (await saveDraft()) router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDraft() {
    setBusyAction('confirm');
    setError(null);
    try {
      if (!(await saveDraft())) return;

      const body = await callApi(`/api/seasons/${seasonId}/schedule/confirm`, { method: 'POST' }, 'Failed to confirm the schedule.');
      if (body) router.push(`/seasons/${seasonId}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function clearDraft() {
    setBusyAction('clear');
    setError(null);
    try {
      const body = await callApi(`/api/seasons/${seasonId}/schedule`, { method: 'DELETE' }, 'Failed to clear the draft.');
      if (body) router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  if (weeks.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          No schedule yet — generate one from the current roster ({players.length} players).
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
          {busyAction === 'generate' ? 'Generating…' : 'Generate Schedule'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {weeks.map((week) => {
          const weekIssues = issuesByWeek.get(week.week_number) ?? [];
          const weekLevelIssues = weekIssues.filter((i) => i.match_number == null);
          const edited = editedWeekNumbers.includes(week.week_number);
          return (
            <div key={week.week_number} className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="tracked text-[9px] text-[var(--color-text-secondary)]">Week {week.week_number}</div>
                  {edited && (
                    <span
                      className="tracked text-[8px] px-1.5 py-0.5 border"
                      style={{ borderColor: 'var(--color-accent-amber-border)', background: 'var(--color-accent-amber-bg)', color: 'var(--color-accent-amber-fg)' }}
                    >
                      Edited
                    </span>
                  )}
                </div>
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

              {weekLevelIssues.length > 0 && (
                <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] flex flex-col gap-0.5">
                  {weekLevelIssues.map((issue, i) => (
                    <div key={i}>{issue.message}</div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2">
                {week.matches.map((m) => {
                  const onSlotChange = (slot: SlotKey) => (id: number) =>
                    setWeeks((prev) => prev.map((w) => (w.week_number === week.week_number ? updateMatchSlot(w, m.match_number, slot, id) : w)));
                  // Every other slot in *this* match — never this match's own value, so a slot's
                  // current selection always stays selectable, but each other occupied slot is
                  // excluded from the rest (self-pairing within one match makes no sense).
                  const slotValues: Record<SlotKey, number> = { shirts0: m.shirts[0], shirts1: m.shirts[1], skins0: m.skins[0], skins1: m.skins[1] };
                  const excludeFor = (slot: SlotKey) =>
                    new Set(Object.entries(slotValues).filter(([k]) => k !== slot).map(([, id]) => id));
                  const matchIssues = weekIssues.filter((i) => i.match_number === m.match_number);
                  return (
                    <div key={m.match_number} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-[var(--color-text-secondary)]">
                        <span className="tracked text-[9px] w-14 shrink-0">Match {m.match_number}</span>
                        <PlayerSelect players={players} value={m.shirts[0]} excludeIds={excludeFor('shirts0')} onChange={onSlotChange('shirts0')} />
                        <PlayerSelect players={players} value={m.shirts[1]} excludeIds={excludeFor('shirts1')} onChange={onSlotChange('shirts1')} />
                        <span>vs</span>
                        <PlayerSelect players={players} value={m.skins[0]} excludeIds={excludeFor('skins0')} onChange={onSlotChange('skins0')} />
                        <PlayerSelect players={players} value={m.skins[1]} excludeIds={excludeFor('skins1')} onChange={onSlotChange('skins1')} />
                      </div>
                      {matchIssues.length > 0 && (
                        <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] pl-16 flex flex-col gap-0.5">
                          {matchIssues.map((issue, i) => (
                            <div key={i}>{issue.message}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="font-mono text-[12px] px-3 py-2 border"
        style={
          completeness.complete
            ? { borderColor: 'var(--color-accent-green-border)', background: 'var(--color-accent-green-bg)', color: 'var(--color-accent-green-fg)' }
            : { borderColor: 'var(--color-accent-red-border)', background: 'var(--color-accent-red-bg)', color: 'var(--color-accent-red-fg)' }
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

      {editedWeekNumbers.length > 0 && (
        <div className="font-mono text-[11px]" style={{ color: 'var(--color-accent-amber-fg)' }}>
          Regenerating will discard your edits to week{editedWeekNumbers.length === 1 ? '' : 's'} {editedWeekNumbers.join(', ')}.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={busy || !integrity.ok}
          className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40"
        >
          {busyAction === 'save' ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={confirmDraft}
          disabled={busy || !integrity.ok || !completeness.complete}
          className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40"
        >
          {busyAction === 'confirm' ? 'Confirming…' : 'Confirm Schedule'}
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-dotted disabled:opacity-40"
        >
          {busyAction === 'generate' ? 'Regenerating…' : 'Regenerate (discards edits)'}
        </button>
        <button
          type="button"
          onClick={clearDraft}
          disabled={busy}
          className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors underline decoration-dotted disabled:opacity-40"
        >
          {busyAction === 'clear' ? 'Clearing…' : 'Clear Schedule'}
        </button>
      </div>
    </div>
  );
}
