'use client';

import { PlayerName } from './PlayerName';
import type { BracketPod, BracketSlot } from '@/lib/queries';

const POD_W = 176;
const HEADER_H = 22;
const ROW_H = 19;
const POD_H = HEADER_H + 4 * ROW_H;
const ROUND_GAP = 48;
const POD_GAP = 16;
const COLUMN_HEADER_H = 24;

type SlotStatus = 'champion' | 'advanced' | 'eliminated' | 'pending' | 'placeholder';

const STATUS_COLOR: Record<SlotStatus, string> = {
  champion: 'var(--color-accent-amber-strong)',
  advanced: 'var(--color-accent-green-fg)',
  eliminated: 'var(--color-text-secondary)',
  pending: 'var(--color-text-primary)',
  placeholder: 'var(--color-text-secondary)',
};

function slotLabel(slot: BracketSlot): string {
  if (slot.player_name) return slot.player_name;
  if (slot.source_kind === 'seed' && slot.source_seed != null) return `Seed ${slot.source_seed}`;
  return 'TBD';
}

/** Overview flow diagram of a gauntlet bracket — one box per pod, grouped into columns by round,
 * with a connector line from a pod to every downstream pod a survivor advances into. Reads the
 * persisted `gauntlet_pods`/`gauntlet_pod_slots` shape (`getGauntletBracketShape()`), so it renders
 * identically whether the bracket is unseeded (placeholder "Seed N" rows, dashed future connectors),
 * mid-play, or complete. `rankMap` is optional — pass `canonicalGauntletRankMap(rounds)` to highlight
 * the champion once the final round is fully played; omit it (e.g. for the pre-seed preview, where
 * no rounds exist yet) and the final pod's occupants just render as pending. */
export function GauntletBracketDiagram({
  pods,
  currentPlayerId,
  rankMap,
}: {
  pods: BracketPod[];
  currentPlayerId: number | null;
  rankMap?: Map<number, number>;
}) {
  if (pods.length === 0) return null;

  const rounds = Array.from(new Set(pods.map((p) => p.round_number))).sort((a, b) => a - b);
  const podsByRound = new Map<number, BracketPod[]>();
  for (const r of rounds) {
    podsByRound.set(
      r,
      pods.filter((p) => p.round_number === r).sort((a, b) => a.pod_index - b.pod_index),
    );
  }
  const maxPodsInRound = Math.max(...rounds.map((r) => podsByRound.get(r)!.length));
  const width = rounds.length * POD_W + (rounds.length - 1) * ROUND_GAP;
  const height = COLUMN_HEADER_H + maxPodsInRound * POD_H + (maxPodsInRound - 1) * POD_GAP;

  const posByPodId = new Map<number, { x: number; y: number }>();
  rounds.forEach((r, ri) => {
    podsByRound.get(r)!.forEach((p, pi) => {
      posByPodId.set(p.id, {
        x: ri * (POD_W + ROUND_GAP),
        y: COLUMN_HEADER_H + pi * (POD_H + POD_GAP),
      });
    });
  });

  // A (source pod, player) pair is here iff that player's advancement out of that pod has already
  // been resolved into a downstream slot — i.e. they survived that pod.
  const advancedFromPod = new Set<string>();
  for (const p of pods) {
    for (const s of p.slots) {
      if (s.source_kind === 'pod' && s.source_pod_id != null && s.player_id != null) {
        advancedFromPod.add(`${s.source_pod_id}:${s.player_id}`);
      }
    }
  }

  function slotStatus(pod: BracketPod, slot: BracketSlot): SlotStatus {
    if (slot.player_id == null) return 'placeholder';
    if (pod.is_final) {
      if (rankMap && rankMap.get(slot.player_id) === 1) return 'champion';
      return pod.played ? 'eliminated' : 'pending';
    }
    if (advancedFromPod.has(`${pod.id}:${slot.player_id}`)) return 'advanced';
    return pod.played ? 'eliminated' : 'pending';
  }

  const maxRound = rounds[rounds.length - 1];

  return (
    <div className="overflow-x-auto pb-2">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0 pointer-events-none">
          {pods.map((pod) =>
            pod.slots.map((slot) => {
              if (slot.source_kind !== 'pod' || slot.source_pod_id == null) return null;
              const from = posByPodId.get(slot.source_pod_id);
              const to = posByPodId.get(pod.id);
              if (!from || !to) return null;
              const x1 = from.x + POD_W;
              const y1 = from.y + HEADER_H + 2 * ROW_H;
              const x2 = to.x;
              const y2 = to.y + HEADER_H + slot.slot_index * ROW_H + ROW_H / 2;
              const midX = (x1 + x2) / 2;
              const resolved = slot.player_id != null;
              return (
                <path
                  key={`${pod.id}-${slot.slot_index}`}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={resolved ? 'var(--color-accent-green-fg)' : 'var(--color-border-secondary)'}
                  strokeWidth={resolved ? 1.5 : 1}
                  strokeDasharray={resolved ? undefined : '3 3'}
                  opacity={resolved ? 0.7 : 0.5}
                />
              );
            }),
          )}
        </svg>

        {rounds.map((r, ri) => (
          <div
            key={r}
            className="absolute tracked text-[9px] text-[var(--color-text-secondary)]"
            style={{ left: ri * (POD_W + ROUND_GAP), top: 0, width: POD_W }}
          >
            {r === maxRound ? 'Final' : `Round ${r}`}
          </div>
        ))}

        {pods.map((pod) => {
          const pos = posByPodId.get(pod.id)!;
          const stakes = pod.is_final ? 'Final' : pod.advance_rule === 'single' ? 'Elimination' : 'Wildcard';
          return (
            <div
              key={pod.id}
              className="absolute border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]"
              style={{ left: pos.x, top: pos.y, width: POD_W, height: POD_H }}
            >
              <div
                className="tracked text-[8px] text-[var(--color-text-secondary)] px-1.5 flex items-center bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-tertiary)]"
                style={{ height: HEADER_H }}
              >
                {stakes}
              </div>
              {pod.slots.map((slot) => {
                const status = slotStatus(pod, slot);
                return (
                  <div
                    key={slot.slot_index}
                    className="px-1.5 flex items-center font-mono text-[11px] truncate"
                    style={{ height: ROW_H, color: STATUS_COLOR[status] }}
                  >
                    {slot.player_name ? (
                      <PlayerName
                        name={slot.player_name}
                        isMe={currentPlayerId !== null && slot.player_id === currentPlayerId}
                      />
                    ) : (
                      <span className="opacity-70">{slotLabel(slot)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
