import { JSDOM } from 'jsdom';

const SHAPE_TAGS = new Set(['path', 'polygon', 'rect', 'circle']);
const ATTR_ORDER = ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'transform', 'points', 'd', 'fill-rule', 'clip-rule', 'fill'];

export interface ExtractedSvg {
  svg: string;
  width: number;
  height: number;
}

/**
 * Re-emits `rawSvg` as a minimal, `currentColor`-tintable SVG — stripping the XML prolog,
 * `<!DOCTYPE>`, generator comments, and `<g>` wrapper elements that Illustrator/Source2Viewer
 * exports carry, forcing every shape's fill to `currentColor`, and normalizing attribute order —
 * alongside its `viewBox` width/height, so callers can cross-check `src/lib/iconAspect.ts`'s
 * hand-copied aspect-ratio table against the real, current upstream shape.
 *
 * Used by `scripts/sync-icons.ts` to both re-extract upstream icons on a schedule and to diff
 * that output against what's committed under `public/{weapon,grenade,round,side,kill}-icons/` —
 * every one of those files must be *exactly* this function's own output (not hand-copied in a
 * different format) for that diff to mean "the upstream shape changed" rather than "the file
 * doesn't match this function's formatting," which would make every real sync run report every
 * icon as changed. `extractRecolorableSvg(rawSvg).svg` run back through `extractRecolorableSvg`
 * must therefore be a no-op — see `svgExtract.test.ts`'s idempotency test.
 */
export function extractRecolorableSvg(rawSvg: string): ExtractedSvg {
  const dom = new JSDOM(rawSvg, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;
  if (doc.querySelector('parsererror')) throw new Error('upstream file is not valid SVG/XML');

  const root = doc.documentElement;
  const viewBox = root.getAttribute('viewBox');
  if (!viewBox) throw new Error('upstream <svg> has no viewBox');
  const dims = viewBox.trim().split(/\s+/);
  const width = dims[2];
  const height = dims[3];

  const shapes: Element[] = [];
  const walk = (el: Element, insideSymbol: boolean) => {
    const tag = el.tagName?.toLowerCase() ?? '';
    if (tag === 'symbol') insideSymbol = true;
    if (SHAPE_TAGS.has(tag) && !insideSymbol) shapes.push(el);
    for (const child of Array.from(el.children)) walk(child, insideSymbol);
  };
  walk(root, false);
  if (shapes.length === 0) throw new Error('no path/polygon/rect/circle shapes found');

  const lines = shapes.map((el) => {
    const tag = el.tagName.toLowerCase();
    const attrs: Record<string, string> = {};
    const style = el.getAttribute('style');
    if (style) {
      for (const decl of style.split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) continue;
        attrs[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim();
      }
    }
    for (const name of ATTR_ORDER) {
      if (name === 'fill') continue;
      const v = el.getAttribute(name);
      if (v !== null) attrs[name] = v;
    }
    attrs.fill = 'currentColor';
    const ordered = ATTR_ORDER.filter((k) => k in attrs).map((k) => `${k}="${attrs[k]}"`);
    return `<${tag} ${ordered.join(' ')}/>`;
  });

  const svg = [
    `<svg width="${width}" height="${height}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    ...lines,
    `</svg>`,
    '',
  ].join('\n');
  return { svg, width: Number(width), height: Number(height) };
}
