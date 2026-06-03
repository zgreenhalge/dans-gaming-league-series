'use client';

import Link from 'next/link';
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase';
import { mapImageFor, mapSlug, toSentenceCase } from '@/lib/maps';
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

// Simultaneous: each player bans their own slot independently; displayed in this order
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
  playerFaction: 'SHIRTS' | 'SKINS' | null;
  gauntletPlayerIndex: 0 | 1 | null;
  isAdmin: boolean;
}

export default function VetoSequence({ match, mapPool, canVeto, isGauntlet, playerFaction, gauntletPlayerIndex, isAdmin }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeField, setActiveField] = useState<StepField | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const channel = getBrowserClient()
      .channel(`match-veto-${match.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${match.id}` },
        () => { router.refresh(); },
      )
      .subscribe();
    return () => { getBrowserClient().removeChannel(channel); };
  }, [match.id, router]);

  const steps = getSteps(match, isGauntlet);

  const side = match.skins_starting_side;
  const sideCls =
    side === 'CT'
      ? 'bg-[var(--color-accent-blue-bg)] border-[var(--color-accent-blue-border)] [&_.lbl]:text-[var(--color-accent-blue-fg)] [&_.val]:text-[var(--color-accent-blue-strong)]'
      : side === 'T'
        ? 'bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)] [&_.lbl]:text-[var(--color-accent-amber-fg)] [&_.val]:text-[var(--color-accent-amber-strong)]'
        : 'bg-[var(--color-bg-secondary)] border-[var(--color-border-tertiary)] [&_.lbl]:text-[var(--color-text-secondary)] [&_.val]:text-[var(--color-text-primary)]';
  const lockedBanCls =
    'relative overflow-hidden border-2 border-[var(--color-accent-red-fg)] [&_.lbl]:text-white/60 [&_.val]:text-white';
  const pickCls =
    'bg-[var(--color-accent-green-bg)] border-2 border-[var(--color-accent-amber-pickborder)] [&_.lbl]:text-[var(--color-accent-green-fg)] [&_.val]:text-[var(--color-accent-green-strong)]';
  const pendingCls =
    'bg-[var(--color-bg-secondary)] border-dashed border-[var(--color-border-tertiary)] [&_.lbl]:text-[var(--color-text-secondary)] [&_.val]:text-[var(--color-text-secondary)]';
  const nextCls =
    'bg-[var(--color-bg-secondary)] border border-[var(--color-accent-amber-pickborder)] [&_.lbl]:text-[var(--color-accent-amber-fg)] [&_.val]:text-[var(--color-text-secondary)]';

  // For non-gauntlet: the first unfilled step in sequence order
  const sequenceNextField = steps.find((s) => getFieldValue(match, s.field as StepField) === null)?.field as
    | StepField
    | undefined;

  // The field the current player can act on for NEW entries (unfilled slots)
  const actionableField: StepField | undefined = (() => {
    if (!canVeto) return undefined;
    if (isGauntlet) {
      if (isAdmin) return sequenceNextField;
      if (!playerFaction || gauntletPlayerIndex === null) return undefined;
      const myField: StepField =
        playerFaction === 'SHIRTS'
          ? (gauntletPlayerIndex === 0 ? 'shirts_ban' : 'shirts_ban2')
          : (gauntletPlayerIndex === 0 ? 'skins_ban1' : 'skins_ban2');
      return getFieldValue(match, myField) === null ? myField : undefined;
    }
    if (!sequenceNextField) return undefined;
    if (isAdmin) return sequenceNextField;
    if (!playerFaction) return undefined;
    const stepFaction = sequenceNextField.startsWith('shirts_') ? 'SHIRTS' : 'SKINS';
    return playerFaction === stepFaction ? sequenceNextField : undefined;
  })();

  // Whether a filled tile can be overwritten by the current user
  function isOverwritable(field: StepField): boolean {
    if (!canVeto) return false;
    if (isAdmin) return true;
    if (isGauntlet) {
      if (!playerFaction || gauntletPlayerIndex === null) return false;
      const myField: StepField =
        playerFaction === 'SHIRTS'
          ? (gauntletPlayerIndex === 0 ? 'shirts_ban' : 'shirts_ban2')
          : (gauntletPlayerIndex === 0 ? 'skins_ban1' : 'skins_ban2');
      return field === myField;
    }
    if (!playerFaction) return false;
    const fieldFaction = field.startsWith('shirts_') ? 'SHIRTS' : 'SKINS';
    return fieldFaction === playerFaction;
  }

  function tileCls(step: { field: string; type: string }, val: string | null, isNext: boolean) {
    const clickable = isNext || (val !== null && isOverwritable(step.field as StepField));
    if (val !== null) {
      if (step.type === 'side') return `${sideCls}${clickable ? ' cursor-pointer' : ''}`;
      if (step.type === 'pick') return `${pickCls}${clickable ? ' cursor-pointer' : ''}`;
      return `${lockedBanCls}${clickable ? ' cursor-pointer' : ''}`;
    }
    if (isNext) return `${nextCls} cursor-pointer`;
    return pendingCls;
  }

  // For playoff/gauntlet: show auto-picked map tile
  const isPlayoffOrGauntlet = match.is_playoff_game || isGauntlet;
  const autoPickedMap = isPlayoffOrGauntlet ? (match.shirts_pick ?? match.picked_map) : null;

  async function submitVeto(field: StepField, value: string | null) {
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

  function clearVeto(e: React.MouseEvent, field: StepField) {
    e.stopPropagation();
    submitVeto(field, null);
  }

  function handleTileClick(field: StepField) {
    const val = getFieldValue(match, field);
    const canClick = field === actionableField || (val !== null && isOverwritable(field));
    if (!canClick) return;
    setActiveField(activeField === field ? null : field);
    setError(null);
  }

  const pool = mapPool ?? [];
  // Exclude the active field's current value so it can be re-selected or replaced freely
  const banned = usedMaps(match).filter(
    (m) => activeField === null || m !== getFieldValue(match, activeField),
  );

  return (
    <div>
      <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
        <div className="flex items-stretch gap-1 flex-wrap p-3">
          {steps.map((s, i) => {
            const val = getFieldValue(match, s.field as StepField);
            const isNext = s.field === actionableField;
            const isActive = activeField === s.field;
            const banImg = s.type === 'ban' && val ? mapImageFor(val) : null;
            return (
              <span key={s.field} className="flex items-center gap-1 flex-1 min-w-[88px]">
                {i > 0 && (
                  <span className="text-[var(--color-text-secondary)] text-sm shrink-0 font-mono">
                    ›
                  </span>
                )}
                <div
                  className={`relative flex-1 min-w-[88px] px-2.5 py-2 border transition-colors ${tileCls(s, val, isNext)} ${isActive ? 'ring-1 ring-[var(--color-accent-amber-pickborder)]' : ''}`}
                  onClick={() => handleTileClick(s.field as StepField)}
                  role={isNext || (val !== null && isOverwritable(s.field as StepField)) ? 'button' : undefined}
                  aria-expanded={isActive ? true : undefined}
                >
                  {banImg && (
                    <>
                      <div className="absolute inset-0 bg-cover bg-center grayscale pointer-events-none" style={{ backgroundImage: `url(${banImg})` }} />
                      <div className="absolute inset-0 bg-black/55 pointer-events-none" />
                    </>
                  )}
                  {isAdmin && val !== null && (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={(e) => clearVeto(e, s.field as StepField)}
                      className="absolute top-1 right-1 z-20 w-4 h-4 flex items-center justify-center text-[var(--color-accent-red-fg)] hover:opacity-70 transition-opacity disabled:opacity-30"
                      title="Clear"
                      aria-label="Clear"
                    >
                      ✕
                    </button>
                  )}
                  <div className={banImg ? 'relative z-10' : undefined}>
                    <div className="lbl tracked text-[9px] font-semibold mb-0.5 flex items-center gap-1">
                      {s.label}
                      {isNext && val === null && (
                        <span className="ml-auto text-[var(--color-accent-amber-strong)] text-[8px] font-bold tracking-wide">NEXT</span>
                      )}
                    </div>
                    <div className="val font-display text-[14px] font-semibold leading-tight">
                      {val && !canVeto && s.type !== 'side' ? (
                        <Link
                          href={`/maps/${mapSlug(val)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {toSentenceCase(val)}
                        </Link>
                      ) : val ? toSentenceCase(val) : '—'}
                    </div>
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
                  {autoPickedMap && !canVeto ? (
                    <Link href={`/maps/${mapSlug(autoPickedMap)}`} className="hover:underline">
                      {toSentenceCase(autoPickedMap)}
                    </Link>
                  ) : autoPickedMap ? toSentenceCase(autoPickedMap) : '—'}
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
                    onClick={() => submitVeto(activeField, map)}
                    className={`relative flex-1 min-w-[80px] h-[72px] border overflow-hidden transition-opacity ${
                      isUsed
                        ? 'opacity-40 grayscale cursor-not-allowed border-[var(--color-border-tertiary)]'
                        : 'border-[var(--color-border-primary)] hover:border-[var(--color-accent-amber-pickborder)] cursor-pointer'
                    } disabled:opacity-40`}
                    title={map}
                  >
                    {img && (
                      <div className="absolute inset-0 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url(${img})` }} />
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-end p-1.5">
                      <span
                        className={`font-display font-semibold text-[11px] leading-tight text-white ${isUsed ? 'line-through opacity-70' : ''}`}
                      >
                        {toSentenceCase(map)}
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
