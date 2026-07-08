# infra/matchzy — versioned golden DatHost + MatchZy config

The canonical, version-controlled config for the DGLS match server. The server is **reused** for
matches (start on veto-complete → stop on score/demo, see decision D2) and is **also reconfigured in
the DatHost panel for recreational modes between matches**. So provisioning must re-assert this golden
config every time, before launch — the panel is not a reliable source of truth.

> **No secrets here.** rcon/server passwords, FTP/MySQL creds, and any GSLT live only in DatHost /
> env, never in this dir.

## Layout

| Path | What | Source of truth |
|---|---|---|
| `golden-server-settings.json` | DatHost `cs2_settings` (game mode, GOTV, plugins, bots). PUT to `/game-servers/{id}` before start. Map selection is **not** in here — see below. | captured from the live API |
| `cfg/` | In-game `.cfg` files (MatchZy cvars, server.cfg). Auto-pushed to the server before every boot by `pushCfgFiles` (provisioning + `dathost-golden-apply.ts --reassert`), so the repo is the source of truth — a panel-only edit is overwritten on the next provision. | `infra/matchzy/cfg/` (this repo) |

`game_mode` is currently `competitive` — a **"competitive-style wingman" hybrid** for this season
(for consistency with xplay), with the wingman-specific rules (round count, warmup, overtime,
economy) layered on top via `cfg/gamemode_competitive2v2_server.cfg` and
`cfg/MatchZy/live_override.cfg`, not via the `wingman` game mode preset.

**Map selection is always per-match, never a static collection.** `workshop_collection` mode does
not behave reliably on this server (confirmed live) — every provision pins a single workshop map
(`cs2_settings.maps_source=workshop_single_map` + `workshop_single_map_id`) via
`applyGoldenSettings()` in `src/lib/dathost.ts`, which **throws** if a match's map hasn't been
resolved yet rather than falling back to the collection.

## Checking / updating this config

`scripts/dathost-golden-diff.ts` diffs the live server against this directory (settings
cvar-by-cvar, cfg files cvar-by-cvar) — read-only. `scripts/dathost-golden-apply.ts --capture` or
`--reassert` resolves drift in either direction (both require `--yes`); shared plumbing lives in
`scripts/dathost-golden-shared.ts`. The `dathost-golden-config` Claude Code skill
(`.claude/skills/dathost-golden-config/`) wraps this diff → ask → apply flow. See usage in each
script's header comment.

## What goes in `cfg/` (capture via `dathost-golden-diff.ts`/`dathost-golden-apply.ts`, or DatHost
File Manager / FTP as a fallback)

- `cfg/MatchZy/config.cfg` — main MatchZy server config (ready threshold, demo recording, knife,
  overtime, etc.). **Most important.**
- `cfg/MatchZy/live_override.cfg` — cvars applied when a match goes live (round/eco/overtime
  economy, comms); overlaps with `gamemode_competitive2v2_server.cfg`.
- `cfg/MatchZy/live_wingman_override.cfg` — **this is the file MatchZy actually execs at go-live**,
  not `live_override.cfg` directly: DGLS's engine `game_mode` evaluates to Wingman (2) at match-live,
  so MatchZy's `ExecLiveCFG()` takes the wingman branch (`live_wingman.cfg` →
  `exec MatchZy/live_wingman_override.cfg`) rather than the standard one. It just `exec`s
  `live_override.cfg` so both mode paths share one baseline — if it's empty, **none of
  `live_override.cfg`'s cvars reach a real match.**
- other customized `cfg/MatchZy/*.cfg` **not yet captured here** — `live.cfg`, `warmup.cfg`,
  `knife.cfg` — add them the same way if they turn out to matter.
- `cfg/server.cfg` / `cfg/autoexec.cfg` — base server cvars, if present.
- `cfg/gamemode_competitive2v2_server.cfg` — the 2v2 hybrid-mode overrides mentioned above.

Once captured, match-critical cvars (e.g. `matchzy_demo_recording_enabled`, ready threshold,
`matchzy_demo_upload_url`) are best **folded into the per-match loadmatch `cvars`** so the match config
is self-contained and independent of whatever cfg files happen to be on the server. The rest stays
here as the versioned baseline / disaster-recovery copy.

## Provision sequence

1. **`PUT /game-servers/{id}`** — re-assert `golden-server-settings.json` + the per-match map
   (`cs2_settings.maps_source=workshop_single_map`, `cs2_settings.workshop_single_map_id=<picked
   map>` — always required, see above).
2. (optional) **push `cfg/` files** via `POST /game-servers/{id}/files/{path}`.
3. **`POST /game-servers/{id}/start`** → boot (~20s).
4. **`matchzy_loadmatch[_url]`** via `POST /game-servers/{id}/console` — per-match teams / matchid /
   map_sides / cvars (from `scripts/gen-matchzy-config.ts`).
5. (teardown) **`POST /game-servers/{id}/stop`** on confirmed score/demo. Never `delete` (reuse model).

**Disk cleanup (issue #132):** MatchZy never removes its own per-match artifacts (round-resume
backups, stat CSVs, player-name caches, recorded demos) — they accumulate on the server's disk
against a fixed size cap every match. `scripts/dathost-cleanup.ts` + `.github/workflows/
dathost-cleanup.yml` remove a match's files once they're old enough that nothing needs them
locally (7-day default retention), and — for the demo specifically — only once R2 has its own
confirmed copy — except for residue with no `matches` row at all (a non-DGLS game reusing MatchZy
on the shared server), which is deleted immediately since none of it is ever worth keeping. The
underlying job always checks daily, but `CLEANUP_INTERVAL_DAYS` (a repo Actions variable,
`DATHOST_CLEANUP_INTERVAL_DAYS`) throttles how often a *scheduled* run actually deletes anything —
a manual run always runs regardless. Controlled from `/admin/servers` (enable/disable, interval,
"Run now" — the run route temporarily re-enables a paused workflow just long enough to dispatch it,
since GitHub's disable blocks `workflow_dispatch` too, then restores whatever state it was in).
`GITHUB_DISPATCH_TOKEN` needs the "Variables" repository permission (distinct from "Actions") for
the interval control to work.
