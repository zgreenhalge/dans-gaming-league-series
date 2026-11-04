# Vercel deployments & the Function Storage budget

DGLS runs on Vercel's free **Hobby** plan, which includes **10 GB of Function Storage** per team.
Going over it can block new deployments. This doc covers what fills that allowance, the rules that
keep DGLS under it, and what to do when Vercel reports it full.

## What fills Function Storage

Every deployment Vercel keeps stores its own copy of the app's server function bundles: one per
server route (each page, API route and `opengraph-image` route), plus the Python EHOG function, in
each region the project deploys to (`iad1` only). Static assets count separately, as Deployment
Storage. So:

```
Function Storage ≈ retained deployments × Σ bundle size over server routes
```

Both factors matter, and the first moves fastest: one push is one deployment. Vercel's Hobby
retention policy keeps the newest few deployments per project plus protected ones (such as the
current production deployment), and deletes the rest after 30 days — sooner when the team is over
its limit. A deployment stops counting the moment it's deleted.

## Rule 1: previews exist only while their pull request is open

| Event | What happens | Where |
|---|---|---|
| Push to `main` | Production build | Vercel Git integration |
| Push to a branch with an open PR | Preview build | Vercel Git integration |
| Push to a branch with no open PR | Build skipped (shows as Canceled) | `scripts/vercel-ignore-build.mts`, the `ignoreCommand` in `vercel.json` |
| PR opened / reopened | Preview built for the head commit, unless one exists | `vercel-previews.yml` → `vercel-previews.mts deploy` |
| PR closed (merged or not) | Every preview of the branch deleted | `vercel-previews.yml` → `vercel-previews.mts cleanup` |
| Daily | Everything `planPrune()` returns is deleted | `vercel-previews.yml` → `vercel-previews.mts prune` |

The decisions are pure functions in `src/lib/vercel-previews.ts`, tested in `vercel-previews.test.ts`:

- **`shouldBuild()`** builds production always, and a preview only when Vercel ties the push to a PR
  (`VERCEL_GIT_PULL_REQUEST_ID`) or GitHub's API reports an open PR for the branch. A failed lookup
  builds, and so does a crash in the script (exit 1 means "build" to Vercel), so the failure mode is
  extra storage — which the daily prune reclaims — never a missing preview.
- **`planPrune()`** keeps the deployment the production domain points at, the newest two READY
  production deployments (Hobby can only roll back one step), each open PR's newest READY preview,
  and any build still in progress. Everything else is deleted: previews of merged, closed or
  never-PR'd branches, superseded previews, older production deployments, failed and canceled builds.

Deleted deployments stay restorable from the Vercel dashboard for its recovery period.

Agent branches (`claude/*`, `ccr-*`) push often and usually before a PR exists. Those pushes don't
deploy; the preview appears when the PR opens and updates with every later push.

Both scripts run on plain `node` (built-in TypeScript type stripping, no `npm install`), which is why
`tsconfig.json` allows `.ts` import specifiers.

### The `VERCEL_TOKEN` secret

`vercel-previews.yml` calls the Vercel REST API with the `VERCEL_TOKEN` repo secret, a Vercel access
token (Vercel dashboard → Account Settings → Tokens) scoped to the `dans-gaming-league-series` team.
Without it the workflow logs a notice and does nothing. The Ignored Build Step doesn't need it; it
reads GitHub's public API.

## Rule 2: keep every server route's bundle small

The tracer copies every file a route *might* load into that route's bundle, once per route that
imports it. A 30 MB native binary reachable from 14 routes costs 420 MB per deployment.
`outputFileTracingExcludes` in `next.config.ts` drops what's traced but never loaded:

| Excluded | Why it's safe |
|---|---|
| `sharp`, `@img/*` | `next/og` only *tries* `import("sharp")` and falls back to resvg-wasm; Vercel's image optimization doesn't run sharp in our functions |
| `*-linux-x64-musl` packages | `npm ci` installs both glibc and musl builds of native packages such as demoparser2; Vercel functions run on glibc |
| `public/` icon folders | `loadMapImageAsDataUri()` (`src/lib/seo/og-card.tsx`) reads `public/<path>` with a computed path, so the tracer pulls in all of `public/`; only `public/maps/` is read. A new top-level `public/` folder belongs in this list too |

The Python function (`api/ehog/recompute.py`) bundles `ehog/**` via `includeFiles` and drops the rest
of the repo via `excludeFiles` in `vercel.json`.

### Before adding a dependency or a server import

- **Native binaries and large packages** (`sharp`, `canvas`, `@napi-rs/*`, a Chromium, demo parsers)
  stay out of request routes. Heavy work belongs in a GitHub Action — see
  [`github-actions.md`](./github-actions.md)'s "When to use an Action vs a Vercel function". If a
  route must load one, import it only from that route and measure.
- **The queries barrel spreads weight.** `src/lib/queries/index.ts` re-exports every domain module,
  so anything one query module imports is traced into every route that imports `@/lib/queries`. The
  S3 client (`@aws-sdk/client-s3`, via `src/lib/r2.ts`) reaches nearly every route this way, at about
  1 MB each. A helper that needs a heavy import belongs in its own module, imported directly by the
  routes that use it.
- **`readFile` with a computed path** makes the tracer include the whole directory it could resolve
  to. Prefer a fixed path, or exclude what can't be reached.

### Measuring

```bash
npm run build
node scripts/function-bundle-size.mts      # largest routes and packages; pass a number for a longer list
```

`scripts/function-bundle-size.mts` sums each route's trace (`.next/server/**/*.nft.json`). The total
is the uncompressed size one deployment adds; compare it before and after adding a dependency, an
`opengraph-image`, or an import in `src/lib/queries/`. A deployment's **Resources → Functions** tab
in Vercel shows the deployed sizes.

## When Vercel reports Function Storage full

1. **Find the driver.** Vercel dashboard → team → **Usage** → **Deployment Storage** →
   **Functions Storage** → **Projects**, then count the project's retained deployments.
2. **Delete what isn't needed.** Run the `vercel-previews` workflow by hand with `dry_run` on, read
   the list, then run it with `dry_run` off. Without `VERCEL_TOKEN`, delete the same deployments from
   the dashboard (Deployments → select → Delete): everything except the current production
   deployment, the one before it, and the newest preview of each open PR.
3. **If few deployments are retained, measure bundle size** — a recent dependency or import is the
   likely cause.
