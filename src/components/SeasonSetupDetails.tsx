'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toSentenceCase } from '@/lib/maps';
import { hasMapPool } from '@/lib/season-map-pool';
import { formatBuyIn } from '@/lib/season-buy-in';
import { AdminMenu, type AdminMenuItem } from './AdminMenu';
import { ADMIN_PRIMARY_BUTTON_CLS } from './adminButtonStyles';
import { ActivationWarning, useActivateSeason } from './MarkSeasonActiveButton';
import { SeasonStartDateForm } from './SeasonStartDateForm';
import { SeasonMapPoolForm } from './SeasonMapPoolForm';
import { SeasonBuyInForm } from './SeasonBuyInForm';
import ErrorText from '@/components/ErrorText';

/** The regular-season half of `SeasonSetupDetails`: the map pool and buy-in lines, and going live. */
interface RegularSetup {
  mapPool: string[] | null;
  knownMaps: string[];
  buyInAmount: number | null;
  /** False once the schedule is generated: the buy-in is fixed from then on. */
  buyInEditable: boolean;
}

interface Props {
  seasonId: number;
  seasonStatus: string;
  isAdmin: boolean;
  startDate: string | null;
  /** Omitted for a gauntlet season, which shows only its start date. */
  regular?: RegularSetup;
}

type Editing = 'startDate' | 'mapPool' | 'buyIn';

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const LINE_CLS = 'font-mono text-[11px] text-[var(--color-text-secondary)]';
const TBD = <span className="opacity-60">TBD</span>;

/** An UPCOMING season's setup, under its title: when it starts and, for a regular season, its map
 * pool and buy-in, each TBD until set. Everyone sees the same lines. An admin also gets one
 * `AdminMenu` beside them for the season's setup: each Set / Edit item opens that line's editor in
 * place of the line, and **Mark active…** expands into the go-live confirm (the manual fallback for
 * a season whose automatic activation on schedule confirm failed — see `useActivateSeason()`). Once
 * the season isn't UPCOMING this renders nothing but a gauntlet-build warning from going live. */
export function SeasonSetupDetails({ seasonId, seasonStatus, isAdmin, startDate, regular }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing | null>(null);
  const activation = useActivateSeason(seasonId);

  // Rendered after going live too, so a gauntlet-build warning outlives the refresh that follows.
  if (seasonStatus !== 'UPCOMING') return <ActivationWarning warning={activation.warning} />;

  function done(saved: boolean) {
    setEditing(null);
    if (saved) startTransition(() => router.refresh());
  }

  const items: AdminMenuItem[] = [
    { label: startDate ? 'Edit start date…' : 'Set start date…', onSelect: () => setEditing('startDate') },
  ];
  if (regular) {
    items.push({
      label: hasMapPool(regular.mapPool) ? 'Edit map pool…' : 'Set map pool…',
      onSelect: () => setEditing('mapPool'),
    });
    if (regular.buyInEditable) items.push({ label: 'Edit buy-in…', onSelect: () => setEditing('buyIn') });
    items.push({
      label: 'Mark active…',
      disabled: activation.busy,
      content: (close) => (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Takes the season live now. There&apos;s no undo.
          </p>
          <button
            type="button"
            onClick={() => {
              close();
              activation.activate();
            }}
            className={`${ADMIN_PRIMARY_BUTTON_CLS} self-start`}
          >
            Confirm Go Live
          </button>
        </div>
      ),
    });
  }

  return (
    <div className="mt-2 flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        {editing === 'startDate' ? (
          <SeasonStartDateForm seasonId={seasonId} startDate={startDate} onDone={done} />
        ) : (
          <span className={LINE_CLS}>Starts: {startDate ? fmtDate(startDate) : TBD}</span>
        )}
        {regular &&
          (editing === 'mapPool' ? (
            <SeasonMapPoolForm seasonId={seasonId} mapPool={regular.mapPool} knownMaps={regular.knownMaps} onDone={done} />
          ) : (
            <span className={LINE_CLS}>
              Maps: {hasMapPool(regular.mapPool) ? regular.mapPool!.map(toSentenceCase).join(', ') : TBD}
            </span>
          ))}
        {regular &&
          (editing === 'buyIn' ? (
            <SeasonBuyInForm seasonId={seasonId} buyInAmount={regular.buyInAmount} onDone={done} />
          ) : (
            <span className={LINE_CLS}>
              Buy-in: {regular.buyInAmount != null ? formatBuyIn(regular.buyInAmount) : TBD}
            </span>
          ))}
        {activation.busy && <span className={LINE_CLS}>Activating…</span>}
        <ErrorText error={activation.error} size={12} />
        <ActivationWarning warning={activation.warning} />
      </div>
      {isAdmin && <AdminMenu label="Season setup admin actions" items={items} />}
    </div>
  );
}
