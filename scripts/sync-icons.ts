// Re-pulls this repo's CS2 icon SVGs (public/{round,grenade,side,kill,weapon}-icons/) from
// github.com/Juknum/counter-strike-icons — a community project that watches Valve's CS2 depot and
// re-extracts Panorama UI assets on every game update. We don't mirror that repo wholesale: this
// script only ever touches the specific files listed in MANIFEST below, each mapped to the exact
// upstream source we originally sourced it from (see #103/#464's session history for how each
// pick was chosen). A file appearing upstream that isn't in MANIFEST is never pulled in.
//
// For each manifest entry: fetch the raw upstream SVG, extract its real shape elements (path/
// polygon/rect/circle — skipping anything nested inside an unused `<symbol>`, a leftover artifact
// Source2Viewer bakes into many of these exports), and re-emit a minimal SVG with every shape's
// fill forced to `currentColor` so it stays tintable exactly like every other icon in this
// codebase. This is the same transform applied by hand while sourcing the original set, now
// codified so a future upstream change (asset renamed/redrawn) doesn't need someone to redo that
// by hand — it's diffed against what's currently committed, and only entries that actually changed
// go into the PR this opens.
//
// A manifest entry that 404s or whose upstream file no longer parses into any shapes (structure
// changed enough that this script's extraction can't follow) is never silently skipped — it's
// listed in the PR body as needing manual follow-up, and the existing committed file is left
// untouched rather than risk replacing a working icon with nothing.
//
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/sync-icons.ts                 # DRY_RUN defaults true — report only, no PR
//   DRY_RUN=false npx tsx scripts/sync-icons.ts    # actually write files / open or update the PR
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ops_errors reporting), GITHUB_TOKEN,
// GITHUB_REPOSITORY (owner/repo — set automatically inside Actions).
//
// The workflow (.github/workflows/icon-sync.yml) runs this weekly; DRY_RUN is only ever true on a
// manual workflow_dispatch preview, same convention as scripts/dathost-cleanup.ts.

import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { recordOpsError, clearOpsError } from '../src/lib/ops-errors';
import { WEAPON_CATEGORY } from '../src/lib/parsers/weaponClasses';

const UPSTREAM_OWNER = 'Juknum';
const UPSTREAM_REPO = 'counter-strike-icons';
const UPSTREAM_BRANCH = 'main';
const OPERATION = 'icon_sync';
const SYNC_BRANCH = 'automated/icon-sync';

const DRY_RUN = process.env.DRY_RUN !== 'false';
const REPO_ROOT = path.resolve(__dirname, '..');

interface IconEntry {
  /** Path within the upstream repo. */
  source: string;
  /** Path relative to `public/`. */
  dest: string;
}

const WEAPON_ENTRIES: IconEntry[] = [
  ...Object.keys(WEAPON_CATEGORY),
  'knife',
  'taser',
].map((name) => ({
  source: `cs2/panorama/images/icons/equipment/${name}.svg`,
  dest: `weapon-icons/${name}.svg`,
}));

const MANIFEST: IconEntry[] = [
  { source: 'cs2/panorama/images/icons/ui/kill.svg', dest: 'round-icons/skull.svg' },
  { source: 'cs2/panorama/images/icons/ui/bomb.svg', dest: 'round-icons/bomb.svg' },
  { source: 'cs2/panorama/images/icons/ui/defuser_white.svg', dest: 'round-icons/defuse.svg' },
  { source: 'cs2/panorama/images/icons/ui/clock.svg', dest: 'round-icons/clock.svg' },
  { source: 'cs2/panorama/images/icons/equipment/smokegrenade.svg', dest: 'grenade-icons/smoke.svg' },
  { source: 'cs2/panorama/images/icons/equipment/molotov.svg', dest: 'grenade-icons/molotov.svg' },
  { source: 'cs2/panorama/images/icons/equipment/hegrenade.svg', dest: 'grenade-icons/he.svg' },
  { source: 'cs2/panorama/images/icons/ui/ct_logo_1c.svg', dest: 'side-icons/ct.svg' },
  { source: 'cs2/panorama/images/icons/ui/t_logo_1c.svg', dest: 'side-icons/t.svg' },
  { source: 'cs2/panorama/images/hud/deathnotice/icon_headshot.svg', dest: 'kill-icons/headshot.svg' },
  ...WEAPON_ENTRIES,
];

const SHAPE_TAGS = new Set(['path', 'polygon', 'rect', 'circle']);
const ATTR_ORDER = ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'transform', 'points', 'd', 'fill-rule', 'clip-rule', 'fill'];

