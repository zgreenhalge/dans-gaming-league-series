// Per-map backdrop images for match cards.
// Keys are produced by mapSlug(rawDBString) — lowercase, non-alphanumeric → hyphens.
// Drop new images into /public/maps/ and add an entry here.

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
