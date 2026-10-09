import type { SupabaseClient } from '@supabase/supabase-js';
import { mapSlug } from './maps';
import { workshopIdFromUrl } from './replay/radar';

/** A regular season's map pool is either unset (signups can open before maps are decided) or
 * exactly this many maps. A season can't go live — confirm its schedule or be marked active —
 * until the pool is set. */
export const MAP_POOL_SIZE = 5;

export type NewMap = { name: string; workshopUrl: string };

export function hasMapPool(pool: string[] | null | undefined): boolean {
  return (pool?.length ?? 0) > 0;
}

const WORKSHOP_URL_RE =
  /^https:\/\/(www\.)?steamcommunity\.com\/(sharedfiles|workshop)\/filedetails\/\?id=\d+(&|$)/;

/** Shown beside `MapPoolPicker`'s Add button when the entered link fails `isValidWorkshopUrl()`. */
export const WORKSHOP_URL_HINT =
  'Use a Steam Workshop item link: https://steamcommunity.com/sharedfiles/filedetails/?id=<number>';

/** Whether `workshopUrl` is a Steam Workshop item link: `https://steamcommunity.com/` (with or
 * without `www.`) `sharedfiles/` or `workshop/` `filedetails/?id=<digits>`, the id ending at `&` or
 * the end of the string. A format check only — it doesn't confirm the item exists. */
export function isValidWorkshopUrl(workshopUrl: string): boolean {
  return WORKSHOP_URL_RE.test(workshopUrl.trim());
}

/** Whether a new map can be added: a non-blank name and a Steam Workshop item link. The one rule
 * behind both `parseMapPoolInput()` and `MapPoolPicker`'s Add button. Both arguments are trimmed. */
export function isValidNewMap(name: string, workshopUrl: string): boolean {
  return !!name.trim() && isValidWorkshopUrl(workshopUrl);
}

async function fetchWorkshopPreviewImage(workshopUrl: string): Promise<string | null> {
  const fileId = workshopIdFromUrl(workshopUrl);
  if (!fileId) return null;
  try {
    const res = await fetch(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `itemcount=1&publishedfileids[0]=${fileId}`,
      },
    );
    const data = await res.json();
    const detail = data?.response?.publishedfiledetails?.[0];
    return detail?.preview_url ?? null;
  } catch {
    return null;
  }
}

export type MapPoolInput =
  | { ok: true; mapPool: string[] | null; newMaps: NewMap[] }
  | { ok: false; error: string };

/** Validates a request body's `map_pool` / `new_maps`. An empty (or absent) pool is valid — it
 * means "not decided yet" and comes back as `null`, ready to store — anything else must be exactly
 * `MAP_POOL_SIZE` distinct maps. Pool names are trimmed and lowercased, the form every other map
 * comparison in the app expects. */
export function parseMapPoolInput(body: unknown): MapPoolInput {
  const raw = body as { map_pool?: unknown; new_maps?: unknown } | null;
  const rawPool: unknown[] = Array.isArray(raw?.map_pool) ? raw.map_pool : [];
  const rawNewMaps: unknown[] = Array.isArray(raw?.new_maps) ? raw.new_maps : [];

  if (rawPool.some((m) => typeof m !== 'string' || !m.trim())) {
    return { ok: false, error: 'Map pool entries must be non-empty strings' };
  }
  const mapPool = [...new Set((rawPool as string[]).map((m) => m.trim().toLowerCase()))];
  if (mapPool.length !== 0 && mapPool.length !== MAP_POOL_SIZE) {
    return { ok: false, error: `A map pool must be empty or exactly ${MAP_POOL_SIZE} distinct maps` };
  }

  const newMaps = rawNewMaps as (Partial<NewMap> | null)[];
  const validNewMap = (m: Partial<NewMap> | null) =>
    typeof m?.name === 'string' && typeof m.workshopUrl === 'string' && isValidNewMap(m.name, m.workshopUrl);
  if (!newMaps.every(validNewMap)) {
    return { ok: false, error: 'New maps must have a name and valid Steam Workshop URL' };
  }
  return { ok: true, mapPool: mapPool.length > 0 ? mapPool : null, newMaps: newMaps as NewMap[] };
}

/** Upserts newly-entered maps into the `maps` table (fetching preview images from Steam). Returns
 * an error message on failure, `null` on success. */
export async function upsertNewMaps(supabaseAdmin: SupabaseClient, newMaps: NewMap[]): Promise<string | null> {
  if (newMaps.length === 0) return null;
  const rows = await Promise.all(
    newMaps.map(async (m) => {
      const workshopUrl = m.workshopUrl.trim();
      return {
        name: m.name.trim().toLowerCase(),
        slug: mapSlug(m.name),
        workshop_url: workshopUrl,
        image_url: await fetchWorkshopPreviewImage(workshopUrl),
      };
    }),
  );
  const { error } = await supabaseAdmin.from('maps').upsert(rows, { onConflict: 'slug' });
  return error ? error.message : null;
}