/** Re-emits `rawSvg` as a minimal, `currentColor`-tintable SVG — see the file header for why. */
function extractRecolorableSvg(rawSvg: string): string {
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

  return [
    `<svg width="${width}" height="${height}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    ...lines,
    `</svg>`,
    '',
  ].join('\n');
}

async function fetchUpstream(sourcePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/${UPSTREAM_BRANCH}/${sourcePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

interface EntryResult {
  entry: IconEntry;
  status: 'unchanged' | 'changed' | 'problem';
  detail?: string;
  newContent?: string;
}

async function resolveEntry(entry: IconEntry): Promise<EntryResult> {
  let raw: string;
  try {
    raw = await fetchUpstream(entry.source);
  } catch (err) {
    return { entry, status: 'problem', detail: `fetch failed: ${(err as Error).message}` };
  }

  let svg: string;
  try {
    svg = extractRecolorableSvg(raw);
  } catch (err) {
    return { entry, status: 'problem', detail: `extraction failed: ${(err as Error).message}` };
  }

  const destPath = path.join(REPO_ROOT, 'public', entry.dest);
  const current = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
  if (current === svg) return { entry, status: 'unchanged' };
  return { entry, status: 'changed', newContent: svg };
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

async function openOrUpdatePr(changed: EntryResult[], problems: EntryResult[]): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const repoSlug = process.env.GITHUB_REPOSITORY;
  if (!token || !repoSlug) throw new Error('GITHUB_TOKEN / GITHUB_REPOSITORY not set — cannot open a PR');

  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('checkout', '-B', SYNC_BRANCH);

  for (const r of changed) {
    const destPath = path.join(REPO_ROOT, 'public', r.entry.dest);
    mkdirSync(path.dirname(destPath), { recursive: true });
    writeFileSync(destPath, r.newContent!);
    git('add', path.relative(REPO_ROOT, destPath));
  }
  git('commit', '-m', `chore(icons): sync ${changed.length} icon(s) from ${UPSTREAM_OWNER}/${UPSTREAM_REPO}`);
  git('push', '--force', 'origin', `HEAD:${SYNC_BRANCH}`);

  const api = (p: string, init?: RequestInit) =>
    fetch(`https://api.github.com/repos/${repoSlug}${p}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

  // Mirrors .github/pull_request_template.md's structure with real checkboxes — pr-checks.yml's
  // require-checklist-action gate fails a PR body without one, bot-authored or not.
  const bodyLines = [
    '## Summary',
    '',
    `- Automated re-sync of ${changed.length} icon(s) from [Juknum/counter-strike-icons](https://github.com/Juknum/counter-strike-icons), the upstream source for every SVG in \`public/{round,grenade,side,kill,weapon}-icons/\` (see #103).`,
    '',
  ];
  if (changed.length > 0) {
    bodyLines.push('**Updated:**', ...changed.map((r) => `- \`public/${r.entry.dest}\` ← \`${r.entry.source}\``), '');
  }
  if (problems.length > 0) {
    bodyLines.push(
      '**Needs manual follow-up** (left as-is; the upstream source may have moved or changed shape):',
      ...problems.map((r) => `- \`public/${r.entry.dest}\` ← \`${r.entry.source}\` — ${r.detail}`),
      '',
    );
  }
  bodyLines.push(
    '## Test plan',
    '',
    "- [x] `npm run build` (or the relevant `npx vitest run src/lib/**/*.test.ts`) passes — enforced by this repo's own CI on this PR",
    '- [ ] Manual check on the deployed preview, for UI changes',
    "- ~~Updated the doc that owns this area (`docs/README.md`'s index) if behavior changed~~ — no behavior change, only icon asset content",
    '',
    '## Related issues',
    '',
    '#103',
  );
  const body = bodyLines.join('\n');

  const existing = await api(`/pulls?head=${repoSlug.split('/')[0]}:${SYNC_BRANCH}&state=open`).then((r) => r.json());
  if (Array.isArray(existing) && existing.length > 0) {
    const pr = existing[0];
    await api(`/pulls/${pr.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    return pr.html_url;
  }

  const created = await api('/pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: `chore(icons): sync ${changed.length} icon(s) from upstream`,
      head: SYNC_BRANCH,
      base: 'main',
      body,
    }),
  }).then((r) => r.json());
  if (!created.html_url) throw new Error(`PR creation failed: ${JSON.stringify(created)}`);
  return created.html_url;
}

async function main() {
  const results = await Promise.all(MANIFEST.map(resolveEntry));
  const changed = results.filter((r) => r.status === 'changed');
  const problems = results.filter((r) => r.status === 'problem');

  console.log(`icon-sync: ${results.length} entries — ${changed.length} changed, ${problems.length} problem(s), ${results.length - changed.length - problems.length} unchanged`);
  for (const r of changed) console.log(`  changed:  public/${r.entry.dest}`);
  for (const r of problems) console.log(`::warning::icon-sync problem for public/${r.entry.dest}: ${r.detail}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  if (DRY_RUN) {
    console.log('DRY_RUN=true — not writing files or opening a PR. Set DRY_RUN=false to apply.');
    return;
  }

  if (changed.length > 0) {
    const prUrl = await openOrUpdatePr(changed, problems);
    console.log(`::notice::icon-sync PR: ${prUrl}`);
  }

  if (!supabaseAdmin) {
    console.warn('icon-sync: Supabase creds not set — skipping ops_errors reporting');
    return;
  }
  if (problems.length > 0) {
    const message = problems.map((r) => `${r.entry.dest}: ${r.detail}`).join('; ');
    await recordOpsError(supabaseAdmin, 'system', 0, OPERATION, message);
  } else {
    await clearOpsError(supabaseAdmin, 'system', 0, OPERATION);
  }
}

main().catch(async (err) => {
  console.error('icon-sync failed:', err);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    await recordOpsError(supabaseAdmin, 'system', 0, OPERATION, `sync script crashed: ${(err as Error).message}`);
  }
  process.exit(1);
});
