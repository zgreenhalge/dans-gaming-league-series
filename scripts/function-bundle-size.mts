// Report the uncompressed size of each server route's function bundle from the traces `next build`
// writes (`.next/server/**/*.nft.json`), plus the packages contributing most across all routes.
// The total approximates the Function Storage one deployment adds — see `docs/vercel.md`.
//
//   npm run build && node scripts/function-bundle-size.mts [top=10]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const top = Number(process.argv[2] ?? 10);
const traces = (readdirSync('.next/server', { recursive: true }) as string[])
  .filter((f) => f.endsWith('.nft.json'))
  .map((f) => join('.next/server', f));
if (traces.length === 0) throw new Error('No .next/server/**/*.nft.json traces; run `npm run build` first');

const routes: [string, number][] = [];
const packages = new Map<string, number>();
for (const trace of traces) {
  let size = 0;
  for (const rel of JSON.parse(readFileSync(trace, 'utf8')).files as string[]) {
    const file = normalize(join(dirname(trace), rel));
    let bytes: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      bytes = st.size;
    } catch {
      continue;
    }
    size += bytes;
    const pkg = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];
    if (pkg) packages.set(pkg, (packages.get(pkg) ?? 0) + bytes);
  }
  routes.push([trace.replace(/^\.next\/server\/|\.nft\.json$/g, ''), size]);
}

const mb = (b: number) => `${(b / 1e6).toFixed(1).padStart(8)} MB`;
const total = routes.reduce((s, [, b]) => s + b, 0);
console.log(`${routes.length} routes, ${(total / 1e9).toFixed(2)} GB summed\n\nLargest routes:`);
for (const [r, b] of routes.sort((a, z) => z[1] - a[1]).slice(0, top)) console.log(`${mb(b)}  ${r}`);
console.log('\nLargest packages (summed across routes):');
for (const [p, b] of [...packages].sort((a, z) => z[1] - a[1]).slice(0, top)) console.log(`${mb(b)}  ${p}`);
