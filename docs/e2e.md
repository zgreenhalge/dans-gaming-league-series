# End-to-end tests (Playwright)

`e2e/` holds Playwright coverage for DGLS's highest-risk multi-stage flows — sequences that span
more than one request/response and can't be locked down by a `queries-*.test.ts`-style unit test
alone. This is a small, deliberately separate suite from the Vitest unit/component tests in
`src/**/*.test.ts` — see `docs/patterns.md` for when a change belongs in one vs. the other.

## Database isolation: a local Supabase stack, never production

`supabase/` is this repo's first tracked local-dev Supabase setup — `config.toml` plus
`migrations/20260101000000_init_schema.sql` (the full production schema, reconstructed via
`pg_catalog` introspection since no migration files existed before this) and `seed.sql` (baseline
`players`/`maps` rows). Running `supabase start` (Docker required) brings up a throwaway
Postgres + PostgREST + Realtime stack — no GoTrue/Storage, since this app's own auth is `next-auth`
and it doesn't use Supabase Storage — with that schema and seed data applied automatically.

E2E specs point at **this local stack**, never at the real DGLS Supabase project. There's only one
Supabase project for this app, and it's production — the same one `frontend`'s CI job points
`next build` at for prerendering. Running disposable-season inserts/deletes against it, even
carefully scoped ones, would still be live writes against real league data. A local stack instead
gives every run a byte-identical, fully isolated schema that's wiped and rebuilt from scratch each
time.

The migration was verified against production before being trusted: applying it to a fresh local
Postgres reproduces the exact same table/column/constraint/index counts as the live project
(25 tables, 252 columns, 91 constraints, 53 indexes), and the `enforce_season_players_upcoming()`
trigger was exercised directly (blocks a roster edit on a non-`UPCOMING` season, allows one on an
`UPCOMING` season) to confirm behavior, not just structure, matches.

**Player ids 1 and 7 in `seed.sql` are load-bearing** — `authOptions.js`'s dev-mode mock providers
(`dev-zach-mock`/`dev-dan-mock`) hardcode `devPlayerId: 1`/`7`, so the topbar's dev-login dropdown
only resolves to a real player when those exact ids exist. Don't reorder or renumber the seeded
players without updating that hardcoding too.

**Keeping the migration current**: this repo still applies day-to-day schema changes straight to the
live project (`apply_migration`, per `AGENTS.md`'s live-approval rule) rather than through local
migration files. When a change lands that way, port it into a new file under `supabase/migrations/`
(or regenerate the baseline) so this local schema doesn't drift from production — a stale local
schema would make E2E runs silently stop testing what the app actually does.

## Running locally

```
supabase start   # once per session — brings up the local stack, applies migrations + seed.sql
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIxNDU5MTY4MDB9.SD8OGMUA7SztCSQyoNK_up2hNla9czXlhL7RvNeh1kw
export SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MjE0NTkxNjgwMH0.Q_XOunt2yFrXAkYRNeh5JgAO_M_zLBEh7OwNnfEJjXU
npm run test:e2e
```

`playwright.config.ts`'s `webServer` starts `next dev` itself (port `3100` by default, override with
`PLAYWRIGHT_PORT`) and waits for it to come up — no separate `npm run dev` needed. It inherits
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` from the shell
environment. The anon/service_role values above are **fixed, local-dev-only demo JWTs** derived from
`supabase/config.toml`'s pinned `auth.jwt_secret` (role `anon`/`service_role`, `iss: supabase-demo`)
— not real secrets, and not something you look up from `supabase status`: recent Supabase CLI
releases stopped reliably printing them from `status`/`start` output (a known upstream regression,
[supabase/cli#4211](https://github.com/supabase/cli/issues/4211)), and since they're fully
determined by the pinned secret there's nothing to look up anyway — they'll be identical every time
you `supabase start` this repo. Run `supabase stop` when done.

## Auth: dev-mode mock providers, not real Steam OAuth

`e2e/support/auth.ts`'s `loginAs()` drives the topbar's "dev" dropdown (`TopbarShell.tsx`'s
`DevToggle`, which calls `next-auth`'s `signIn('dev-zach-mock' | 'dev-dan-mock')`) rather than a real
Steam OpenID round-trip — there's no way to script Steam's login page, and there shouldn't need to
be. Those providers only register when `NODE_ENV === "development"` (`authOptions.js`), which is
**why the config runs `next dev`, not `next build && next start`** — the mock providers don't exist
in a production build.

## Fixture data: self-seeding and self-cleaning, on top of the local baseline

Beyond `seed.sql`'s baseline players/maps, each spec seeds exactly what it needs
(`e2e/support/db.ts`, using the service-role key — the same access `getAdminClient()` has, just
invoked from test code instead of the app) in a `test.beforeEach`, and tears it down in a
`test.afterEach` regardless of pass/fail. A schedule-flow test creates one disposable
`E2E <timestamp> Regular Season` plus a 7-row `season_players` roster, and deletes every row it
touched (`matches`/`weeks` if the test got as far as confirming, the draft tables if it didn't, then
the roster and the season row) when it's done — belt-and-suspenders on top of the fact that the whole
database itself is disposable.

## CI placement

`e2e` is a job in `.github/workflows/ci.yml`, gated on the same `changes.outputs.frontend` path
filter as the `frontend` job — it runs on every PR that touches the app (skipped for
ingestion/docs-only changes), same as any other check, no manual trigger or label needed. A fully
local Docker-based stack made this cheap enough to run on every push: no Supabase branch to
provision per run, no state-pollution risk against a shared project, and the whole job (image pulls,
`supabase start`, Playwright browsers, the suite itself) runs in a couple of minutes. It installs the
Supabase CLI (`supabase/setup-cli`), runs `supabase start`, pulls `NEXT_PUBLIC_SUPABASE_URL` from
`supabase status -o env`'s `API_URL` (the one value that CLI output has reliably carried), sets the
anon/service_role keys from the same fixed JWTs documented above (job-level `env:`, not parsed from
CLI output — see the "Running locally" section for why), verifies none of the three ended up empty
before running anything, runs the suite, then `supabase stop`.

## Adding a new flow

1. Add fixture helpers to `e2e/support/db.ts` (seed + teardown) if the flow needs data beyond what
   `seed.sql` or an existing spec's fixtures already create.
2. Write the spec in `e2e/`, driving everything through the real UI (`page.getByRole(...)`, not
   direct API calls) — the whole point is exercising the same click path a real admin/player takes.
3. Log in via `loginAs()` from `e2e/support/auth.ts` rather than re-deriving the dev-dropdown click
   sequence in every spec.
