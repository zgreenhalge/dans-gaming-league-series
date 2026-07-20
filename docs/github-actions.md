# Background-job GitHub Actions: when & how

DGLS runs heavy, long, or memory-hungry work as **GitHub Actions jobs** triggered by the app, not as
Vercel functions. This doc is the general pattern and the decision rule. The replay pipeline
([`replay.md`](./replay.md)) is the canonical worked example — read this for the *why* and the
*shape*, then copy `scripts/replay-extract.ts` + `.github/workflows/replay-extract.yml` for a new job.

## When to use an Action vs a Vercel function

| Use a **Vercel function** (`src/app/api/**`) | Use a **GitHub Action job** (`scripts/*.ts` + workflow) |
|---|---|
| Request-scoped, finishes in seconds | Long-running (tens of seconds to minutes) |
| Output fits in memory comfortably | Needs hundreds of MB → GBs of RAM |
| Receives ≤ 4.5 MB request bodies | Processes large artifacts (multi-hundred-MB demos) |
| Pure JS / network / DB work | Native node addons (e.g. `@laihoe/demoparser2`) or CPU-heavy parsing |
| Mutations, auth, presigning, light reads | Full-tick demo parsing, replay/heatmap build, batch backfills |

**The litmus test:** if the work reads a whole demo from R2 and parses it, it belongs in an Action.
A Vercel function caps out on memory and the 300 s `maxDuration`, and **cannot** run native addons or
stream-process a large file safely. A Cloudflare Worker is *also* wrong for parsing — Workers can't
run native node addons; they're only for *receiving* bytes (see `infra/worker/`). Parsing lives in
Actions.

> This is exactly why demo **score** parsing moves into an Action in the demo-ingestion Phase 3 (see
> `dathost_handoff/DATHOST_PHASE0_PLAN.md`): the in-request parse route has a self-imposed
> `MAX_DEMO_BYTES` guard because a Vercel function can OOM on a large/overtime demo. The Action has
> no such ceiling.

## Anatomy of a job (three actors)

1. **Trigger — a route in the app.** Either a session-gated dispatch route (browser action, e.g.
   `POST /api/matches/[id]/replay/dispatch`) or a machine-auth notify route (Worker/automation, e.g.
   `POST /api/ingest/notify`). The route only **triggers** the job and records intent; it does **no**
   heavy work. It:
   - authorizes (session admin/in-match, or a constant-time shared secret),
   - **guards against duplicates** — no-op if a `background_jobs` row for this `(job_type, key)`
     is already `queued`/`running`. This guard is the one part that's genuinely per-route (an in-flight
     `SELECT`, an atomic first-landing upsert, an auth check) and stays hand-written at the call site.
   - claims the row (`recordJobStatus` in `src/lib/background-jobs.ts`) to `queued`, then dispatches
     the workflow via `dispatchAndRecordFailure`, which rolls the row — and a subject column
     (`matches.replay_status`, etc.), when given one — back to `failed` if the dispatch call itself
     fails, so a transient error never wedges the match in `queued` (which the guard would otherwise
     treat as in-flight forever). This claim→dispatch→record shape is identical across every dispatch
     route, so it lives once in `src/lib/background-jobs.ts` rather than hand-rolled per route. Each
     helper takes a `JobKey` — built with the `matchJobKey(id)` / `mapJobKey(id)` factories — so the
     same helpers cover both the match-keyed routes (replay, demo, ingest) and the map-keyed radar
     route.
   - **Pick the write order by whether a failed dispatch needs a rollback.** If the row is claimed to
     `queued` *before* dispatching (both replay routes), a failed dispatch leaves a stale `queued` row
     behind unless something unwinds it — use `dispatchAndRecordFailure` for that. If nothing is
     written until the dispatch itself succeeds (`demo/dispatch`, which returns an error straight to
     the caller on a failed dispatch and never wrote a row to unwind), there's no rollback to do — call
     `dispatchWorkflow` directly and `recordJobStatus` only in the success branch. A third shape covers
     a claimed row where failure needs neither a rollback nor to reach the caller: `ingest/notify`'s
     `demo_ingest` path claims `received` before dispatching, and on a failed dispatch just logs and
     leaves the row at `received` — the demo is already durably staged in R2, so a stale `received` row
     is a correct "not parsed yet" state, not a wedge, and the manual `demo/dispatch` route is the
     retry path. On success it calls `advanceJobStatus` (not `recordJobStatus`) to move `received` →
     `queued` only if the row is still `received`, so a concurrent Action run that already advanced it
     isn't clobbered back.

2. **Workflow — `.github/workflows/<job>.yml`.** `workflow_dispatch` (and optionally
   `repository_dispatch`) inputs; `concurrency` backstop with **`cancel-in-progress: false`** (a
   cancelled run never reaches the script's `fail()` handler, so it would orphan the status at
   `running`); pinned action SHAs; `node-version: 22` (Supabase Realtime needs native WebSocket);
   `npm ci`; secrets passed as `env`; one line: `npx tsx scripts/<job>.ts`.

3. **Job script — `scripts/<job>.ts`, run via `tsx`.** Reuses the **same `src/lib/*` code as the
   app** (no logic drift — e.g. `getReplayInputs`, the demo parsers, the R2 helpers, and
   `recordJobStatus` from `src/lib/background-jobs.ts` for its own `markRunning`/`setJob`-style upsert).
   Drives the `background_jobs` state machine and prints GitHub log annotations. See the template below.

## Conventions every job follows

