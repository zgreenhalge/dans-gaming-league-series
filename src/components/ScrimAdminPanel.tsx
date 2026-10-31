'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ErrorText from './ErrorText';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import { WEEKDAY_NAMES, formatNightDate, formatStartTime, type ScrimNightSlot, type ScrimSchedule } from '@/lib/scrim-schedule';

interface Props {
  schedule: ScrimSchedule | null;
  slots: ScrimNightSlot[];
  /** IANA timezone names for the picker, resolved on the server so it matches the hydrated markup. */
  timezones: string[];
}

const LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';
const INPUT_CLS =
  'font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]';
const BTN_CLS =
  'tracked text-[10px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40';

const DEFAULT_SCHEDULE: ScrimSchedule = { weekday: 4, startTime: '20:00', timezone: 'America/New_York', enabled: true };

/** Admin controls for scrims: the weekly slot (day, start time, timezone, on/off) and cancelling or
 *  restoring individual upcoming nights. */
export function ScrimAdminPanel({ schedule, slots, timezones }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<ScrimSchedule>(schedule ?? DEFAULT_SCHEDULE);
  const action = useAsyncAction();
  // Which control is running ('schedule' or a night's date), so only it shows as pending.
  const [target, setTarget] = useState<string | null>(null);
  const busy = action.busy ? target : null;
  const [, startTransition] = useTransition();

  const dirty = !schedule || JSON.stringify(draft) !== JSON.stringify(schedule);

  function run(key: string, url: string, method: 'PUT' | 'PATCH', body: unknown) {
    setTarget(key);
    return action.run(async () => {
      await sendJsonRequest(method, url, body);
      startTransition(() => router.refresh());
    });
  }

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-4 py-3 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
        <div className={LABEL_CLS}>Admin · Weekly schedule</div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          {schedule
            ? `${schedule.enabled ? '' : 'Paused · '}${WEEKDAY_NAMES[schedule.weekday]}s at ${formatStartTime(schedule.startTime)}`
            : 'Not set'}
        </div>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Day</span>
          <select
            value={draft.weekday}
            onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}
            className={INPUT_CLS}
          >
            {WEEKDAY_NAMES.map((name, i) => (
              <option key={name} value={i}>{name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Start</span>
          <input
            type="time"
            value={draft.startTime}
            onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
            className={INPUT_CLS}
          />
        </label>
        <label className="flex flex-col gap-1 min-w-0 flex-1">
          <span className={LABEL_CLS}>Timezone</span>
          <select
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            className={`${INPUT_CLS} min-w-0`}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 py-2 text-[13px]">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          Enabled
        </label>
        <button
          type="button"
          onClick={() => run('schedule', '/api/scrims/schedule', 'PUT', draft)}
          disabled={!dirty || busy != null}
          className={BTN_CLS}
        >
          {busy === 'schedule' ? '…' : 'Save'}
        </button>
      </div>

      {slots.length > 0 && (
        <div className="border-t border-[var(--color-border-tertiary)]">
          <div className={`px-4 py-2 border-b border-[var(--color-border-tertiary)] ${LABEL_CLS}`}>Upcoming nights</div>
          {slots.map((s) => (
            <div
              key={s.date}
              className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 font-mono text-[12px]"
            >
              <span className={s.cancelled ? 'line-through text-[var(--color-text-secondary)]' : ''}>{formatNightDate(s.date)}</span>
              <button
                type="button"
                onClick={() => run(s.date, `/api/scrims/${s.date}`, 'PATCH', { cancelled: !s.cancelled })}
                disabled={busy != null}
                className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
              >
                {busy === s.date ? '…' : s.cancelled ? 'Restore' : 'Cancel'}
              </button>
            </div>
          ))}
        </div>
      )}
      <ErrorText error={action.error} size={12} className="px-4 pb-3" />
    </div>
  );
}
