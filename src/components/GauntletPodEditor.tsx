'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GauntletBracketDiagram } from './GauntletBracketDiagram';
import {
  type DraftPod,
  type DraftSlot,
  type AdvanceRule,
  capacityFor,
  emptyDraftPod,
  groupLabel,
  availablePlayers,
  availableAdvancements,
  pruneInvalidReferences,
  validateIntegrity,
  validateComplete,
  draftToPreviewPods,
} from '@/lib/gauntlet-draft';

interface Player {
  id: number;
  name: string;
}

interface Props {
  regularSeasonId: number;
  players: Player[];
  initialPods: DraftPod[];
}

function newPodKey(): string {
  return `new-${crypto.randomUUID()}`;
}

/** Strips a single slot's current value out of the draft before computing what's "available" for
 * it — otherwise a slot's own player/advancement would look already-claimed by someone else and
 * vanish from its own picker. */
function optionsExcludingSlot(pods: DraftPod[], podKey: string, slotIndex: number) {
  return pods.map((p) =>
    p.key !== podKey
      ? p
      : { ...p, slots: p.slots.map((s, i): DraftSlot => (i === slotIndex ? { kind: 'empty' } : s)) },
  );
}

export function GauntletPodEditor({ regularSeasonId, players, initialPods }: Props) {
  const router = useRouter();
  const [pods, setPods] = useState<DraftPod[]>(initialPods);
  const [droppedIds, setDroppedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playerNameById = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);
  const integrity = useMemo(() => validateIntegrity(pods), [pods]);
  const complete = useMemo(() => validateComplete(pods), [pods]);
  const previewPods = useMemo(() => draftToPreviewPods(pods, playerNameById), [pods, playerNameById]);

  const maxRound = pods.length > 0 ? Math.max(...pods.map((p) => p.round_number)) : 0;

  function apply(next: DraftPod[]) {
    setPods(pruneInvalidReferences(next));
  }

  function addPod(round_number: number) {
    const podIndex = pods.filter((p) => p.round_number === round_number).length;
    apply([...pods, emptyDraftPod(newPodKey(), round_number, podIndex)]);
  }

  function deletePod(key: string) {
    apply(pods.filter((p) => p.key !== key));
  }

  function setAdvanceRule(key: string, rule: AdvanceRule) {
    apply(
      pods.map((p) => (p.key === key && !p.materialized ? { ...p, advance_rule: rule } : p)),
    );
  }

  function setFinal(key: string, isFinal: boolean) {
    apply(
      pods.map((p) => {
        if (p.materialized) return p;
        if (p.key === key) return { ...p, is_final: isFinal, advance_rule: isFinal ? 'single' : p.advance_rule };
        return isFinal && p.is_final ? { ...p, is_final: false } : p;
      }),
    );
  }

  function updateSlot(key: string, slotIndex: number, slot: DraftSlot) {
    apply(
      pods.map((p) => {
        if (p.key !== key || p.materialized) return p;
        const slots = [...p.slots];
        slots[slotIndex] = slot;
        return { ...p, slots };
      }),
    );
  }

  function toggleDropped(playerId: number) {
    setDroppedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${regularSeasonId}/gauntlet/pods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pods }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to save the bracket.');
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const availableRosterPlayers = players.filter((p) => !droppedIds.has(p.id));

  return (
    <div className="flex flex-col gap-8">
      {previewPods.length > 0 && <GauntletBracketDiagram pods={previewPods} currentPlayerId={null} />}

      <div
        className="font-mono text-[12px] px-3 py-2 border"
        style={
          complete.complete
            ? {
                borderColor: 'var(--color-accent-green-border)',
                background: 'var(--color-accent-green-bg)',
                color: 'var(--color-accent-green-fg)',
              }
            : {
                borderColor: 'var(--color-border-primary)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-secondary)',
              }
        }
      >
        {complete.complete ? (
          '✓ Bracket complete — reduces to one Final.'
        ) : (
          <ul className="list-disc list-inside">
            {complete.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-2">
          Roster — mark anyone sitting out this gauntlet
        </div>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => {
            const dropped = droppedIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleDropped(p.id)}
                className="tracked text-[10px] font-semibold px-2 py-1 border transition-colors"
                style={
                  dropped
                    ? {
                        borderColor: 'var(--color-accent-red-border)',
                        background: 'var(--color-accent-red-bg)',
                        color: 'var(--color-accent-red-fg)',
                        textDecoration: 'line-through',
                      }
                    : {
                        borderColor: 'var(--color-border-primary)',
                        color: 'var(--color-text-secondary)',
                      }
                }
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="tracked text-[10px] text-[var(--color-text-secondary)]">Pods</div>
        {pods.length === 0 && (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No pods yet.</div>
        )}
        {pods.map((pod) => (
          <PodCard
            key={pod.key}
            pod={pod}
            pods={pods}
            players={availableRosterPlayers}
            droppedIds={droppedIds}
            onDelete={() => deletePod(pod.key)}
            onSetAdvanceRule={(rule) => setAdvanceRule(pod.key, rule)}
            onSetFinal={(v) => setFinal(pod.key, v)}
            onUpdateSlot={(i, slot) => updateSlot(pod.key, i, slot)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => addPod(maxRound || 1)}
          className="tracked text-[10px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
        >
          Add to Round {maxRound || 1}
        </button>
        <button
          type="button"
          onClick={() => addPod((maxRound || 0) + 1)}
          className="tracked text-[10px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
        >
          Add to Round {(maxRound || 0) + 1}
        </button>
      </div>

      {!integrity.valid && (
        <div className="font-mono text-[12px] text-[var(--color-accent-red-fg)]">
          {integrity.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {error && <div className="font-mono text-[12px] text-[var(--color-accent-red-fg)]">{error}</div>}

      <button
        type="button"
        onClick={save}
        disabled={saving || !integrity.valid || pods.length === 0}
        className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all disabled:opacity-40 self-start"
      >
        {saving ? 'Saving…' : 'Save Bracket'}
      </button>
    </div>
  );
}

function PodCard({
  pod,
  pods,
  players,
  droppedIds,
  onDelete,
  onSetAdvanceRule,
  onSetFinal,
  onUpdateSlot,
}: {
  pod: DraftPod;
  pods: DraftPod[];
  players: Player[];
  droppedIds: Set<number>;
  onDelete: () => void;
  onSetAdvanceRule: (rule: AdvanceRule) => void;
  onSetFinal: (v: boolean) => void;
  onUpdateSlot: (slotIndex: number, slot: DraftSlot) => void;
}) {
  const capacity = capacityFor(pod.advance_rule);

  if (pod.materialized) {
    return (
      <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] px-4 py-3">
        <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-2">
          {groupLabel(pod)} — locked (matches already exist)
        </div>
        <div className="font-mono text-[12px] flex flex-col gap-0.5">
          {pod.slots.map((slot, i) => (
            <div key={i}>{slot.kind === 'player' ? (players.find((p) => p.id === slot.playerId)?.name ?? `Player ${slot.playerId}`) : '—'}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="tracked text-[9px] text-[var(--color-text-secondary)]">{groupLabel(pod)}</div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {(['single', 'wildcard'] as AdvanceRule[]).map((rule) => (
              <button
                key={rule}
                type="button"
                disabled={pod.is_final}
                onClick={() => onSetAdvanceRule(rule)}
                className="tracked text-[9px] font-semibold px-2 py-1 border transition-colors disabled:opacity-40"
                style={
                  pod.advance_rule === rule
                    ? {
                        borderColor: 'var(--color-site-accent)',
                        background: 'color-mix(in srgb, var(--color-site-accent) 12%, transparent)',
                        color: 'var(--color-text-primary)',
                      }
                    : { borderColor: 'var(--color-border-primary)', color: 'var(--color-text-secondary)' }
                }
              >
                {rule === 'single' ? '1 advances' : '3 advance'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={pod.is_final} onChange={(e) => onSetFinal(e.target.checked)} />
            Final
          </label>
          <button
            type="button"
            onClick={onDelete}
            className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors underline decoration-dotted"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {pod.slots.map((slot, i) => (
          <SlotPicker
            key={i}
            pods={pods}
            podKey={pod.key}
            slotIndex={i}
            slot={slot}
            players={players}
            droppedIds={droppedIds}
            onChange={(s) => onUpdateSlot(i, s)}
          />
        ))}
      </div>
      {pod.is_final === false && (
        <div className="font-mono text-[9px] text-[var(--color-text-secondary)] opacity-70">
          Sends {capacity} survivor{capacity === 1 ? '' : 's'} onward.
        </div>
      )}
    </div>
  );
}

function slotValueKey(slot: DraftSlot): string {
  if (slot.kind === 'player') return `player:${slot.playerId}`;
  if (slot.kind === 'advance') return `advance:${slot.sourcePodKey}:${slot.ordinal}`;
  return '';
}

function SlotPicker({
  pods,
  podKey,
  slotIndex,
  slot,
  players,
  droppedIds,
  onChange,
}: {
  pods: DraftPod[];
  podKey: string;
  slotIndex: number;
  slot: DraftSlot;
  players: Player[];
  droppedIds: Set<number>;
  onChange: (slot: DraftSlot) => void;
}) {
  const stripped = optionsExcludingSlot(pods, podKey, slotIndex);
  const playerOptions = availablePlayers(stripped, players, droppedIds);
  const advanceOptions = availableAdvancements(stripped);

  return (
    <select
      value={slotValueKey(slot)}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return onChange({ kind: 'empty' });
        if (v.startsWith('player:')) return onChange({ kind: 'player', playerId: Number(v.slice('player:'.length)) });
        const rest = v.slice('advance:'.length);
        const lastColon = rest.lastIndexOf(':');
        return onChange({ kind: 'advance', sourcePodKey: rest.slice(0, lastColon), ordinal: Number(rest.slice(lastColon + 1)) });
      }}
      className="font-mono text-[12px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
    >
      <option value="">— empty —</option>
      {playerOptions.length > 0 && (
        <optgroup label="Players">
          {playerOptions.map((p) => (
            <option key={p.id} value={`player:${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {advanceOptions.length > 0 && (
        <optgroup label="Advancements">
          {advanceOptions.map((a) => (
            <option key={`${a.sourcePodKey}:${a.ordinal}`} value={`advance:${a.sourcePodKey}:${a.ordinal}`}>
              {a.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
