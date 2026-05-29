// Map utilities: display name casing, slug normalisation, and backdrop image lookup.
// Image keys use mapSlug(rawDBString) — lowercase, non-alphanumeric → hyphens.
// Drop new images into /public/maps/ and add an entry to MAP_IMAGES.

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

const MAP_IMAGES: Record<string, string> = {
  'foroglio':   '/maps/foroglio.jpg',
  'ganny':      '/maps/ganny.jpg',
  'memento':    '/maps/memento.jpg',
  'palais':     '/maps/palais.jpg',
  'rooftop':    '/maps/rooftop.jpg',
  'vandal':     '/maps/vandal.jpg',
  'drawbridge': '/maps/drawbridge.jpg',
  'splat':      '/maps/splat.jpg',
  'debris':     '/maps/debris.jpg',
  'assembly':   '/maps/assembly.jpg',
  'brewery':    '/maps/brewery.jpg',
};

export function mapImageFor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return MAP_IMAGES[mapSlug(raw)];
}
