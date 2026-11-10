'use client';

import { useState } from 'react';
import Link from 'next/link';
import { scrimMatchHref } from '@/lib/crumbs';
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
import { LocalTime } from './LocalTime';
import { LeagueGameMark } from './ScrimSeats';
import type { ScheduledMatchRef } from '@/lib/server-schedule-collision';
import type { ServerState } from '@/lib/dathost-lifecycle';
import type { ScheduleLabPlayer, ScheduleLabRoster, ScrimMatch, WorkshopMapOption } from '@/lib/queries';
import type { FormatRecord } from '@/lib/season-format';
import { SCRIM_SIDE_CHOICES, isScrimMatchDiscardable, isScrimMatchEditable, scrimTeamLabel, type ScrimSideChoice } from '@/lib/scrim-matches';
import { toSentenceCase } from '@/lib/maps';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-schedule';
import { workshopIdFromInput } from '@/lib/workshop';
import SectionLabel from './SectionLabel';

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
  /** The viewer may configure, discard or start `match` (an admin). Everyone else sees its card. */
  canManage: boolean;
  currentPlayerId: number | null;
  /** The signed-in viewer and whether they're checked in; `null` when signed out. */
  viewer: { playerId: number; checkedIn: boolean } | null;
  /** What Generate Rounds plans over — the checked-in players' ratings and season records — when the
   *  viewer may make matches and none is waiting; `null` otherwise. */
  rounds: { players: ScheduleLabPlayer[]; rosters: ScheduleLabRoster[]; careerRecords: Record<number, FormatRecord> } | null;
  /** League matches scheduled during the night (`leagueMatchesDuring()`): each takes the server, so
   *  no scrim match starts within half an hour of one. */
  leagueMatches: ScheduledMatchRef[];
}

const BTN_CLS = `${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`;
const GO_BTN_CLS = `${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`;
const FIELD_LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';

const SIDE_LABEL: Record<ScrimSideChoice, string> = {
  skins_t: 'Skins start T',
  shirts_t: 'Shirts start T',
  knife: 'Knife round',
  random: 'Random',
};

type Lineup = [number, number, number, number];

/** The scrim night lobby: checking in first, then the next match — Next Match makes one, Generate
 *  Rounds queues several — and the lobby's match: a card for everyone, and for an admin its map,
 *  starting side and lineup (from the checked-in pool), starting it on the server, or discarding it. */
export function ScrimLobbyPanel({ nightId, match, queued, pool, names, maps, canMake, canManage, currentPlayerId, viewer, rounds, leagueMatches }: Props) {
  const { busy, error, act } = useRefreshingAction();
  const [generating, setGenerating] = useState(false);
  const enough = pool.length >= SCRIM_MATCH_SIZE;
  const editable = match != null && isScrimMatchEditable(match);
  return (
    <div className="flex flex-col gap-3">
      <CheckInBar nightId={nightId} checkedInCount={pool.length} viewer={viewer} leagueMatches={leagueMatches} />

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
function CheckInBar({
  nightId,
  checkedInCount,
  viewer,
  leagueMatches,
}: {
  nightId: number;
  checkedInCount: number;
  viewer: Props['viewer'];
  leagueMatches: ScheduledMatchRef[];
}) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">{checkedInCount} checked in</span>
        {leagueMatches.map((m) => (
          <Link
            key={m.id}
            href={`/matches/${m.id}`}
            title={`${m.label} takes the server`}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] hover:underline"
          >
            <LeagueGameMark />
            <LocalTime iso={m.scheduledAt} opts={{ hour: 'numeric', minute: '2-digit' }} />
          </Link>
        ))}
      </div>
      {viewer && <ScrimCheckInButton nightId={nightId} viewer={viewer} />}
    </div>
  );
}

/** The viewer's own Check in / Check out for a night — the lobby's first row, and on its own before
 *  anyone has checked in, when the night page shows no lobby yet. */
export function ScrimCheckInButton({ nightId, viewer }: { nightId: number; viewer: NonNullable<Props['viewer']> }) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => act(viewer.checkedIn ? 'DELETE' : 'POST', `/api/scrims/${nightId}/check-in`, { player_id: viewer.playerId })}
        disabled={busy}
        className={viewer.checkedIn ? BTN_CLS : GO_BTN_CLS}
      >
        {busy ? '…' : viewer.checkedIn ? 'Check out' : 'Check in'}
      </button>
      <ErrorText error={error} size={12} />
    </span>
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
        right={isScrimMatchEditable(match) ? { type: 'pending' } : { type: 'live' }}
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
              <span className={FIELD_LABEL_CLS}>Map{match.map && ` · ${toSentenceCase(match.map)}`}</span>
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
                disabled={busy}
              />
              {mapChoice === CUSTOM_MAP_CHOICE && customId && customId !== match.workshop_id && (
                <button type="button" onClick={() => act('PATCH', url, { workshop: customId })} disabled={busy} className={`${GO_BTN_CLS} self-start`}>
                  Use this map
                </button>
              )}
            </div>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLS}>Starting side</span>
              <select
                value={match.side_choice}
                disabled={busy}
                onChange={(e) => act('PATCH', url, { side: e.target.value })}
                className={`${SELECT_CLS} w-full`}
              >
                {SCRIM_SIDE_CHOICES.map((c) => (
                  <option key={c} value={c}>{SIDE_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLS}>Shirts</span>
              {slot(0)}
              {slot(1)}
            </div>
            <div className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLS}>Skins</span>
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

/** The pre-matched matches waiting behind the lobby's, each with a Discard for its players or an
 *  admin (after a confirm). Each becomes the lobby's match in turn, where its map, side and lineup can still change. */
function UpNext({ queued, names }: { queued: Props['queued']; names: Props['names'] }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <SectionLabel className="px-4 py-2 border-b border-[var(--color-border-tertiary)]">Up next · {queued.length}</SectionLabel>
      {queued.map(({ match, canDiscard }) => (
        <div key={match.id} className="px-4 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 flex items-center justify-between gap-3 font-mono text-[12px]">
          <span className="min-w-0">
            <span className="text-[var(--color-text-secondary)]">{match.match_number} · {match.map ? toSentenceCase(match.map) : '—'} · </span>
            {scrimTeamLabel(match.shirts, names)} <span className="text-[var(--color-text-secondary)]">vs</span> {scrimTeamLabel(match.skins, names)}
          </span>
          {canDiscard && <ScrimDiscardButton matchId={match.id} />}
        </div>
      ))}
    </div>
  );
}
