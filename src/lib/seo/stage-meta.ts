import { parseScore } from '../util';

/** The matchups of a week or group as a one-line preview — "A & B 13–9 C & D · …" — for a link's
 *  description and the page's Open Graph card. Unplayed games list the pairing without a score;
 *  games with no roster yet are skipped. */
export function describeMatchups(
  matches: { final_score: string | null; shirts_stats: { player_name: string }[]; skins_stats: { player_name: string }[] }[],
): string {
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
