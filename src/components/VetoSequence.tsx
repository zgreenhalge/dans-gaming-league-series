'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { mapImageFor } from '@/lib/maps';
import type { Match } from '@/lib/types';

const REGULAR_STEPS = [
  { field: 'shirts_ban', label: 'Shirts ban', type: 'ban' },
  { field: 'skins_ban1', label: 'Skins ban', type: 'ban' },
  { field: 'skins_ban2', label: 'Skins ban', type: 'ban' },
  { field: 'shirts_pick', label: 'Map pick', type: 'pick' },
  { field: 'skins_starting_side', label: 'Skins side', type: 'side' },
] as const;

const PLAYOFF_STEPS = [
  { field: 'shirts_ban', label: 'Shirts ban', type: 'ban' },
  { field: 'shirts_ban2', label: 'Shirts ban', type: 'ban' },
  { field: 'skins_ban1', label: 'Skins ban', type: 'ban' },
  { field: 'skins_ban2', label: 'Skins ban', type: 'ban' },
] as const;

const GAUNTLET_STEPS = [
  { field: 'shirts_ban', label: 'Shirts ban', type: 'ban' },
  { field: 'skins_ban1', label: 'Skins ban', type: 'ban' },
  { field: 'shirts_ban2', label: 'Shirts ban', type: 'ban' },
  { field: 'skins_ban2', label: 'Skins ban', type: 'ban' },
] as const;

type StepField =
  | 'shirts_ban'
  | 'shirts_ban2'
  | 'skins_ban1'
  | 'skins_ban2'
  | 'shirts_pick'
  | 'skins_starting_side';

function getSteps(match: Match, isGauntlet: boolean) {
  if (isGauntlet) return GAUNTLET_STEPS;
  if (match.is_playoff_game) return PLAYOFF_STEPS;
  return REGULAR_STEPS;
}

function getFieldValue(match: Match, field: StepField): string | null {
  return match[field as keyof Match] as string | null;
}

function usedMaps(match: Match): string[] {
  return [
    match.shirts_ban,
    match.shirts_ban2,
    match.skins_ban1,
    match.skins_ban2,
    match.shirts_pick,
  ].filter((v): v is string => v !== null);
}

interface Props {
  match: Match;
  mapPool: string[] | null;
  canVeto: boolean;
  isGauntlet: boolean;
}

