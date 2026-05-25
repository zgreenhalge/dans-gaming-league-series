/**
 * Returns true if a `final_score` string represents a real played result.
 * Treats null and "0-0" / "0 - 0" as not yet played (S3 matches are pre-staged
 * with "0-0" placeholders before stats are entered).
 */
export function isPlayedScore(finalScore: string | null | undefined): boolean {
  if (!finalScore) return false;
  return !/^\s*0\s*[-–]\s*0\s*$/.test(finalScore);
}

/** Parses "13-9" / "13 – 9" into { shirts, skins }. Returns null if unparseable. */
export function parseScore(
  s: string | null | undefined,
): { shirts: number; skins: number } | null {
  if (!s) return null;
  const m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  return { shirts: Number(m[1]), skins: Number(m[2]) };
}
