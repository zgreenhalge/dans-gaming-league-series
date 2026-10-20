import { seasonTitle, weekLabel } from './util';

export interface Crumb {
  label: string;
  href?: string;
}

// Every public URL for a season's sub-pages is assembled here, so a link and the breadcrumb that
// points back at it can't drift apart. Segments are readable, the ids in them are real: `seasonId`
// is always the season *hub* (the regular season; a gauntlet is reached through its paired regular
// season), `weekId` is `weeks.id` of a regular week, a round is identified by its number within the
// gauntlet (it has no row of its own, and exists in the bracket before any game is scheduled), and
// `podId` is `gauntlet_pods.id`.

export function seasonHref(hubSeasonId: number): string {
  return `/seasons/${hubSeasonId}`;
}

export function gauntletHref(hubSeasonId: number): string {
  return `/seasons/${hubSeasonId}?view=gauntlet`;
}

/** The season hub's Schedule tab. */
export function seasonScheduleHref(hubSeasonId: number): string {
  return `${seasonHref(hubSeasonId)}?tab=schedule`;
}

/** The season hub's Gauntlet view opened on its Schedule tab. */
export function gauntletScheduleHref(hubSeasonId: number): string {
  return `${gauntletHref(hubSeasonId)}&tab=schedule`;
}

/** A pair's H2H matchup on a page that renders `H2HSection` — `basePath` is `/statistics` (career)
 *  or a season hub (`seasonHref()`). Writes the `a`/`b`/`type` params `useH2HPairUrlState()` reads:
 *  names, with `type` omitted for the default `'partner'`. */
export function h2hPairHref(basePath: string, aName: string, bName: string, type: 'partner' | 'opponent'): string {
  const params = new URLSearchParams({ tab: 'h2h', a: aName, b: bName });
  if (type === 'opponent') params.set('type', 'opponent');
  return `${basePath}?${params.toString()}`;
}

export function weekHref(hubSeasonId: number, weekId: number): string {
  return `/seasons/${hubSeasonId}/weeks/${weekId}`;
}

/** The season hub's Schedule tab opened at a week — where a week page's heading links back to. */
export function seasonWeekHref(hubSeasonId: number, weekId: number): string {
  return `${seasonHref(hubSeasonId)}?tab=schedule&week=${weekId}`;
}

export function roundHref(hubSeasonId: number, roundNumber: number): string {
  return `/seasons/${hubSeasonId}/rounds/${roundNumber}`;
}

export function groupHref(hubSeasonId: number, podId: number): string {
  return `/seasons/${hubSeasonId}/groups/${podId}`;
}

/** "Group N" (1-indexed) or "Final" for the bracket's one final pod — the one label for a pod
 *  everywhere it's named (breadcrumbs, round list, group page). */
export function groupName(podIndex: number, isFinal: boolean): string {
  return isFinal ? 'Final' : `Group ${podIndex + 1}`;
}

export interface CrumbTrail {
  /** The season hub: the regular season (or an orphan gauntlet standing alone). */
  season: { id: number; name: string };
  /** The trail runs through the paired gauntlet — adds a "Gauntlet" level. */
  gauntlet?: boolean;
  /** A regular-season week. */
  week?: { id: number; number: number };
  /** A gauntlet round number (the trail is a gauntlet one). */
  round?: number;
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
  if (trail.week) crumbs.push({ label: weekLabel(trail.week.number, false), href: weekHref(hub, trail.week.id) });
  if (trail.round != null) crumbs.push({ label: weekLabel(trail.round, true), href: roundHref(hub, trail.round) });
  if (trail.group) {
    crumbs.push({ label: groupName(trail.group.podIndex, trail.group.isFinal), href: groupHref(hub, trail.group.id) });
  }
  if (trail.leaf) crumbs.push({ label: trail.leaf });

  const last = crumbs.length - 1;
  crumbs[last] = { label: crumbs[last].label };
  return crumbs;
}

/** The heading a week, round or group page shows over its content: a link to the season (or its
 *  gauntlet) above the stage's own name. Built from the same labels and URLs as `buildCrumbs()`, so
 *  the heading and the breadcrumbs name the stage identically. */
export interface StageHeading {
  parent: { label: string; href: string };
  /** The stage's name, top level first; a level with an `href` links to its own page (a group page
   *  links its round). */
  title: Crumb[];
}

export function stageHeading(trail: CrumbTrail): StageHeading {
  const hub = trail.season.id;
  if (trail.week) {
    return {
      parent: { label: seasonTitle(trail.season.name), href: seasonWeekHref(hub, trail.week.id) },
      title: [{ label: weekLabel(trail.week.number, false) }],
    };
  }
  const parent = { label: `${seasonTitle(trail.season.name)} Gauntlet`, href: gauntletHref(hub) };
  if (trail.round == null) return { parent, title: [] };
  const round = weekLabel(trail.round, true);
  if (!trail.group) return { parent, title: [{ label: round }] };
  return {
    parent,
    title: [{ label: round, href: roundHref(hub, trail.round) }, { label: groupName(trail.group.podIndex, trail.group.isFinal) }],
  };
}

/** A link from a stage page out of its own set of stages, to the other side of a season: a week page
 *  into the gauntlet (`forward`), a gauntlet page back to the regular season (`back`). The nav strip
 *  places a `back` link above its chips and a `forward` link below them. */
export interface StageNavLink {
  label: string;
  href: string;
  direction: 'back' | 'forward';
}

/** The gauntlet page's way back to the regular season; none for a gauntlet with no regular season of
 *  its own to go back to (`hub` is itself the gauntlet). */
export function regularSeasonLink(hub: { id: number; is_gauntlet: boolean }): StageNavLink | undefined {
  return hub.is_gauntlet ? undefined : { label: '← Regular season', href: seasonHref(hub.id), direction: 'back' };
}

/** The week page's way into the gauntlet, at its first round; none while the season has no gauntlet
 *  round (`firstRound` is `null`). */
export function gauntletLink(hubSeasonId: number, firstRound: number | null): StageNavLink | undefined {
  return firstRound == null ? undefined : { label: 'Gauntlet →', href: roundHref(hubSeasonId, firstRound), direction: 'forward' };
}
