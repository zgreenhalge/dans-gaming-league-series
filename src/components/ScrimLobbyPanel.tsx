'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { scrimMatchHref, scrimNightMatchesHref } from '@/lib/crumbs';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import ErrorText from './ErrorText';
import MatchServerPanel from './MatchServerPanel';
import { CUSTOM_MAP_CHOICE, MapPicker } from './MapPicker';
import { SELECT_CLS } from './formStyles';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { useRefreshingAction } from './useRefreshingAction';
import { MatchCard } from './MatchCard';
import { CollapsiblePanel } from './CollapsiblePanel';
import { ScrimDiscardButton } from './ScrimDiscardButton';
import { ScrimRoundsGenerator } from './ScrimRoundsGenerator';
import type { ServerState } from '@/lib/dathost-lifecycle';
import type { ScheduleLabPlayer, ScheduleLabRoster, ScrimMatch, WorkshopMapOption } from '@/lib/queries';
import type { FormatRecord } from '@/lib/season-format';
import { SCRIM_SIDE_CHOICES, isScrimMatchDiscardable, isScrimMatchEditable, scrimTeamLabel, type ScrimSideChoice } from '@/lib/scrim-matches';
import { toSentenceCase } from '@/lib/maps';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-schedule';
import { workshopIdFromInput } from '@/lib/workshop';
import SectionLabel from './SectionLabel';
import FieldLabel from './FieldLabel';

interface Props {
  nightId: number;
  /** The night's first match still needing the server, if any — the lobby. */
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
  /** The viewer may end the night (`buildScrimNightPageModel()`'s `canEnd`): End night sits beside Next
   *  Match. */
  canEnd: boolean;
  /** The viewer may configure, discard or start `match` (an admin). Everyone else sees its card. */
  canManage: boolean;
  currentPlayerId: number | null;
  /** What Generate Rounds plans over — the checked-in players' ratings and season records — when the
   *  viewer may make matches and none is waiting; `null` otherwise. */
  rounds: { players: ScheduleLabPlayer[]; rosters: ScheduleLabRoster[]; careerRecords: Record<number, FormatRecord> } | null;
}

const BTN_CLS = `${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`;
const GO_BTN_CLS = `${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`;

const SIDE_LABEL: Record<ScrimSideChoice, string> = {
  skins_t: 'Skins start T',
  shirts_t: 'Shirts start T',
  knife: 'Knife round',
  random: 'Random',
};

type Lineup = [number, number, number, number];

/** The scrim night lobby, about the current match: with none, Next Match makes one, Generate Rounds
 *  queues several, and End night closes the night; otherwise the lobby's match — a card for everyone,
 *  and for an admin its map, starting side and lineup (from the checked-in pool), starting it on the
 *  server, or discarding it — and a short pointer to the matches queued behind it. Checking in is the
 *  page's status bar (`ScrimNightStatusBar`); the night's running order is its Matches tab. */
export function ScrimLobbyPanel({ nightId, match, queued, pool, names, maps, canMake, canEnd, canManage, currentPlayerId, rounds }: Props) {
  const { busy, error, act } = useRefreshingAction();
  const [generating, setGenerating] = useState(false);
  const enough = pool.length >= SCRIM_MATCH_SIZE;
  const editable = match != null && isScrimMatchEditable(match);
  return (
    <div className="flex flex-col gap-3">
      {match ? (
        <>
          <LobbyMatchCard match={match} names={names} currentPlayerId={currentPlayerId} />
          {/* Map, side and lineup can only change before the server starts; Discard until it holds the server. */}
          {canManage && isScrimMatchDiscardable(match) && (
            <LobbyMatchConfig match={match} editable={editable} pool={pool} names={names} maps={maps} />
          )}
          {/* An admin runs the server; once it has started, anyone signed in can join it. */}
          {(canManage || !editable) && (
            <div className="w-full max-w-md self-center">
              <MatchServerPanel
                matchId={match.id}
                canManage={canManage}
                canJoin={canManage || currentPlayerId != null}
                signInToJoin={!canManage && currentPlayerId == null}
                initialState={(match.server_state ?? 'idle') as ServerState}
              />
            </div>
          )}
          {queued.length > 0 && <UpNext nightId={nightId} queued={queued} />}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {canMake ? (
            <>
              <button type="button" onClick={() => act('POST', `/api/scrims/${nightId}/matches`)} disabled={busy || !enough} className={GO_BTN_CLS}>
                {busy ? '…' : 'Next Match'}
              </button>
              {rounds && (
                <button type="button" onClick={() => setGenerating(!generating)} aria-expanded={generating} className={BTN_CLS}>
                  Generate Rounds
                </button>
              )}
            </>
          ) : (
            <p className="font-mono text-[12px] text-[var(--color-text-secondary)]">No match yet. A checked-in player makes the next one.</p>
          )}
          {canEnd && (
            <div className="ml-auto">
              <ScrimEndNightButton nightId={nightId} />
            </div>
          )}
        </div>
      )}
      <ErrorText error={error} size={12} />
      {generating && rounds && !match && (
        <ScrimRoundsGenerator nightId={nightId} {...rounds} onClose={() => setGenerating(false)} />
      )}
    </div>
  );
}

/** The lobby's match, before and after its server starts: the same `MatchCard` every
 *  match list uses, linking to the match page. The starting side isn't on it. */
