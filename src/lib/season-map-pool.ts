import type { SupabaseClient } from '@supabase/supabase-js';
import { mapSlug } from './maps';

/** A regular season's map pool is either unset (signups can open before maps are decided) or
 * exactly this many maps. A season can't go live — confirm its schedule or be marked active —
 * until the pool is set. */
export const MAP_POOL_SIZE = 5;

export type NewMap = { name: string; workshopUrl: string };

export function hasMapPool(pool: string[] | null | undefined): boolean {
  return (pool?.length ?? 0) > 0;
}

const WORKSHOP_URL_RE = /^https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+/;

function extractWorkshopId(url: string): string | null {
  const match = url.match(/[?&]id=(\d+)/);
  return match ? match[1] : null;
}

async function fetchWorkshopPreviewImage(workshopUrl: string): Promise<string | null> {
  const fileId = extractWorkshopId(workshopUrl);
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
  | { ok: true; mapPool: string[]; newMaps: NewMap[] }
  | { ok: false; error: string };

/** Validates a request body's `map_pool` / `new_maps`. An empty (or absent) pool is valid — it
 * means "not decided yet" — anything else must be exactly `MAP_POOL_SIZE` maps. */
export function parseMapPoolInput(body: unknown): MapPoolInput {
  const raw = body as { map_pool?: unknown; new_maps?: unknown } | null;
  const mapPool: string[] = Array.isArray(raw?.map_pool) ? (raw.map_pool as string[]) : [];
  const newMaps: NewMap[] = Array.isArray(raw?.new_maps) ? (raw.new_maps as NewMap[]) : [];

  if (mapPool.length !== 0 && mapPool.length !== MAP_POOL_SIZE) {
    return { ok: false, error: `A map pool must be empty or exactly ${MAP_POOL_SIZE} maps` };
  }
  if (mapPool.some((m) => typeof m !== 'string' || !m.trim())) {
    return { ok: false, error: 'Map pool entries must be non-empty strings' };
  }
  for (const m of newMaps) {
    if (!m.name?.trim() || !WORKSHOP_URL_RE.test(m.workshopUrl ?? '')) {
      return { ok: false, error: 'New maps must have a name and valid Steam Workshop URL' };
    }
  }
  return { ok: true, mapPool, newMaps };
}

/** Upserts newly-entered maps into the `maps` table (fetching preview images from Steam). Returns
 * an error message on failure, `null` on success. */
export async function upsertNewMaps(supabaseAdmin: SupabaseClient, newMaps: NewMap[]): Promise<string | null> {
  if (newMaps.length === 0) return null;
  const rows = await Promise.all(
    newMaps.map(async (m) => ({
      name: m.name.trim().toLowerCase(),
      slug: mapSlug(m.name),
      workshop_url: m.workshopUrl,
      image_url: await fetchWorkshopPreviewImage(m.workshopUrl),
    })),
  );
  const { error } = await supabaseAdmin.from('maps').upsert(rows, { onConflict: 'slug' });
  return error ? error.message : null;
}
