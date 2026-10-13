import { parseScore, seasonTitle, weekLabel } from '../util';

/** The matchups of a week or group as a one-line preview — "A & B 13–9 C & D · …" — for a link's
 *  description and the page's Open Graph card. Unplayed games list the pairing without a score;
 *  games with no roster yet are skipped. */
export function describeMatchups(matches: PreviewMatch[]): string {
  return matches
    .filter((m) => m.shirts_stats.length > 0 && m.skins_stats.length > 0)
    .map((m) => {
      const shirts = m.shirts_stats.map((p) => p.player_name).join(' & ');
      const skins = m.skins_stats.map((p) => p.player_name).join(' & ');
      const score = parseScore(m.final_score);
      return score && score.shirts + score.skins > 0
        ? `${shirts} ${score.shirts}–${score.skins} ${skins}`
        : `${shirts} vs ${skins}`;
    })
    .join(' · ');
}

/** "Season 5 · Week 3" — a week page's title, for its heading, metadata and Open Graph card. */
export function weekTitle(seasonName: string, weekNumber: number): string {
  return `${seasonTitle(seasonName)} · ${weekLabel(weekNumber, false)}`;
}

/** "Season 5 Gauntlet · Round 2". */
export function roundTitle(hubSeasonName: string, roundNumber: number): string {
  return `${seasonTitle(hubSeasonName)} Gauntlet · ${weekLabel(roundNumber, true)}`;
}

/** "Season 5 Gauntlet · Round 2 · Group 1" (or "· Final"). */
export function groupTitle(hubSeasonName: string, roundNumber: number, groupLabel: string | null): string {
  return `${roundTitle(hubSeasonName, roundNumber)}${groupLabel ? ` · ${groupLabel}` : ''}`;
}

/** Matches in the shape the previews read: both rosters (names only) and the score. */
export interface PreviewMatch {
  final_score: string | null;
  shirts_stats: { player_name: string }[];
  skins_stats: { player_name: string }[];
}
