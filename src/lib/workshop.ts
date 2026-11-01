// Steam Workshop links: what counts as one, how to read the item id out of one, and what Steam says
// the item is. Every caller — the map-pool validator, DatHost map pinning, the radar build, scrim
// matches on any workshop map — goes through here.

/** The item id in a link's query string (`?id=<digits>` or `&id=<digits>`), ending at `&`, `#`
 * or the end of the string. */
const ID_PARAM_RE = /[?&]id=(\d+)(?:[&#]|$)/;

/** The part of a link before its query: `https://` + steamcommunity.com (with or without `www.`)
 * + `sharedfiles/` or `workshop/` + `filedetails/`. */
const ITEM_PAGE_RE = /^https:\/\/(www\.)?steamcommunity\.com\/(sharedfiles|workshop)\/filedetails\/?\?/;

/** The Workshop item id of a stored `maps.workshop_url`, from its `id` query parameter. `null`
 * for a missing link or one without a well-formed `id`. */
export function workshopIdFromUrl(url: string | null | undefined): string | null {
  return url?.match(ID_PARAM_RE)?.[1] ?? null;
}

/** The Workshop item id from free text an admin typed: a link (`workshopIdFromUrl()`), otherwise
 * the first run of six or more digits, so a bare id or a `steam://` link also resolves. */
export function workshopIdFromInput(input: string | null | undefined): string | null {
  return workshopIdFromUrl(input) ?? input?.match(/\d{6,}/)?.[0] ?? null;
}

/** Whether `workshopUrl` is a Steam Workshop item link: an item page (see `ITEM_PAGE_RE`) whose
 * query carries a well-formed `id` (see `workshopIdFromUrl()`). A format check only — it doesn't
 * confirm the item exists. */
export function isValidWorkshopUrl(workshopUrl: string): boolean {
  const url = workshopUrl.trim();
  return ITEM_PAGE_RE.test(url) && workshopIdFromUrl(url) !== null;
}

/** A Workshop item's title and preview image from Steam (`GetPublishedFileDetails`, no API key), or
 *  `null` when Steam can't be reached or doesn't know the item. */
export async function fetchWorkshopItem(fileId: string): Promise<{ title: string | null; previewUrl: string | null } | null> {
  try {
    const res = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `itemcount=1&publishedfileids[0]=${fileId}`,
    });
    const data = await res.json();
    const detail = data?.response?.publishedfiledetails?.[0];
    if (!detail) return null;
    return { title: detail.title || null, previewUrl: detail.preview_url ?? null };
  } catch {
    return null;
  }
}
