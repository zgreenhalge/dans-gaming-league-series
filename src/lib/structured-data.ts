import { SITE_URL } from './site';
import { matchTitle } from './util';

/**
 * Serializes a JSON-LD object for a `<script type="application/ld+json">` tag. Escapes `<` so a
 * string value (e.g. a player or season name) can never prematurely close the script element.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

interface MatchRosterPlayer {
  player_id: number;
  player_name: string;
}

/**
 * Builds `SportsEvent` JSON-LD for a match page. Returns `null` when the match doesn't have a
 * full 2v2 roster on both sides — an ad-hoc `Organization` per side only makes sense once both
 * factions are staffed, mirroring the roster gate already used for the scouting report.
 */
export function buildMatchJsonLd(params: {
  matchId: number;
  seasonName: string;
  weekNumber: number;
  isGauntlet: boolean;
  matchNumber: number;
  scheduledAt: string | null;
  played: boolean;
  score: { shirts: number; skins: number } | null;
  recordingUrl: string | null;
  shirts: MatchRosterPlayer[];
  skins: MatchRosterPlayer[];
}): Record<string, unknown> | null {
  const { shirts, skins } = params;
  if (shirts.length !== 2 || skins.length !== 2) return null;

  const name = matchTitle({
    seasonName: params.seasonName,
    weekNumber: params.weekNumber,
    matchNumber: params.matchNumber,
    isGauntlet: params.isGauntlet,
  });
  const asPerson = (p: MatchRosterPlayer) => ({
    '@type': 'Person',
    name: p.player_name,
    url: `${SITE_URL}/players/${p.player_id}`,
  });

  const shirtNames = shirts.map((p) => p.player_name).join(' & ');
  const skinNames = skins.map((p) => p.player_name).join(' & ');
  const description = params.score
    ? `${shirtNames} vs ${skinNames}, ${params.score.shirts}–${params.score.skins}`
    : `${shirtNames} vs ${skinNames}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name,
    description,
    url: `${SITE_URL}/matches/${params.matchId}`,
    ...(params.scheduledAt ? { startDate: params.scheduledAt } : {}),
    ...(!params.played ? { eventStatus: 'https://schema.org/EventScheduled' } : {}),
    ...(params.recordingUrl
      ? { location: { '@type': 'VirtualLocation', url: params.recordingUrl } }
      : {}),
    competitor: [
      { '@type': 'Organization', name: 'Shirts', member: shirts.map(asPerson) },
      { '@type': 'Organization', name: 'Skins', member: skins.map(asPerson) },
    ],
  };
}

/**
 * Builds `Person` JSON-LD for a player profile page. Career stats have no native schema.org
 * property, so they're attached via `additionalProperty` (`PropertyValue`) — schema.org's
 * sanctioned mechanism for facts outside the core vocabulary, rather than an invented field.
 */
export function buildPlayerJsonLd(params: {
  playerId: number;
  name: string;
  kd: string | null;
  adr: string | null;
  ehog: number | null;
}): Record<string, unknown> {
  const additionalProperty: { '@type': string; name: string; value: string | number }[] = [];
  if (params.kd != null) additionalProperty.push({ '@type': 'PropertyValue', name: 'K/D Ratio', value: params.kd });
  if (params.adr != null) additionalProperty.push({ '@type': 'PropertyValue', name: 'ADR', value: params.adr });
  if (params.ehog != null) additionalProperty.push({ '@type': 'PropertyValue', name: 'EHOG Rating', value: params.ehog });

  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: params.name,
    url: `${SITE_URL}/players/${params.playerId}`,
    ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
  };
}

/**
 * Builds `SportsEvent` JSON-LD for a season page, with the season's matches as `subEvent`
 * entries. Returns `null` when the season has no `start_date` to anchor the event on.
 */
export function buildSeasonJsonLd(params: {
  seasonId: number;
  seasonTitle: string;
  startDate: string | null;
  endDate: string | null;
  matches: { id: number; name: string; startDate: string | null }[];
}): Record<string, unknown> | null {
  if (!params.startDate) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: params.seasonTitle,
    url: `${SITE_URL}/seasons/${params.seasonId}`,
    startDate: params.startDate,
    ...(params.endDate ? { endDate: params.endDate } : {}),
    subEvent: params.matches.map((m) => ({
      '@type': 'SportsEvent',
      name: m.name,
      url: `${SITE_URL}/matches/${m.id}`,
      ...(m.startDate ? { startDate: m.startDate } : {}),
    })),
  };
}
