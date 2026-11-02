'use client';

import { useState } from 'react';
import Link from 'next/link';
import { scrimMatchHref } from '@/lib/crumbs';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import MatchServerPanel from './MatchServerPanel';
import { CUSTOM_MAP_CHOICE, MapPicker } from './MapPicker';
import { SELECT_CLS } from './formStyles';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { useRefreshingAction } from './useRefreshingAction';
import { ScrimRoundsGenerator } from './ScrimRoundsGenerator';
import type { ServerState } from '@/lib/dathost-lifecycle';
import type { ScheduleLabPlayer, ScheduleLabRoster, ScrimMatch, WorkshopMapOption } from '@/lib/queries';
import type { FormatRecord } from '@/lib/season-format';
import { SCRIM_SIDE_CHOICES, isScrimMatchDiscardable, isScrimMatchEditable, type ScrimSideChoice } from '@/lib/scrim-matches';
import { toSentenceCase } from '@/lib/maps';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-matchmaking';
import { workshopIdFromInput } from '@/lib/workshop';

interface Props {
  nightId: number;
  /** The night's first match without a score, if any — the lobby. */
  match: ScrimMatch | null;
  /** The pre-matched matches after it, in play order, and whether the viewer may discard each. */
  queued: { match: ScrimMatch; canDiscard: boolean }[];
  /** Checked-in players, the pool a match draws from. */
  pool: { id: number; name: string }[];
  /** Every player's name, for lineup slots holding someone no longer checked in. */
  names: Record<number, string>;
  /** Known workshop maps for the picker; any other Workshop item can be entered as a link or id. */
  maps: WorkshopMapOption[];
  /** The viewer may make the next match (checked in, or an admin, with check-in open). */
  canMake: boolean;
  /** The viewer may change, discard or start `match` (in it, or an admin). */
  canManage: boolean;
  /** The signed-in viewer and whether they're checked in; `null` when signed out. */
  viewer: { playerId: number; checkedIn: boolean } | null;
  /** What Generate Rounds plans over — the checked-in players' ratings and season records — when the
   *  viewer may make matches and none is waiting; `null` otherwise. */
  rounds: { players: ScheduleLabPlayer[]; rosters: ScheduleLabRoster[]; careerRecords: Record<number, FormatRecord> } | null;
}

const BTN_CLS = `${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`;
const GO_BTN_CLS = `${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`;
const LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';

const SIDE_LABEL: Record<ScrimSideChoice, string> = {
  skins_t: 'Skins start T',
  shirts_t: 'Shirts start T',
  knife: 'Knife round',
  random: 'Random',
};

type Lineup = [number, number, number, number];

/** The scrim night lobby: checking in first, then the next match — Next Match makes one, Generate
 *  Rounds queues several — and, for the players in the lobby's match or an admin, its map, starting
 *  side and lineup (from the checked-in pool), starting it on the server, or discarding it. */
export function ScrimLobbyPanel({ nightId, match, queued, pool, names, maps, canMake, canManage, viewer, rounds }: Props) {
  const { busy, error, act } = useRefreshingAction();
  const [generating, setGenerating] = useState(false);
  const enough = pool.length >= SCRIM_MATCH_SIZE;
  return (
    <div className="flex flex-col gap-3">
      <CheckInBar nightId={nightId} checkedInCount={pool.length} viewer={viewer} />

      {match ? (
        <>
          <LobbyMatch match={match} pool={pool} names={names} maps={maps} canManage={canManage} />
          {queued.length > 0 && <UpNext queued={queued} names={names} />}
        </>
      ) : (
        canMake && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => act('POST', `/api/scrims/${nightId}/matches`)} disabled={busy || !enough} className={GO_BTN_CLS}>
              {busy ? '…' : 'Next Match'}
            </button>
            {rounds && (
              <button type="button" onClick={() => setGenerating(!generating)} aria-expanded={generating} className={BTN_CLS}>
                Generate Rounds
              </button>
            )}
          </div>
        )
      )}
      <ErrorText error={error} size={12} />
      {generating && rounds && !match && (
        <ScrimRoundsGenerator nightId={nightId} {...rounds} onClose={() => setGenerating(false)} />
      )}
    </div>
  );
}

