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
| `golden-server-settings.json` | DatHost `cs2_settings` (game mode, GOTV, workshop collection, plugins, bots). PUT to `/game-servers/{id}` before start. | captured from the live API |
| `cfg/` | In-game `.cfg` files (MatchZy cvars, server.cfg). Pushed via the files API, or folded into the per-match loadmatch `cvars`. | **captured from the server filesystem** |

## What goes in `cfg/` (capture from DatHost File Manager / FTP)

- `cfg/MatchZy/config.cfg` — main MatchZy server config (ready threshold, demo recording, knife,
  overtime, etc.). **Most important.**
- other customized `cfg/MatchZy/*.cfg` — `live.cfg`, `warmup.cfg`, `knife.cfg`,
  `live_wingman_override.cfg`.
- `cfg/server.cfg` / `cfg/autoexec.cfg` — base server cvars, if present.

Once captured, match-critical cvars (e.g. `matchzy_demo_recording_enabled`, ready threshold,
`matchzy_demo_upload_url`) are best **folded into the per-match loadmatch `cvars`** so the match config
is self-contained and independent of whatever cfg files happen to be on the server. The rest stays
here as the versioned baseline / disaster-recovery copy.

## Provision sequence (all endpoints verified live 2026-06-29)

1. **`PUT /game-servers/{id}`** — re-assert `golden-server-settings.json` (+ per-match map override:
   `cs2_settings.maps_source=workshop_single_map`, `cs2_settings.workshop_single_map_id=<picked map>`).
2. (optional) **push `cfg/` files** via `POST /game-servers/{id}/files/{path}`.
3. **`POST /game-servers/{id}/start`** → boot (~14s).
4. **`matchzy_loadmatch[_url]`** via `POST /game-servers/{id}/console` — per-match teams / matchid /
   map_sides / cvars (from `scripts/gen-matchzy-config.ts`).
5. (teardown) **`POST /game-servers/{id}/stop`** on confirmed score/demo. Never `delete` (reuse model).

Nightly cleanup/reset safety net: issue #132.
