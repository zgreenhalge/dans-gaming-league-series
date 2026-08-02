---
name: dathost-golden-config
description: >-
  Check whether the live DGLS DatHost match server matches a Supabase-backed
  config set (default `golden`), and resolve any drift. Use when the user asks
  to "check the golden config", "diff the server config", "update the golden
  config", or similar for the DGLS match server.
---

# DatHost Config Set: Diff & Update

The DGLS match server is reused across matches and gets reconfigured in the
DatHost panel for recreational modes between matches (see
`infra/matchzy/README.md`). Config sets — `golden` (the production baseline)
and any others — live in Supabase (`config_sets`/`config_set_files`, see
`src/lib/dathost-config.ts`) and are meant to be the source of truth for match
provisioning, but they can drift from whatever is actually live. This skill
checks for drift and — only with the user's explicit direction — resolves it.
`infra/matchzy/` is a one-time seed source / disaster-recovery snapshot, not
read live.

## Step 1 — Diff

```bash
set -a; . ./.env.local; set +a
tsx scripts/dathost-golden-diff.ts   # uses DATHOST_SERVER_ID and the "golden" set, or pass [serverId] [configSetKey]
```

This is **read-only**. It compares:
- The config set's `cs2_settings` + top-level `server` fields against a live
  `GET /game-servers/{id}`.
- Each of the config set's cfg files against its live counterpart via
  `GET /game-servers/{id}/files/{path}` (path rooted at the DatHost
  file-manager root, e.g. `cfg/server.cfg`). CRLF/LF is normalized before
  comparing so DatHost's in-panel editor re-saving a file with different line
  endings doesn't show up as noise. If a specific file still can't be
  fetched, the script lists what DatHost actually has under `cfg/` so you can
  point it at the right path (edit `config_set_files`) or paste content in by
  hand, rather than guessing at a result.

Report the output to the user in plain terms: what matches, what's drifted,
and any files it couldn't check.

If nothing drifted, stop here — say so and don't touch anything.

## Step 2 — If drift is found, ask which direction to resolve it

**Never pick a direction yourself.** Drift is ambiguous — it could mean
someone intentionally tuned the panel (capture their change into the config
set) or the server drifted into recreational-mode settings that need
correcting (reassert the config set). Use `AskUserQuestion` (or plain
confirmation if mid-conversation context already makes it obvious) with these
options:

1. **Capture** (live → config set): the live server's settings/cfgs become
   the new baseline, overwriting the `config_sets`/`config_set_files` rows.
   Choose this when the drift was an intentional retune.
2. **Reassert** (config set → live): push the stored config set to the live
   server, overwriting whatever drifted. Choose this when the drift is
   unwanted (recreational-mode leftovers, accidental panel change).
3. **Do nothing** — just report the drift and stop.

Never assume; if the user's request doesn't already imply one of these, ask.

## Step 3 — Apply (only after the user picks capture or reassert)

```bash
set -a; . ./.env.local; set +a

# capture: live → config set
tsx scripts/dathost-golden-apply.ts --capture <serverId> --yes [--key golden]

# reassert: config set → live
tsx scripts/dathost-golden-apply.ts --reassert <serverId> --yes [--key golden]
```

Both mutate real state — the `config_sets`/`config_set_files` tables for
capture, the live shared match server for reassert — and both require
`--yes`. Treat `--reassert` especially carefully: it's a live write to the
one shared DGLS match server; confirm the user actually wants it applied now
(not scheduled around a match) before running it, per this repo's general
rule on hard-to-reverse / shared-state actions. Capture is also a live
Supabase mutation — per this repo's rule on Supabase changes, show the user
what will change before running it.

Notes on what the apply script does and doesn't do:
- Array-valued fields (e.g. `cs2_settings.metamod_plugins`) are **never**
  auto-reasserted — DatHost preserves them across changes, and guessing the
  form-encoding for an array isn't worth the risk (matches the existing
  reasoning in `src/lib/dathost.ts`'s `buildScalarFields()`). If those need
  to change, that's a manual panel edit.
- Map selection (`maps_source` / `workshop_single_map_id`) is never touched —
  it's set per match at launch time, not part of a config set's static
  baseline. `workshop_collection` mode doesn't behave reliably on this server
  (confirmed live) — the app code (`applyConfigSet`) always pins a single
  workshop map and throws if none is resolved yet, rather than falling back
  to it.
- Capture only overwrites values for keys/files the config set already
  tracks — it doesn't add new tracked keys or files. Adding a new config set
  (or a new tracked file on an existing one) is `scripts/seed-config-set.ts`.

## Key files

`scripts/dathost-golden-diff.ts` · `scripts/dathost-golden-apply.ts` ·
`scripts/dathost-golden-shared.ts` (auth/fetch helpers, shared by both
scripts) · `scripts/seed-config-set.ts` (seed/add a config set from local
files) · `src/lib/dathost-config.ts` (`resolveConfigSet`, `diffConfigSet`,
`pushCfgFiles`) · `src/lib/dathost.ts` (`buildScalarFields`, `applyConfigSet`)
· `infra/matchzy/` (seed source / DR snapshot) · `docs/hosting.md`.