/** The lobby's first row: how many are checked in, and the viewer's own Check in / Check out. */
function CheckInBar({ nightId, checkedInCount, viewer }: { nightId: number; checkedInCount: number; viewer: Props['viewer'] }) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        {checkedInCount} checked in{checkedInCount < SCRIM_MATCH_SIZE && ` — a match needs ${SCRIM_MATCH_SIZE}`}
      </div>
      {viewer && (
        <button
          type="button"
          onClick={() => act(viewer.checkedIn ? 'DELETE' : 'POST', `/api/scrims/${nightId}/check-in`, { player_id: viewer.playerId })}
          disabled={busy}
          className={viewer.checkedIn ? BTN_CLS : GO_BTN_CLS}
        >
          {busy ? '…' : viewer.checkedIn ? 'Check out' : 'Check in'}
        </button>
      )}
      <ErrorText error={error} size={12} className="w-full" />
    </div>
  );
}

/** The lobby's current match: map, starting side and lineup pickers, Discard, and the server panel. */
function LobbyMatch({
  match,
  pool,
  names,
  maps,
  canManage,
}: Pick<Props, 'pool' | 'names' | 'maps' | 'canManage'> & { match: ScrimMatch }) {
  const { busy, error, act } = useRefreshingAction();
  const current: Lineup = [...match.shirts, ...match.skins];
  const [draft, setDraft] = useState<Lineup>(current);
  // The picker shows the saved map; only the custom-id field is local, opened by picking "Custom".
  const customSaved = match.workshop_id != null && !maps.some((m) => m.workshopId === match.workshop_id);
  const [customOpen, setCustomOpen] = useState(customSaved);
  const [customMap, setCustomMap] = useState(customSaved ? (match.workshop_id ?? '') : '');
  const mapChoice = customOpen ? CUSTOM_MAP_CHOICE : (match.workshop_id ?? '');
  const customId = workshopIdFromInput(customMap);

  const canEdit = canManage && isScrimMatchEditable(match);
  const canDiscard = canManage && isScrimMatchDiscardable(match);
  // The server stopped without a score: a crash, or a demo waiting for review on the match page.
  const stoppedUnscored = match.server_state === 'done';
  const url = `/api/scrims/matches/${match.id}`;
  const lineupChanged = draft.some((id, i) => id !== current[i]);
  const lineupValid = new Set(draft).size === 4;
  // A slot can hold anyone in the pool, plus whoever holds it now (even if they've since checked out).
  const slotOptions = (holder: number) =>
    [...pool, ...(pool.some((p) => p.id === holder) ? [] : [{ id: holder, name: names[holder] ?? `#${holder}` }])];

  const slot = (i: number) => (
    <select
      key={i}
      value={draft[i]}
      disabled={!canEdit || busy}
      onChange={(e) => setDraft(draft.map((id, j) => (j === i ? Number(e.target.value) : id)) as Lineup)}
      aria-label={`${i < 2 ? 'Shirts' : 'Skins'} player ${(i % 2) + 1}`}
      className={`${SELECT_CLS} w-full`}
    >
      {slotOptions(current[i]).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-4 py-3 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
        <Link href={scrimMatchHref(match.id)} className={`${LABEL_CLS} hover:underline`}>
          Lobby · Match {match.match_number} →
        </Link>
        {canDiscard && (
          <button type="button" onClick={() => act('DELETE', url)} disabled={busy} className={BTN_CLS}>
            Discard
          </button>
        )}
      </div>
      {stoppedUnscored && (
        <div className="px-4 py-2 border-b border-[var(--color-border-tertiary)] font-mono text-[12px] text-[var(--color-text-secondary)]">
          The server stopped without a score.{' '}
          <Link href={scrimMatchHref(match.id)} className="underline hover:text-[var(--color-text-primary)]">Confirm its result</Link>
          {canDiscard ? ' or discard it to make the next match.' : ' to make the next match.'}
        </div>
      )}

      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Map{match.map && ` · ${toSentenceCase(match.map)}`}</span>
          <MapPicker
            maps={maps}
            value={mapChoice}
            onChange={(value) => {
              setCustomOpen(value === CUSTOM_MAP_CHOICE);
              if (value && value !== CUSTOM_MAP_CHOICE) act('PATCH', url, { workshop: value });
            }}
            customValue={customMap}
            onCustomChange={setCustomMap}
            customInvalid={customMap.trim() !== '' && !customId}
            disabled={!canEdit || busy}
          />
          {canEdit && mapChoice === CUSTOM_MAP_CHOICE && customId && customId !== match.workshop_id && (
            <button type="button" onClick={() => act('PATCH', url, { workshop: customId })} disabled={busy} className={`${GO_BTN_CLS} self-start`}>
              Use this map
            </button>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Starting side</span>
          <select
            value={match.side_choice}
            disabled={!canEdit || busy}
            onChange={(e) => act('PATCH', url, { side: e.target.value })}
            className={`${SELECT_CLS} w-full`}
          >
            {SCRIM_SIDE_CHOICES.map((c) => (
              <option key={c} value={c}>{SIDE_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Shirts</span>
          {slot(0)}
          {slot(1)}
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Skins</span>
          {slot(2)}
          {slot(3)}
        </div>
      </div>

      {canEdit && lineupChanged && (
        <div className="px-4 pb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => act('PATCH', url, { lineup: { shirts: draft.slice(0, 2), skins: draft.slice(2) } })}
            disabled={busy || !lineupValid}
            className={GO_BTN_CLS}
          >
            Save lineup
          </button>
          <button type="button" onClick={() => setDraft(current)} disabled={busy} className={BTN_CLS}>
            Reset
          </button>
          {!lineupValid && <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">Each player can only take one slot.</span>}
        </div>
      )}
      <ErrorText error={error} size={12} className="px-4 pb-3" />

      {pool.length === 0 && <EmptyState message="Nobody is checked in." className="px-4 pb-3" />}

      <div className="px-4 pb-4 flex justify-center">
        <div className="w-full max-w-md">
          <MatchServerPanel matchId={match.id} canManage={canManage} initialState={(match.server_state ?? 'idle') as ServerState} />
        </div>
      </div>
    </div>
  );
}

/** The pre-matched matches waiting behind the lobby's, each with a Discard for its players or an
 *  admin. Each becomes the lobby's match in turn, where its map, side and lineup can still change. */
function UpNext({ queued, names }: { queued: Props['queued']; names: Props['names'] }) {
  const { busy, error, act } = useRefreshingAction();
  const team = (ids: number[]) => ids.map((id) => names[id] ?? `#${id}`).join(' + ');
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className={`px-4 py-2 border-b border-[var(--color-border-tertiary)] ${LABEL_CLS}`}>Up next · {queued.length}</div>
      {queued.map(({ match, canDiscard }) => (
        <div key={match.id} className="px-4 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 flex items-center justify-between gap-3 font-mono text-[12px]">
          <span className="min-w-0">
            <span className="text-[var(--color-text-secondary)]">{match.match_number} · {match.map ? toSentenceCase(match.map) : '—'} · </span>
            {team(match.shirts)} <span className="text-[var(--color-text-secondary)]">vs</span> {team(match.skins)}
          </span>
          {canDiscard && (
            <button type="button" onClick={() => act('DELETE', `/api/scrims/matches/${match.id}`)} disabled={busy} className={BTN_CLS}>
              Discard
            </button>
          )}
        </div>
      ))}
      <ErrorText error={error} size={12} className="px-4 pb-3" />
    </div>
  );
}
