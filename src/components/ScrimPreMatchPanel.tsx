'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ScheduleLabView, type PlanPeriod } from './ScheduleLabView';
import ErrorText from './ErrorText';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import type { ScheduleLabPlayer, ScheduleLabRoster } from '@/lib/queries';
import type { FormatPlan, FormatRecord } from '@/lib/season-format';

const ROUND: PlanPeriod = { one: 'round', many: 'rounds', span: 'night' };

/** A plan's games in play order — round by round, division by division — as lineups. */
function planGames(plan: FormatPlan): { shirts: [number, number]; skins: [number, number] }[] {
  return plan.weeks.flatMap((w) => w.divisions.flatMap((d) => d.games.map((g) => ({ shirts: g.shirts, skins: g.skins }))));
}

/** Pre-match any number of rounds for a scrim night: the Schedule Lab's controls, previews and
 *  scorecard over the checked-in players, with rounds in place of weeks, and a button that queues the
 *  shown preview's games as the night's next matches (`POST /api/scrims/[id]/rounds`). Closed by
 *  default — making one match at a time is the usual flow. */
export function ScrimPreMatchPanel({
  nightId,
  players,
  rosters,
  careerRecords,
}: {
  nightId: number;
  /** The checked-in players, with their EHOG state. */
  players: ScheduleLabPlayer[];
  rosters: ScheduleLabRoster[];
  careerRecords: Record<number, FormatRecord>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAsyncAction();
  const [, startTransition] = useTransition();

  const queue = (plan: FormatPlan) =>
    run(async () => {
      await sendJsonRequest('POST', `/api/scrims/${nightId}/rounds`, { games: planGames(plan) });
      startTransition(() => router.refresh());
    });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${ADMIN_SMALL_BUTTON_CLS} self-start`}>
        Pre-match rounds…
      </button>
    );
  }
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="tracked text-[10px] text-[var(--color-text-secondary)]">Pre-match rounds</div>
        <button type="button" onClick={() => setOpen(false)} className={ADMIN_SMALL_BUTTON_CLS}>
          Close
        </button>
      </div>
      <ScheduleLabView
        players={players}
        rosters={rosters}
        careerRecords={careerRecords}
        period={ROUND}
        fixedRoster
        defaultWeeks={2}
        planActions={(plan) => (
          <div className="flex flex-col items-end gap-1">
            <button type="button" onClick={() => queue(plan)} disabled={busy} className={`${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`}>
              {busy ? '…' : `Queue these ${planGames(plan).length} matches`}
            </button>
            <ErrorText error={error} size={12} />
          </div>
        )}
      />
    </div>
  );
}
