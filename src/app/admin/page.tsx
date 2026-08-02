import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { AdminConsole } from '@/components/AdminConsole';
import {
  isPlayerAdmin,
  getBackgroundJobs,
  getOpsErrors,
  getAdminMatches,
  getAdminPlayers,
  getMapsForWorkshopPicker,
  getSeasons,
  getGauntletRounds,
} from '@/lib/queries';
import { getActiveServerMatch } from '@/lib/dathost-lifecycle';
import { listConfigSets } from '@/lib/dathost-config';
import { getAdminClient } from '@/lib/supabase-admin';
import { buildRegularToGauntletMap, isPlayedScore, extractSeasonNumber } from '@/lib/util';
import type { GauntletRow } from '@/components/GauntletLifecycleList';

export const metadata = {
  title: 'Admin',
  description: 'DGLS admin console — activity, jobs, and management in one view.',
};

// Live operational surface — don't cache.
export const dynamic = 'force-dynamic';

/**
 * Unified admin console (issue #262). One page, replacing the seven separate admin routes: a
 * standalone Server panel, an Activity feed (background jobs + ops errors), and Manage
 * (Match/Player/Season). This server component only gates access and fetches — `AdminConsole` owns
 * all the interactive composition, reusing the same panels/forms the old routes used unmodified.
 */
export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  const selfId = session.user.playerId;
  if (!(await isPlayerAdmin(selfId))) redirect('/');

  const adminClient = getAdminClient();
  const [jobs, opsErrors, matches, players, activeServerMatch, workshopMaps, seasons, configSets] =
    await Promise.all([
      getBackgroundJobs(),
      getOpsErrors(),
      getAdminMatches(),
      getAdminPlayers(),
      getActiveServerMatch(adminClient),
      getMapsForWorkshopPicker(),
      getSeasons(),
      listConfigSets(adminClient),
    ]);

  // Season lifecycle + gauntlet pairing — same derivation the old /admin/seasons/gauntlet page used.
  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);
  const paired = buildRegularToGauntletMap(regularSeasons, gauntletSeasons);
  const gauntletById = new Map(gauntletSeasons.map((g) => [g.id, g]));
  const seasonOpsErrors = opsErrors.filter((e) => e.entityType === 'season');
  const activeRegular = regularSeasons.filter((s) => s.status === 'ACTIVE');
  const eligibleForGauntlet = activeRegular
    .filter((s) => !paired.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));
  const gauntletsInProgress: GauntletRow[] = await Promise.all(
    activeRegular
      .filter((s) => paired.has(s.id))
      .map(async (s) => {
        const gauntletId = paired.get(s.id)!;
        const rounds = await getGauntletRounds(gauntletId);
        const seeded = rounds.length > 0;
        const started = rounds.some((r) => r.matches.some((m) => isPlayedScore(m.final_score)));
        return {
          regularSeasonId: s.id,
          regularSeasonName: s.name,
          gauntletName: gauntletById.get(gauntletId)?.name ?? `Season ${gauntletId} Gauntlet`,
          seeded,
          started,
        };
      }),
  );

  // Next season's default name — shown on the "+ New Season" link, which now points at its own page
  // (/admin/seasons/new) rather than an inline form; the create flow's own map-pool derivation lives
  // there.
  let maxNum = 0;
  for (const s of seasons) {
    if (s.is_gauntlet) continue;
    const n = extractSeasonNumber(s.name);
    if (n !== null && n > maxNum) maxNum = n;
  }
  const nextSeasonName = `Season ${maxNum + 1} Regular Season`;

  const allSeasons = [...seasons]
    .sort((a, b) => b.id - a.id)
    .map((s) => ({ id: s.id, name: s.name, status: s.status, isGauntlet: s.is_gauntlet }));

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Admin' }]} />
      <main className="max-w-[1200px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Admin</div>
        </div>

        <AdminConsole
          jobs={jobs}
          opsErrors={opsErrors}
          matches={matches}
          players={players}
          selfId={selfId}
          server={{ active: activeServerMatch, configSets, maps: workshopMaps }}
          season={{
            allSeasons,
            eligibleForGauntlet,
            gauntletsInProgress,
            seasonOpsErrors,
            nextSeasonName,
          }}
        />
      </main>
    </div>
  );
}
