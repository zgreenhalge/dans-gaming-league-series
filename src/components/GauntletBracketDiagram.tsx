'use client';

import type { CSSProperties } from 'react';
import { PlayerName } from './PlayerName';
import type { BracketPod, BracketSlot } from '@/lib/queries';
import { capacityFor, groupLabel, ordinalWord, computeAdvanceOrdinals } from '@/lib/gauntlet-draft';

const POD_W = 232;
const HEADER_H = 28;
const ROW_H = 32;
const POD_H = HEADER_H + 4 * ROW_H;
const ROUND_GAP = 64;
const POD_GAP = 24;
const COLUMN_HEADER_H = 30;

type SlotStatus = 'champion' | 'advanced' | 'eliminated' | 'pending' | 'placeholder';

const STATUS_COLOR: Record<SlotStatus, string> = {
  champion: 'var(--color-accent-amber-strong)',
  advanced: 'var(--color-accent-green-fg)',
  eliminated: 'var(--color-text-secondary)',
  pending: 'var(--color-text-primary)',
  placeholder: 'var(--color-text-secondary)',
};

/** Describes a slot whose occupant isn't decided yet, without ever surfacing a bare "TBD" — a seed
 * slot names the seed, and a pod-sourced slot names the pod it comes from plus, for a pod that sends
 * more than one survivor onward, which of those survivors ("First"/"Second"/...) this slot expects.
 * `ordinal` is this slot's 0-based position among every slot fed by the same source pod, from
 * `computeAdvanceOrdinals()`. */
function pendingSlotLabel(slot: BracketSlot, sourcePod: BracketPod | undefined, ordinal: number): string {
  if (slot.source_kind === 'seed' && slot.source_seed != null) return `Seed ${slot.source_seed}`;
  if (slot.source_kind === 'pod' && sourcePod) {
    const name = groupLabel(sourcePod);
    if (capacityFor(sourcePod.advance_rule) <= 1) return `Winner of ${name}`;
    return `${ordinalWord(ordinal)} of ${name}`;
  }
  return 'TBD';
}

/** Overview flow diagram of a gauntlet bracket — one box per pod, grouped into columns by round,
 * with a connector line from a pod to every downstream pod a survivor advances into. Reads the
 * persisted `gauntlet_pods`/`gauntlet_pod_slots` shape (`getGauntletBracketShape()`), so it renders
 * identically whether the bracket is unseeded (placeholder "winner of ..." rows, dashed future
 * connectors), mid-play, or complete. `rankMap` is optional — pass `canonicalGauntletRankMap(rounds)`
 * to highlight the champion once the final round is fully played; omit it (e.g. for the pre-seed
 * preview, where no rounds exist yet) and the final pod's occupants just render as pending. */
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

  const podsById = new Map(pods.map((p) => [p.id, p]));

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

  // Stable ordinal position of every pod-sourced slot among all slots fed by the same source pod —
  // used by `pendingSlotLabel` to distinguish "Winner of ..." from "Second of ...".
  const advanceOrdinals = computeAdvanceOrdinals(pods);

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
    <div className="overflow-x-auto pb-3">
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
                  strokeWidth={resolved ? 2 : 1.25}
                  strokeDasharray={resolved ? undefined : '4 4'}
                  opacity={resolved ? 0.85 : 0.55}
                />
              );
            }),
          )}
        </svg>

        {rounds.map((r, ri) => (
          <div
            key={r}
            className="absolute tracked text-[11px] font-semibold text-[var(--color-text-secondary)]"
            style={{ left: ri * (POD_W + ROUND_GAP), top: 0, width: POD_W }}
          >
            {r === maxRound ? 'Final' : `Round ${r}`}
          </div>
        ))}

        {pods.map((pod) => {
          const pos = posByPodId.get(pod.id)!;
          const stakes = pod.is_final ? 'Championship' : pod.advance_rule === 'single' ? 'Elimination' : 'Wildcard';
          const isChampionPod =
            pod.is_final && !!rankMap && pod.slots.some((s) => s.player_id != null && rankMap.get(s.player_id) === 1);
          const accent = pod.is_final ? 'var(--color-accent-amber-strong)' : 'var(--color-site-accent)';
          return (
            <div
              key={pod.id}
              className="lift-card absolute border bg-[var(--color-bg-primary)]"
              style={
                {
                  left: pos.x,
                  top: pos.y,
                  width: POD_W,
                  height: POD_H,
                  borderWidth: pod.is_final ? 2 : 1,
                  borderColor: pod.is_final ? 'var(--color-accent-amber-border)' : 'var(--color-border-primary)',
                  boxShadow: isChampionPod
                    ? '0 0 0 1px var(--color-accent-amber-border), 0 6px 20px rgba(0,0,0,0.12)'
                    : undefined,
                  '--lift-accent': accent,
                } as CSSProperties
              }
            >
              <div
                className="tracked text-[9px] font-semibold px-2 flex items-center justify-between"
                style={{
                  height: HEADER_H,
                  color: pod.is_final ? 'var(--color-accent-amber-strong)' : 'var(--color-text-secondary)',
                  background: pod.is_final
                    ? 'color-mix(in srgb, var(--color-accent-amber-bg) 70%, var(--color-bg-primary))'
                    : 'var(--color-bg-secondary)',
                  borderBottom: '1px solid var(--color-border-tertiary)',
                }}
              >
                <span>{pod.is_final ? 'Final' : `Round ${pod.round_number} · Group ${pod.pod_index + 1}`}</span>
                <span className="opacity-70">{stakes}</span>
              </div>
              {pod.slots.map((slot) => {
                const status = slotStatus(pod, slot);
                const sourcePod = slot.source_pod_id != null ? podsById.get(slot.source_pod_id) : undefined;
                const ordinal = advanceOrdinals.get(`${pod.id}:${slot.slot_index}`) ?? 0;
                const isChampSlot = status === 'champion';
                return (
                  <div
                    key={slot.slot_index}
                    className="px-2 flex items-center font-mono truncate"
                    style={{
                      height: ROW_H,
                      color: STATUS_COLOR[status],
                      fontSize: slot.player_name ? 14 : 10,
                      fontWeight: isChampSlot ? 700 : 400,
                      letterSpacing: slot.player_name ? undefined : '0.02em',
                      textTransform: slot.player_name ? undefined : 'uppercase',
                      textShadow: isChampSlot
                        ? '0 0 10px color-mix(in srgb, var(--color-accent-amber-strong) 55%, transparent)'
                        : undefined,
                      background:
                        status === 'advanced'
                          ? 'color-mix(in srgb, var(--color-accent-green-bg) 45%, transparent)'
                          : isChampSlot
                            ? 'color-mix(in srgb, var(--color-accent-amber-bg) 55%, transparent)'
                            : undefined,
                      borderTop: slot.slot_index > 0 ? '1px solid var(--color-border-tertiary)' : undefined,
                    }}
                  >
                    {slot.player_name ? (
                      <PlayerName
                        name={slot.player_name}
                        isMe={currentPlayerId !== null && slot.player_id === currentPlayerId}
                      />
                    ) : (
                      <span className="opacity-70">{pendingSlotLabel(slot, sourcePod, ordinal)}</span>
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