export default function VetoSequence({ match, mapPool, canVeto, isGauntlet }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeField, setActiveField] = useState<StepField | null>(null);
  const [error, setError] = useState<string | null>(null);

  const steps = getSteps(match, isGauntlet);

  const side = match.skins_starting_side;
  const sideCls =
    side === 'CT'
      ? 'bg-[var(--color-accent-blue-bg)] border-[var(--color-accent-blue-border)] [&_.lbl]:text-[var(--color-accent-blue-fg)] [&_.val]:text-[var(--color-accent-blue-strong)]'
      : side === 'T'
        ? 'bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)] [&_.lbl]:text-[var(--color-accent-amber-fg)] [&_.val]:text-[var(--color-accent-amber-strong)]'
        : 'bg-[var(--color-bg-secondary)] border-[var(--color-border-tertiary)] [&_.lbl]:text-[var(--color-text-secondary)] [&_.val]:text-[var(--color-text-primary)]';
  const banCls =
    'bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)] [&_.lbl]:text-[var(--color-accent-green-fg)] [&_.val]:text-[var(--color-accent-green-strong)]';
  const pickCls =
    'bg-[var(--color-accent-green-bg)] border-2 border-[var(--color-accent-amber-pickborder)] [&_.lbl]:text-[var(--color-accent-green-fg)] [&_.val]:text-[var(--color-accent-green-strong)]';
  const pendingCls =
    'bg-[var(--color-bg-secondary)] border-dashed border-[var(--color-border-tertiary)] [&_.lbl]:text-[var(--color-text-secondary)] [&_.val]:text-[var(--color-text-secondary)]';

  function tileCls(step: { field: string; type: string }, val: string | null, isNext: boolean) {
    if (val !== null) {
      if (step.type === 'side') return sideCls;
      if (step.type === 'pick') return pickCls;
      return banCls;
    }
    if (isNext && canVeto) return `${pendingCls} cursor-pointer hover:border-[var(--color-border-secondary)]`;
    return pendingCls;
  }

  // Determine the next pending field
  const nextField = steps.find((s) => getFieldValue(match, s.field as StepField) === null)?.field as
    | StepField
    | undefined;

  // For playoff/gauntlet: show auto-picked map tile
  const isPlayoffOrGauntlet = match.is_playoff_game || isGauntlet;
  const autoPickedMap = isPlayoffOrGauntlet ? (match.shirts_pick ?? match.picked_map) : null;

  async function submitVeto(field: StepField, value: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/matches/${match.id}/veto`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? 'Something went wrong');
        return;
      }
      setActiveField(null);
      router.refresh();
    });
  }

  function handleTileClick(field: StepField) {
    if (!canVeto || field !== nextField) return;
    setActiveField(activeField === field ? null : field);
    setError(null);
  }

  const pool = mapPool ?? [];
  const banned = usedMaps(match);

  return (
    <div>
      <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
        <div className="flex items-stretch gap-1 flex-wrap p-3">
          {steps.map((s, i) => {
            const val = getFieldValue(match, s.field as StepField);
            const isNext = s.field === nextField;
            const isActive = activeField === s.field;
            return (
              <span key={s.field} className="flex items-center gap-1 flex-1 min-w-[88px]">
                {i > 0 && (
                  <span className="text-[var(--color-text-secondary)] text-sm shrink-0 font-mono">
                    ›
                  </span>
                )}
                <div
                  className={`flex-1 min-w-[88px] px-2.5 py-2 border transition-colors ${tileCls(s, val, isNext)} ${isActive ? 'ring-1 ring-[var(--color-accent-amber-pickborder)]' : ''}`}
                  onClick={() => handleTileClick(s.field as StepField)}
                  role={isNext && canVeto && val === null ? 'button' : undefined}
                  aria-expanded={isActive}
                >
                  <div className="lbl tracked text-[9px] font-semibold mb-0.5 flex items-center gap-1">
                    {s.label}
                    {isNext && canVeto && val === null && (
                      <span className="opacity-50">+</span>
                    )}
                  </div>
                  <div className="val font-display text-[14px] font-semibold leading-tight">
                    {val ?? '—'}
                  </div>
                </div>
              </span>
            );
          })}

          {/* Auto-picked map tile for playoff/gauntlet */}
          {isPlayoffOrGauntlet && (
            <span className="flex items-center gap-1 flex-1 min-w-[88px]">
              <span className="text-[var(--color-text-secondary)] text-sm shrink-0 font-mono">›</span>
              <div className={`flex-1 min-w-[88px] px-2.5 py-2 border ${autoPickedMap ? pickCls : pendingCls}`}>
                <div className="lbl tracked text-[9px] font-semibold mb-0.5">Map pick</div>
                <div className="val font-display text-[14px] font-semibold leading-tight">
                  {autoPickedMap ?? '—'}
                </div>
              </div>
            </span>
          )}
        </div>
      </div>

      {/* Map selection panel */}
      {activeField && canVeto && (
        <div className="mt-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-3">
          {error && (
            <p className="text-[var(--color-accent-red-fg,#ef4444)] text-[12px] mb-3">{error}</p>
          )}

          {activeField === 'skins_starting_side' ? (
            <div className="flex gap-2">
              {(['CT', 'T'] as const).map((side) => (
                <button
                  key={side}
                  disabled={isPending}
                  onClick={() => submitVeto('skins_starting_side', side)}
                  className={`flex-1 py-3 border font-display font-semibold text-[15px] transition-colors disabled:opacity-50 ${
                    side === 'CT'
                      ? 'bg-[var(--color-accent-blue-bg)] border-[var(--color-accent-blue-border)] text-[var(--color-accent-blue-strong)] hover:bg-[var(--color-accent-blue-border)]'
                      : 'bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-strong)] hover:bg-[var(--color-accent-amber-border)]'
                  }`}
                >
                  {side}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {[...pool].sort((a, b) => a.localeCompare(b)).map((map) => {
                const img = mapImageFor(map);
                const isUsed = banned.includes(map);
                return (
                  <button
                    key={map}
                    disabled={isPending || isUsed}
                    onClick={() => !isUsed && submitVeto(activeField, map)}
                    className={`relative flex-1 min-w-[80px] h-[72px] border overflow-hidden transition-opacity ${
                      isUsed
                        ? 'opacity-40 cursor-not-allowed border-[var(--color-border-tertiary)]'
                        : 'border-[var(--color-border-primary)] hover:border-[var(--color-accent-amber-pickborder)] cursor-pointer'
                    } disabled:opacity-40`}
                    title={map}
                  >
                    {img && (
                      <img
                        src={img}
                        alt={map}
                        className={`absolute inset-0 w-full h-full object-cover ${isUsed ? 'grayscale' : ''}`}
                      />
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-end p-1.5">
                      <span
                        className={`font-display font-semibold text-[11px] leading-tight text-white ${isUsed ? 'line-through opacity-70' : ''}`}
                      >
                        {map}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {isPending && (
            <p className="text-[var(--color-text-secondary)] text-[11px] mt-2">Saving…</p>
          )}
        </div>
      )}
    </div>
  );
}
