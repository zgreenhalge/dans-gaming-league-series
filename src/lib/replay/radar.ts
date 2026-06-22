// Pure helpers for the radar-build pipeline (Phase 3) — the bits worth locking with
// tests. The fragile parts (SteamCMD download, VPK extraction, .vtex_c decode) are
// shell orchestration and live in `scripts/radar-build.ts`; this module only does the
// deterministic parsing those steps feed into. See `docs/replay.md`.

/** The world→radar-image transform a CS `resource/overviews/<map>.txt` defines. */
export interface OverviewCalibration {
  /** World X of the radar image's top-left corner. */
  posX: number;
  /** World Y of the radar image's top-left corner. */
  posY: number;
  /** World units per radar-image pixel. */
  scale: number;
  /** Radar material reference (e.g. `overviews/de_dust2_radar_psd`), if present. */
  material: string | null;
}

/**
 * Parse the authoritative offset/scale out of a CS overview KeyValues file. We read
 * the three numeric keys directly rather than fully parsing KV — the format is flat
 * and the keys are unique, so a targeted match is both simpler and more robust to the
 * minor format variations across community maps.
 */
export function parseOverview(text: string): OverviewCalibration | null {
  const num = (key: string): number | null => {
    const m = text.match(new RegExp(`"${key}"\\s+"(-?[0-9.]+)"`, 'i'));
    return m ? Number(m[1]) : null;
  };
  const posX = num('pos_x');
  const posY = num('pos_y');
  const scale = num('scale');
  if (posX === null || posY === null || scale === null || scale === 0) return null;
  const matMatch = text.match(/"material"\s+"([^"]+)"/i);
  return { posX, posY, scale, material: matMatch ? matMatch[1] : null };
}

/**
 * Extract the numeric Steam Workshop file id from a workshop URL (the value
 * SteamCMD's `+workshop_download_item 730 <id>` needs). Handles the canonical
 * `?id=` form and falls back to the first long digit run.
 */
export function workshopIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const byParam = url.match(/[?&]id=(\d+)/);
  if (byParam) return byParam[1];
  const byDigits = url.match(/(\d{6,})/);
  return byDigits ? byDigits[1] : null;
}
