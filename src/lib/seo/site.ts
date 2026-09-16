/** Canonical site origin (no trailing slash) — used for metadataBase, OG URLs, robots.txt, and the sitemap. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dans-gaming-league-series.vercel.app';

/** A match's page on the site — the one place this URL shape is assembled, shared by every Discord
 *  caller that needs to point at a match (an embed's `url`, a masked link in a message) rather than
 *  each interpolating `${SITE_URL}/matches/${id}` itself. */
export function matchUrl(matchId: number): string {
  return `${SITE_URL}/matches/${matchId}`;
}
