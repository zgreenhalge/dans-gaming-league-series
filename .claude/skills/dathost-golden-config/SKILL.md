---
name: dathost-golden-config
description: >-
  Check whether the live DGLS DatHost match server matches the versioned golden
  config in infra/matchzy/, and resolve any drift. Use when the user asks to
  "check the golden config", "diff the server config", "update the golden
  config", or similar for the DGLS match server.
---

# DatHost Golden Config: Diff & Update

The DGLS match server is reused across matches and gets reconfigured in the
DatHost panel for recreational modes between matches (see
`infra/matchzy/README.md`). The versioned files in `infra/matchzy/` are meant
to be the source of truth for match provisioning, but they can drift from
whatever is actually live. This skill checks for drift and — only with the
user's explicit direction — resolves it.

## Step 1 — Diff

```bash
set -a; . ./.env.local; set +a
tsx scripts/dathost-golden-diff.ts   # uses DATHOST_SERVER_ID, or pass an id explicitly
```

This is **read-only**. It compares:
- `cs2_settings` + top-level `server` fields in `infra/matchzy/golden-server-settings.json`
  against a live `GET /game-servers/{id}`.
- Each `infra/matchzy/cfg/**/*.cfg` file against its live counterpart via
  `GET /game-servers/{id}/files/{path}` (path rooted at the DatHost
  file-manager root, e.g. `cfg/server.cfg` — confirmed live). CRLF/LF is
  normalized before comparing so DatHost's in-panel editor re-saving a file
  with different line endings doesn't show up as noise. If a specific file
  still can't be fetched, the script lists what DatHost actually has under
  `cfg/` so you can point it at the right path or paste content in by hand,
  rather than guessing at a result.

Report the output to the user in plain terms: what matches, what's drifted,
and any files it couldn't check.

If nothing drifted, stop here — say so and don't touch anything.

## Step 2 — If drift is found, ask which direction to resolve it

**Never pick a direction yourself.** Drift is ambiguous — it could mean
someone intentionally tuned the panel (capture their change into the repo) or
the server drifted into recreational-mode settings that need correcting
(reassert the repo's config). Use `AskUserQuestion` (or plain confirmation if
mid-conversation context already makes it obvious) with these options:

1. **Capture** (live → repo): the live server's settings/cfgs become the new
   golden baseline, overwriting `infra/matchzy/*`. Choose this when the
   drift was an intentional retune.
2. **Reassert** (repo → live): push the versioned golden config to the live
   server, overwriting whatever drifted. Choose this when the drift is
   unwanted (recreational-mode leftovers, accidental panel change).
3. **Do nothing** — just report the drift and stop.

Never assume; if the user's request doesn't already imply one of these, ask.

## Step 3 — Apply (only after the user picks capture or reassert)

```bash
set -a; . ./.env.local; set +a

# capture: live → repo
tsx scripts/dathost-golden-apply.ts --capture <serverId> --yes

# reassert: repo → live
tsx scripts/dathost-golden-apply.ts --reassert <serverId> --yes
```

Both mutate real state — repo files on disk for capture, the live shared
match server for reassert — and both require `--yes`. Treat `--reassert`
especially carefully: it's a live write to the one shared DGLS match server;
confirm the user actually wants it applied now (not scheduled around a match)
before running it, per this repo's general rule on hard-to-reverse /
shared-state actions.

Notes on what the apply script does and doesn't do:
- Array-valued fields (e.g. `cs2_settings.metamod_plugins`) are **never**
  auto-reasserted — DatHost preserves them across changes, and guessing the
  form-encoding for an array isn't worth the risk (matches the existing
  reasoning in `src/lib/dathost.ts`'s `buildGoldenCs2Fields()`). If those
  need to change, that's a manual panel edit.
- `per_match_overrides` in `golden-server-settings.json` is never touched —
  map selection (`maps_source` / `workshop_single_map_id`) is set per match
  at provision time, not part of the static baseline. `workshop_collection`
  mode doesn't behave reliably on this server (confirmed live) — the app
  code (`applyGoldenSettings`) always pins a single workshop map and throws
  if none is resolved yet, rather than falling back to it.
- Capture rewrites `golden-server-settings.json`'s `note` field with today's
  capture date and cfg files it could fetch; anything the files endpoint
  couldn't reach is left alone and flagged.

## Step 4 — After capture

If the user chose **capture**, remind them to review `git diff
infra/matchzy/` and commit if the changes look right — this skill doesn't
commit on its own (see this repo's git policy: only commit when asked).

## Key files

`scripts/dathost-golden-diff.ts` · `scripts/dathost-golden-apply.ts` ·
`scripts/dathost-golden-shared.ts` (auth/fetch helpers + the tracked cfg-file
list, shared by both scripts) · `infra/matchzy/golden-server-settings.json` ·
`infra/matchzy/cfg/` · `infra/matchzy/README.md` · `src/lib/dathost.ts`
(`buildGoldenCs2Fields`, `applyGoldenSettings`) · `docs/hosting.md`.
