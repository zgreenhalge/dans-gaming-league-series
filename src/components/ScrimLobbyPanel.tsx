'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { scrimMatchHref } from '@/lib/crumbs';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import MatchServerPanel from './MatchServerPanel';
import { SELECT_CLS } from './formStyles';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import type { ServerState } from '@/lib/dathost-lifecycle';
import type { ScrimMatch } from '@/lib/queries';
import { scrimSideChoiceOf, type ScrimSideChoice } from '@/lib/scrim-matches';
import { toSentenceCase } from '@/lib/maps';

interface Props {
  date: string;
  /** The night's match without a score, if any — the lobby. */
  match: ScrimMatch | null;
  /** Checked-in players, the pool a match draws from. */
  pool: { id: number; name: string }[];
  /** Every player's name, for lineup slots holding someone no longer checked in. */
  names: Record<number, string>;
  maps: string[];
  /** The viewer may make the next match (checked in, or an admin, with check-in open). */
  canMake: boolean;
  /** The viewer may change, discard or start `match` (in it, or an admin). */
  canManage: boolean;
  /** `match` hasn't been scored or started (`isScrimMatchEditable()`). */
  editable: boolean;
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

/** The scrim night lobby: make the next match, then — for the players in it or an admin — set its map,
 *  starting side and lineup (from the checked-in pool), start it on the server, or discard it. */
export function ScrimLobbyPanel({ date, match, pool, names, maps, canMake, canManage, editable }: Props) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [, startTransition] = useTransition();
  const current: Lineup | null = match ? [...match.shirts, ...match.skins].slice(0, 4) as Lineup : null;
  const [draft, setDraft] = useState<Lineup | null>(current);
  // Random is held here, not saved: it's sent as the match starts (`beforeProvision` below), so the
  // coin is only flipped then and nobody sees the sides beforehand.
  const [side, setSide] = useState<ScrimSideChoice>(scrimSideChoiceOf(match?.skins_starting_side ?? null));

  const act = (method: 'POST' | 'PATCH' | 'DELETE', url: string, body: unknown = {}) =>
    run(async () => {
      await sendJsonRequest(method, url, body);
      startTransition(() => router.refresh());
    });

  if (!match) {
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

  const canEdit = canManage && editable;
  const url = `/api/scrims/matches/${match.id}`;
  const lineupChanged = draft != null && current != null && draft.some((id, i) => id !== current[i]);
  const lineupValid = draft != null && new Set(draft).size === 4;
  // A slot can hold anyone in the pool, plus whoever holds it now (even if they've since checked out).
  const slotOptions = (holder: number) =>
    [...pool, ...(pool.some((p) => p.id === holder) ? [] : [{ id: holder, name: names[holder] ?? `#${holder}` }])];

  const slot = (i: number) => (
    <select
      key={i}
      value={draft?.[i] ?? ''}
      disabled={!canEdit || busy}
      onChange={(e) => draft && setDraft(draft.map((id, j) => (j === i ? Number(e.target.value) : id)) as Lineup)}
      aria-label={`${i < 2 ? 'Shirts' : 'Skins'} player ${(i % 2) + 1}`}
      className={`${SELECT_CLS} w-full`}
    >
      {slotOptions(current![i]).map((p) => (
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
        {canEdit && (
          <button type="button" onClick={() => act('DELETE', url)} disabled={busy} className={BTN_CLS}>
            Discard
          </button>
        )}
      </div>

      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Map</span>
          <select
            value={match.map ?? ''}
            disabled={!canEdit || busy}
            onChange={(e) => act('PATCH', url, { map: e.target.value })}
            className={`${SELECT_CLS} w-full`}
          >
            {maps.map((m) => (
              <option key={m} value={m}>{toSentenceCase(m)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Starting side</span>
          <select
            value={side}
            disabled={!canEdit || busy}
            onChange={(e) => {
              const choice = e.target.value as ScrimSideChoice;
              setSide(choice);
              if (choice !== 'random') act('PATCH', url, { side: choice });
            }}
            className={`${SELECT_CLS} w-full`}
          >
            {(Object.keys(SIDE_LABEL) as ScrimSideChoice[]).map((c) => (
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
            onClick={() => draft && act('PATCH', url, { lineup: { shirts: draft.slice(0, 2), skins: draft.slice(2) } })}
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
          <MatchServerPanel
            matchId={match.id}
            canManage={canManage}
            initialState={(match.server_state ?? 'idle') as ServerState}
            beforeProvision={side === 'random' ? () => sendJsonRequest('PATCH', url, { side: 'random' }) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