- **State machine in `background_jobs`** — one row per `(job_type, key)`, `key` being `match_id` for
  match-keyed jobs or `map_id` for map-keyed ones (unique; `onConflict: 'job_type,<key column>'`).
  Lifecycle: `queued` (route) → `running` (`markRunning`) → `succeeded` | `failed`. Columns: `status,
  stage, error_message, gh_run_id, gh_run_url, requested_by, created_at, started_at, finished_at,
  updated_at`. Pick a distinct `job_type` string (`'replay_extract'`, `'demo_ingest'`, `'radar_build'`, …).
- **Mirror a coarse status onto the domain row** when the UI needs it cheaply (replay mirrors to
  `matches.replay_status`). Read it back defensively (`getReplayJobState` returns `'none'` if the
  table/column isn't there yet — these are added in the Supabase dashboard, not via migrations).
- **Observability — the `stage()` wrapper.** Each named stage is reported twice: a collapsible
  GitHub log group + `::notice::`/`::warning::`/`::error::` annotations, **and** `background_jobs.stage`
  so the app shows progress without opening Actions. Declare an ordered `STAGES` list.
- **Idempotency via deterministic R2 keys.** Outputs go to fixed keys (`demoKey`, `replayKey`,
  `heatmapKey` in `src/lib/r2.ts`) so a re-dispatch overwrites cleanly (last-write-wins). Re-running a
  job must be safe.
- **Fail loudly to the DB.** A top-level `.catch(fail)` writes `status: 'failed'` + `error_message` +
  `finished_at` and `process.exit(1)`, so failures surface in the app, not just the Actions log.
- **Secrets** are GitHub Actions repo secrets, passed through the workflow `env`. The standard set:
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the four `CLOUDFLARE_R2_*` vars. The
  app side needs `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, and optionally `GITHUB_DISPATCH_REF`.

## Security & hardening (GitHub-recommended)

These are GitHub's official hardening practices ([security-hardening for GitHub Actions][sh],
[automatic token authentication][att]); the replay workflow already follows them — match it.

- **Pin third-party actions to a full commit SHA**, not a tag. A SHA is the only immutable reference;
  a moved tag can ship a backdoor. `replay-extract.yml` pins e.g.
  `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`. Keep the `# vX.Y.Z` comment.
- **Least-privilege `permissions`.** Set `permissions: { contents: read }` at the workflow top — our
  jobs only check out code and talk to Supabase/R2 over their own secrets, so the `GITHUB_TOKEN`
  needs nothing more. Never rely on the default token scope. Raise a scope only on the specific job
  that needs it.
- **Individual secrets, never structured blobs.** Store each value as its own repo secret
  (`SUPABASE_SERVICE_ROLE_KEY`, each `CLOUDFLARE_R2_*`). A JSON/YAML secret blob defeats log
  redaction. If you derive a value from a secret (encode/sign), `::add-mask::` the derived value too.
- **Prevent script injection.** Pass untrusted inputs (`github.event.inputs.*`,
  `client_payload.*`) through the workflow **`env:` map**, never interpolate `${{ … }}` directly into
  a `run:` line. `replay-extract.yml` does this — `MATCH_ID: ${{ github.event.inputs.match_id }}` in
  `env`, then the script reads `process.env.MATCH_ID`.
- **`timeout-minutes` on every job** (replay uses 20) so a hung parse can't burn the minute budget.
- **Cloud auth — OIDC where the provider supports it.** GitHub recommends OIDC over long-lived cloud
  credentials. AWS/GCP/Azure support it; **Cloudflare R2 uses S3 access keys**, so the `CLOUDFLARE_R2_*`
  long-lived secrets are the practical reality here — scope those keys to the one bucket and rotate
  them. Use OIDC if we ever add a provider that supports it.
- **App→GitHub dispatch token.** The dispatch route authenticates to the GitHub REST API with a PAT
  (`GITHUB_DISPATCH_TOKEN`) scoped to Actions: write on this repo only. `workflow_dispatch` needs
  Actions: write; `repository_dispatch` needs Contents: write — prefer `workflow_dispatch`.

[sh]: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
[att]: https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication

## Adding a new job (checklist)

1. **`scripts/<job>.ts`** — copy `scripts/replay-extract.ts`. Set `JOB_TYPE`, define `STAGES`, reuse
   `getReplayInputs` / `src/lib/*` for inputs and logic, write outputs to a deterministic R2 key,
   keep `markRunning` / `stage` / `fail` / `done` intact.
2. **`.github/workflows/<job>.yml`** — copy `replay-extract.yml`. Rename, set the `concurrency.group`,
   keep `cancel-in-progress: false`, pass the same secrets, end with `npx tsx scripts/<job>.ts`.
3. **Trigger** — a session-gated dispatch route (mirror `replay/dispatch`) or a machine-auth notify
   route (mirror `ingest/notify`). Keep the route's own duplicate-guard, and claim/dispatch/rollback
   through `src/lib/background-jobs.ts` (`recordJobStatus`, `advanceJobStatus`,
   `dispatchAndRecordFailure`) rather than re-upserting `background_jobs` by hand.
4. **Status surface** — read via a new additive getter mirroring `getReplayJobState`; add a domain
   mirror column only if a hot page needs it.
5. **Local dry-run** — `set -a; . ./.env.local; set +a` then `MATCH_ID=<id> npx tsx scripts/<job>.ts`.
   (Tip: `scripts/dump-roster.ts` and `scripts/inspect-demo.ts` are read-only harnesses that run
   the same shared lib locally.)
6. **Docs** — note job-specific details in the owning doc (e.g. `replay.md`, `demo-ingestion.md`); the
   *generic* pattern stays here.

See also: [`replay.md`](./replay.md) (worked example + DB schema for `background_jobs`),
[`patterns.md`](./patterns.md) (cross-cutting conventions), [`demo-ingestion.md`](./demo-ingestion.md)
(the demo pipeline that Phase 3 moves into an Action).
