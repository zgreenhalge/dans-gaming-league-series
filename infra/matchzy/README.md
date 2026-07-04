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
| `cfg/` | In-game `.cfg` files (MatchZy cvars, server.cfg). Pushed via the files API, or folded into the per-match loadmatch `cvars`. | **captured from the server filesystem** |

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
  economy); overlaps with `gamemode_competitive2v2_server.cfg`.
- other customized `cfg/MatchZy/*.cfg` **not yet captured here** — `live.cfg`, `warmup.cfg`,
  `knife.cfg`, `live_wingman_override.cfg` (1-byte, likely vestigial) — add them the same way if
  they turn out to matter.
- `cfg/server.cfg` / `cfg/autoexec.cfg` — base server cvars, if present.
- `cfg/gamemode_competitive2v2_server.cfg` — the 2v2 hybrid-mode overrides mentioned above.

Once captured, match-critical cvars (e.g. `matchzy_demo_recording_enabled`, ready threshold,
`matchzy_demo_upload_url`) are best **folded into the per-match loadmatch `cvars`** so the match config
is self-contained and independent of whatever cfg files happen to be on the server. The rest stays
here as the versioned baseline / disaster-recovery copy.

## Provision sequence (all endpoints verified live 2026-06-29)

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
confirmed copy. Runs weekly; also dispatchable manually (defaults to a dry run).
