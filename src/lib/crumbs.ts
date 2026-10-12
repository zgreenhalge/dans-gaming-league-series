import type { Crumb } from '@/components/TopbarShell';
import { seasonTitle } from './util';

// Every public URL for a season's sub-pages is assembled here, so a link and the breadcrumb that
// points back at it can't drift apart. Segments are readable, the ids in them are real: `seasonId`
// is always the season *hub* (the regular season; a gauntlet is reached through its paired regular
// season), `weekId` is `weeks.id` (a regular week or a gauntlet round), `podId` is
// `gauntlet_pods.id`.

export function seasonHref(hubSeasonId: number): string {
  return `/seasons/${hubSeasonId}`;
}

export function gauntletHref(hubSeasonId: number): string {
  return `/seasons/${hubSeasonId}?view=gauntlet`;
}

export function weekHref(hubSeasonId: number, weekId: number): string {
  return `/seasons/${hubSeasonId}/weeks/${weekId}`;
}

export function roundHref(hubSeasonId: number, weekId: number): string {
  return `/seasons/${hubSeasonId}/rounds/${weekId}`;
}

export function groupHref(hubSeasonId: number, podId: number): string {
  return `/seasons/${hubSeasonId}/groups/${podId}`;
}

/** "Group N" (1-indexed) or "Final" for the bracket's one final pod — the one label for a pod
 *  everywhere it's named (breadcrumbs, round list, group page). */
export function groupLabel(podIndex: number, isFinal: boolean): string {
  return isFinal ? 'Final' : `Group ${podIndex + 1}`;
}

/** "Week N" for a regular season, "Round N" for a gauntlet. */
export function weekLabel(weekNumber: number, isGauntlet: boolean): string {
  return `${isGauntlet ? 'Round' : 'Week'} ${weekNumber}`;
}

export interface CrumbTrail {
  /** The season hub: the regular season (or an orphan gauntlet standing alone). */
  season: { id: number; name: string };
  /** The trail runs through the paired gauntlet — adds a "Gauntlet" level. */
  gauntlet?: boolean;
  /** A regular week, or a gauntlet round (`gauntlet` decides the word). */
  week?: { id: number; number: number };
  group?: { id: number; podIndex: number; isFinal: boolean };
  /** The page's leaf below the week/group, e.g. "Match 2" or "Game 1". */
  leaf?: string;
}

/**
 * The one breadcrumb trail for everything under a season:
 *
 *   DGLS › Seasons › Season 5 › Week 3 › Match 2
 *   DGLS › Seasons › Season 5 › Gauntlet › Round 2 › Group 1 › Game 2
 *
 * Every level but the last links to its page; the last is plain text.
 */
export function buildCrumbs(trail: CrumbTrail): Crumb[] {
  const hub = trail.season.id;
  const crumbs: Crumb[] = [
    { label: 'DGLS', href: '/' },
    { label: 'Seasons', href: '/seasons' },
    { label: seasonTitle(trail.season.name), href: seasonHref(hub) },
  ];
  if (trail.gauntlet) crumbs.push({ label: 'Gauntlet', href: gauntletHref(hub) });
  if (trail.week) {
    crumbs.push({
      label: weekLabel(trail.week.number, !!trail.gauntlet),
      href: trail.gauntlet ? roundHref(hub, trail.week.id) : weekHref(hub, trail.week.id),
    });
  }
  if (trail.group) {
    crumbs.push({ label: groupLabel(trail.group.podIndex, trail.group.isFinal), href: groupHref(hub, trail.group.id) });
  }
  if (trail.leaf) crumbs.push({ label: trail.leaf });

  const last = crumbs.length - 1;
  crumbs[last] = { label: crumbs[last].label };
  return crumbs;
}