function LobbyMatchCard({ match, names, currentPlayerId }: { match: ScrimMatch; names: Props['names']; currentPlayerId: number | null }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <MatchCard
        href={scrimMatchHref(match.id)}
        map={match.map}
        label={{ type: 'match', matchNumber: match.match_number, isFeatureMatch: false }}
        right={isScrimMatchEditable(match) ? { type: 'next' } : { type: 'live' }}
        shirtsFallback={scrimTeamLabel(match.shirts, names)}
        skinsFallback={scrimTeamLabel(match.skins, names)}
        currentPlayerId={currentPlayerId}
      />
    </div>
  );
}

/** The lobby's match, for admins: a header with Discard (after a confirm), and while the match is
 *  `editable` (unstarted) a Configure `CollapsiblePanel` under it, collapsed by default, holding the
 *  map, starting side and lineup pickers. */
function LobbyMatchConfig({
  match,
  editable,
  pool,
  names,
  maps,
}: Pick<Props, 'pool' | 'names' | 'maps'> & { match: ScrimMatch; editable: boolean }) {
  const { busy, error, act } = useRefreshingAction();
  const mapFieldId = useId();
  const sideFieldId = useId();
  const current: Lineup = [...match.shirts, ...match.skins];
  const [draft, setDraft] = useState<Lineup>(current);
  // The picker shows the saved map; only the custom-id field is local, opened by picking "Custom".
  const customSaved = match.workshop_id != null && !maps.some((m) => m.workshopId === match.workshop_id);
  const [customOpen, setCustomOpen] = useState(customSaved);
  const [customMap, setCustomMap] = useState(customSaved ? (match.workshop_id ?? '') : '');
  const mapChoice = customOpen ? CUSTOM_MAP_CHOICE : (match.workshop_id ?? '');
  const customId = workshopIdFromInput(customMap);

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
      disabled={busy}
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
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <SectionLabel as="span">Match {match.match_number}</SectionLabel>
        <ScrimDiscardButton matchId={match.id} />
      </div>
      {editable && (
        <CollapsiblePanel title="Configure" className="mx-4 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              {/* The saved map is shown beside the label but kept out of the select's accessible name. */}
              <FieldLabel htmlFor={mapFieldId}>
                Map{match.map && <span aria-hidden="true"> · {toSentenceCase(match.map)}</span>}
              </FieldLabel>
              <MapPicker
                id={mapFieldId}
                maps={maps}
                value={mapChoice}
                onChange={(value) => {
                  setCustomOpen(value === CUSTOM_MAP_CHOICE);
                  if (value && value !== CUSTOM_MAP_CHOICE) act('PATCH', url, { workshop: value });
                }}
                customValue={customMap}
                onCustomChange={setCustomMap}
                customInvalid={customMap.trim() !== '' && !customId}
                disabled={busy}
              />
              {mapChoice === CUSTOM_MAP_CHOICE && customId && customId !== match.workshop_id && (
                <button type="button" onClick={() => act('PATCH', url, { workshop: customId })} disabled={busy} className={`${GO_BTN_CLS} self-start`}>
                  Use this map
                </button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={sideFieldId}>Starting side</FieldLabel>
              <select
                id={sideFieldId}
                value={match.side_choice}
                disabled={busy}
                onChange={(e) => act('PATCH', url, { side: e.target.value })}
                className={`${SELECT_CLS} w-full`}
              >
                {SCRIM_SIDE_CHOICES.map((c) => (
                  <option key={c} value={c}>{SIDE_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <SectionLabel>Shirts</SectionLabel>
              {slot(0)}
              {slot(1)}
            </div>
            <div className="flex flex-col gap-1">
              <SectionLabel>Skins</SectionLabel>
              {slot(2)}
              {slot(3)}
            </div>
          </div>

          {lineupChanged && (
            <div className="pt-3 flex items-center gap-2">
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
      <ErrorText error={error} size={12} className="pt-3" />
    </CollapsiblePanel>
      )}
    </div>
  );
}

/** A short pointer to the pre-matched matches waiting behind the lobby's — each by number and map,
 *  with a Discard for its players or an admin (after a confirm) — linking to the Matches tab, which
 *  shows them with their lineups in the night's running order. Each becomes the lobby's match in turn,
 *  where its map, side and lineup can still change. */
function UpNext({ nightId, queued }: { nightId: number; queued: Props['queued'] }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-4 py-2 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
        <SectionLabel as="span">Up next · {queued.length}</SectionLabel>
        <Link href={scrimNightMatchesHref(nightId)} className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline">
          Running order
        </Link>
      </div>
      {queued.map(({ match, canDiscard }) => (
        <div key={match.id} className="px-4 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 flex items-center justify-between gap-3 font-mono text-[12px]">
          <span className="min-w-0 text-[var(--color-text-secondary)]">
            Match {match.match_number} · {match.map ? toSentenceCase(match.map) : '—'}
          </span>
          {canDiscard && <ScrimDiscardButton matchId={match.id} />}
        </div>
      ))}
    </div>
  );
}

/** End night (`POST /api/scrims/[id]/end`), after a confirm: closes the night now, rather than once it
 *  goes idle. */
function ScrimEndNightButton({ nightId }: { nightId: number }) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <ArmedConfirmButton
      onConfirm={() => act('POST', `/api/scrims/${nightId}/end`)}
      busy={busy}
      error={error}
      triggerLabel="End night"
      confirmLabel="End night for everyone"
      busyLabel="Ending…"
      variant="danger"
    />
  );
}
