'use client';

import { ScheduleLabView, type PlanPeriod } from './ScheduleLabView';
import ErrorText from './ErrorText';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { useRefreshingAction } from './useRefreshingAction';
import type { ScheduleLabPlayer, ScheduleLabRoster } from '@/lib/queries';
import type { FormatPlan, FormatRecord } from '@/lib/season-format';
import SectionLabel from './SectionLabel';

const ROUND: PlanPeriod = { one: 'round', many: 'rounds', span: 'night' };

/** A plan's games in play order — round by round, division by division — as lineups. */
function planGames(plan: FormatPlan): { shirts: [number, number]; skins: [number, number] }[] {
  return plan.weeks.flatMap((w) => w.divisions.flatMap((d) => d.games.map((g) => ({ shirts: g.shirts, skins: g.skins }))));
}

/** Generate Rounds for a scrim night: the Schedule Lab's controls over the checked-in players, with
 *  rounds in place of weeks and one preview at a time — its matchups first, its scorecard folded into
 *  Details — and a button that queues those games as the night's next matches
 *  (`POST /api/scrims/[id]/rounds`). Opened from the lobby beside Next Match. */
export function ScrimRoundsGenerator({
  nightId,
  players,
  rosters,
  careerRecords,
  onClose,
}: {
  nightId: number;
  /** The checked-in players, with their EHOG state. */
  players: ScheduleLabPlayer[];
  rosters: ScheduleLabRoster[];
  careerRecords: Record<number, FormatRecord>;
  onClose: () => void;
}) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Generate rounds</SectionLabel>
        <button type="button" onClick={onClose} className={ADMIN_SMALL_BUTTON_CLS}>
          Close
        </button>
      </div>
      <ScheduleLabView
        players={players}
        rosters={rosters}
        careerRecords={careerRecords}
        period={ROUND}
        fixedRoster
        comparePreviews={false}
        defaultWeeks={2}
        planActions={(plan) => {
          const games = planGames(plan);
          return (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => act('POST', `/api/scrims/${nightId}/rounds`, { games })}
                disabled={busy}
                className={`${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`}
              >
                {busy ? '…' : `Queue these ${games.length} matches`}
              </button>
              <ErrorText error={error} size={12} />
            </div>
          );
        }}
      />
    </div>
  );
}
