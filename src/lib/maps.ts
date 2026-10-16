// Map utilities: display name casing, slug normalisation, and image lookup.
// Map images and workshop URLs are stored in the `maps` table in Supabase.
// Client components access them via MapContext; server code uses getMapLookup().

export function toSentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function mapSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The map page's Maps & Sides stats view (score distribution, per-side figures). */
export function mapSidesHref(raw: string): string {
  return `/maps/${mapSlug(raw)}?tab=stats&stab=sides`;
}

type ImageLookup = Record<string, { image_url: string | null }>;

export function mapImageFor(
  raw: string | null | undefined,
  lookup: ImageLookup,
): string | undefined {
  if (!raw) return undefined;
  return lookup[mapSlug(raw)]?.image_url ?? undefined;
}
