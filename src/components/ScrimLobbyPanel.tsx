'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { scrimMatchHref } from '@/lib/crumbs';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import MatchServerPanel from './MatchServerPanel';
import { CUSTOM_MAP_CHOICE, MapPicker } from './MapPicker';
import { SELECT_CLS } from './formStyles';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import type { ServerState } from '@/lib/dathost-lifecycle';
import type { ScrimMatch, WorkshopMapOption } from '@/lib/queries';
import { SCRIM_SIDE_CHOICES, isScrimMatchDiscardable, isScrimMatchEditable, type ScrimSideChoice } from '@/lib/scrim-matches';
import { toSentenceCase } from '@/lib/maps';
import { workshopIdFromInput } from '@/lib/workshop';

interface Props {
  date: string;
  /** The night's match without a score, if any — the lobby. */
  match: ScrimMatch | null;
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

/** A lobby mutation: send it, then refresh the page so it shows the result. */
function useLobbyAction() {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [, startTransition] = useTransition();
  const act = (method: 'POST' | 'PATCH' | 'DELETE', url: string, body: unknown = {}) =>
    run(async () => {
      await sendJsonRequest(method, url, body);
      startTransition(() => router.refresh());
    });
  return { busy, error, act };
}

/** The scrim night lobby: make the next match, then — for the players in it or an admin — set its map,
 *  starting side and lineup (from the checked-in pool), start it on the server, or discard it. */
export function ScrimLobbyPanel({ date, match, pool, names, maps, canMake, canManage }: Props) {
  const { busy, error, act } = useLobbyAction();
  if (match) return <LobbyMatch match={match} pool={pool} names={names} maps={maps} canManage={canManage} />;
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className={LABEL_CLS}>Lobby</div>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1">
          {pool.length} checked in{pool.length < 4 && ' — a match needs 4'}
        </div>
      </div>
      {canMake && (
        <button type="button" onClick={() => act('POST', `/api/scrims/${date}/matches`)} disabled={busy || pool.length < 4} className={GO_BTN_CLS}>
          {busy ? '…' : 'Make next match'}
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
  const { busy, error, act } = useLobbyAction();
  const current: Lineup = [...match.shirts, ...match.skins];
  const [draft, setDraft] = useState<Lineup>(current);
  const knownMap = maps.some((m) => m.workshopId === match.workshop_id);
  const [mapChoice, setMapChoice] = useState(knownMap ? match.workshop_id ?? '' : CUSTOM_MAP_CHOICE);
  const [customMap, setCustomMap] = useState(knownMap ? '' : match.workshop_id ?? '');
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
              setMapChoice(value);
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
