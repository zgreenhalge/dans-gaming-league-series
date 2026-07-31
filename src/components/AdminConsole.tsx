'use client';

// The unified admin console (issue #262): a standalone Server panel (always visible — one shared
// server for every match and scrim isn't "an event" or "a thing to search for"), an Activity feed
// (background jobs + ops errors, tiered Errored/In Progress/Completed), and Manage (Match/Player/
// Season). Activity and Manage are top-level tabs rather than one crowded view — see
// docs/visual-conventions.md's "Console & admin-surface shapes" for the reasoning. Initial section is
// read once from the URL (`?section=`/`&type=`) so the old per-tool routes can redirect here and land
// on the right view — one-way, matching this codebase's only existing deep-link precedent
// (`CareerStatsView`); clicking a tab afterward only updates local state, same as there.

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TabBar from './TabBar';
import { tabCls } from '@/lib/util';
import { ServerConsolePanel } from './ServerConsolePanel';
import { AdminActivityFeed } from './AdminActivityFeed';
import { MatchManager } from './MatchManager';
import { PlayerManager } from './PlayerManager';
import { SeasonManager, type SeasonSummary } from './SeasonManager';
import type { OpsErrorItem } from './OpsErrorList';
import type { GauntletRow } from './GauntletLifecycleList';
import type { BackgroundJobRow } from '@/lib/jobs';
import type { AdminMatchRow, WorkshopMapOption } from '@/lib/queries';
import type { Player } from '@/lib/types';
import type { ActiveServerMatch } from '@/lib/dathost-lifecycle';
import type { ConfigSetOption } from '@/lib/dathost';

type Section = 'activity' | 'manage';
type ManageType = 'match' | 'player' | 'season';

export function AdminConsole({
  jobs,
  opsErrors,
  matches,
  players,
  selfId,
  server,
  season,
}: {
  jobs: BackgroundJobRow[];
  opsErrors: OpsErrorItem[];
  matches: AdminMatchRow[];
  players: Player[];
  selfId: number | null;
  server: { active: ActiveServerMatch | null; configSets: ConfigSetOption[]; maps: WorkshopMapOption[] };
  season: {
    allSeasons: SeasonSummary[];
    eligibleForGauntlet: { id: number; name: string }[];
    gauntletsInProgress: GauntletRow[];
    seasonOpsErrors: OpsErrorItem[];
    knownMaps: string[];
    nextSeasonName: string;
  };
}) {
  const searchParams = useSearchParams();
  const [sectionState, setSection] = useState<Section>(
    searchParams.get('section') === 'manage' ? 'manage' : 'activity',
  );
  const [manageType, setManageType] = useState<ManageType>(() => {
    const t = searchParams.get('type');
    return t === 'player' || t === 'season' ? t : 'match';
  });
  // Set by an Activity-tab ops error's "Open in Manage" jump — prefills the target's search/focus.
  // `jumpType` guards against the query leaking into a different tab the user switches to manually
  // afterward (a jump to Player shouldn't leave a player's name sitting in Match's search box).
  const [jump, setJump] = useState<{ type: ManageType; query: string; nonce: number } | null>(null);

  function jumpToManage(type: ManageType, query: string) {
    setSection('manage');
    setManageType(type);
    setJump((prev) => ({ type, query, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  const jumpQueryFor = (type: ManageType) => (jump?.type === type ? jump.query : '');
  // Re-mounting on every jump (via this key) is what makes a fresh `initialQuery` actually take
  // effect — MatchManager/PlayerManager's search state only reads its initial prop at mount.
  const jumpNonce = jump?.nonce ?? 0;

  const section = sectionState;

  return (
    <div className="flex flex-col gap-6">
      <ServerConsolePanel active={server.active} configSets={server.configSets} maps={server.maps} />

      <TabBar bordered className="pb-1">
        <button onClick={() => setSection('activity')} className={tabCls(section === 'activity', { accent: true })}>
          Activity
        </button>
        <button onClick={() => setSection('manage')} className={tabCls(section === 'manage', { accent: true })}>
          Manage
        </button>
      </TabBar>

      {section === 'activity' && (
        <AdminActivityFeed jobs={jobs} opsErrors={opsErrors} onJump={jumpToManage} />
      )}

      {section === 'manage' && (
        <div className="flex flex-col gap-4">
          <TabBar>
            <button onClick={() => setManageType('match')} className={tabCls(manageType === 'match', { compact: true })}>
              Match
            </button>
            <button onClick={() => setManageType('player')} className={tabCls(manageType === 'player', { compact: true })}>
              Player
            </button>
            <button onClick={() => setManageType('season')} className={tabCls(manageType === 'season', { compact: true })}>
              Season
            </button>
          </TabBar>

          {manageType === 'match' && (
            <MatchManager key={jumpNonce} matches={matches} initialQuery={jumpQueryFor('match')} />
          )}
          {manageType === 'player' && (
            <PlayerManager key={jumpNonce} players={players} selfId={selfId} initialQuery={jumpQueryFor('player')} />
          )}
          {manageType === 'season' && (
            <SeasonManager
              key={jumpNonce}
              allSeasons={season.allSeasons}
              eligibleForGauntlet={season.eligibleForGauntlet}
              gauntletsInProgress={season.gauntletsInProgress}
              seasonOpsErrors={season.seasonOpsErrors}
              knownMaps={season.knownMaps}
              nextSeasonName={season.nextSeasonName}
              focusLabel={jumpQueryFor('season')}
            />
          )}
        </div>
      )}
    </div>
  );
}
