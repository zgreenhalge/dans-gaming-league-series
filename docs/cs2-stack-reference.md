# CS2 Server Stack Reference: DatHost, MatchZy, CounterStrikeSharp

A knowledge base for the plugin stack and hosting API DGLS runs its match servers on. This is
**not** DGLS architecture (that's [`hosting.md`](./hosting.md) — routes, lifecycle state machine,
ingestion pipeline) — it's the tool-level facts, gotchas, and external references worth having in
one place before touching server config, MatchZy cvars, or the DatHost API. Update this doc when a
CS2/MatchZy/DatHost patch changes something documented here, or when a new gotcha costs real
debugging time.

## The stack

```
DatHost (hosting) → Metamod:Source v2 → CounterStrikeSharp (CSSharp) → MatchZy
```

Install/load order is fixed and matters: **Metamod v2 → CSSharp → MatchZy**. MatchZy is a
CounterStrikeSharp plugin; CSSharp is a Metamod plugin. Getting the order wrong (or having a
version mismatch between CSSharp and the MatchZy build) is the most common cause of a server that
boots but silently doesn't run match logic.

- **Metamod:Source** — [sourcemm.net](https://www.sourcemm.net/) — the plugin-loading shim CS2 needs
  before anything else can hook the engine.
- **CounterStrikeSharp** — [docs.cssharp.dev](https://docs.cssharp.dev/) — C#/.NET plugin framework
  for CS2; MatchZy is written against it.
- **MatchZy** (mainline `shobhit-pathak/MatchZy`) —
  [github.com/shobhit-pathak/MatchZy](https://github.com/shobhit-pathak/MatchZy) (README + wiki) —
  the match-management plugin: ready-up, knife, live config loading, demo recording/upload, stats
  reporting.
- **DatHost** — game server host with a REST API for provisioning, config, and console access.
  [readme.io CS2 REST API](https://dathost.readme.io/reference/cs2-servers-rest-api) (the actual
  endpoint reference — HTTP Basic auth, `/api/0.1` base path). DatHost also publishes a
  [Python client library on readthedocs](https://dathost.readthedocs.io/en/latest/api.html) that
  wraps the same REST API in `Awaiting`/`Blocking` classes, if a Python wrapper is ever useful
  instead of calling the REST API directly (DGLS doesn't use it — `src/lib/dathost.ts` calls the
  REST API directly from TypeScript).

**Maintenance reality:** CS2 patches regularly break Metamod/CSSharp/MatchZy until each project
ships a compatible update — this is recurring, not a one-time risk. A golden image or config
captured before a breaking patch can boot into a broken state after one. Check the MatchZy/CSSharp
GitHub release notes after any CS2 update if the server starts behaving oddly.

## DatHost API patterns

- **Auth:** HTTP Basic, DatHost account email + API password. Base path `/api/0.1`.
- **Golden-image pattern:** `duplicate` a configured server to clone it — but it clones from
  DatHost's **local file cache**, not the live filesystem. Run `sync-files` on the source server
  after any config/cfg change, or clones inherit stale files. This is the mechanism behind any
  "clone-per-match" design; DGLS itself uses a **reuse** model instead (see below) but the API
  facts apply either way.
- **Two independently-drifting sources of truth:** `cs2_settings` (the game-server-level JSON,
  driving map/mode/GOTV/bot config — set via `PUT /game-servers/{id}`) and in-game `.cfg` files
  (MatchZy cvars, server cvars — pushed via the files API or the in-panel file manager). A server
  can drift in either dimension independently: someone edits a cvar in a `.cfg` in the panel, or
  someone flips a `cs2_settings` toggle in the panel UI. Treat them as two separate diff surfaces
  (DGLS's `dathost-golden-diff.ts` checks both).
- **Array-valued `cs2_settings` fields (e.g. `metamod_plugins`) don't round-trip safely** through a
  simple re-PUT — DatHost preserves them across other changes, and the form-encoding for arrays via
  the REST API isn't well-documented enough to guess at safely. Treat those as manual-only edits.
- **`workshop_collection` mode is unreliable in practice** (confirmed against DGLS's own server) —
  prefer pinning a single workshop map (`maps_source=workshop_single_map` +
  `workshop_single_map_id`) per launch over trusting a collection to rotate correctly.
- **Boot time is a real, non-trivial delay** — budget for it in any UI that shows a "server
  starting" state; measure it empirically (DatHost's docs don't commit to a number) rather than
  trusting a fixed constant indefinitely. DGLS observed ~14s initially, later re-measured at ~20s
  on the same server — re-check the estimate if boot behavior seems to have changed rather than
  assuming the old number still holds.
- **Console/RCON access** (`POST /game-servers/{id}/console`) is how you issue `matchzy_loadmatch_url`,
  any live cvar change, or debug commands without a game client — useful for scripting or a quick
  live check without connecting.

## MatchZy match-config contract

MatchZy is driven by a JSON config, loaded either inline or via `matchzy_loadmatch_url <url>
[header] [value]` (an authenticated GET the server issues on load — this is how DGLS generates a
fresh per-match config without hand-authoring one). Key fields, per the
[MatchZy README/wiki](https://github.com/shobhit-pathak/MatchZy):

- `matchid` — an arbitrary string that gets stamped onto the demo filename and the
  `MatchZy-MatchId` header on upload. Using your own system's match ID here makes the returned demo
  self-labeling — no separate ID-mapping table needed.
- `team1` / `team2` — `{ name, players: { steamid64: displayName } }`.
- `players_per_team` — `2` for Wingman-style 2v2; MatchZy doesn't require the official `wingman`
  game mode preset to run 2v2 — DatHost's `game_mode` and MatchZy's `players_per_team` are
  independent knobs.
- `map_sides` — fixed **per map slot** in the loaded config; there is no runtime "conditional
  knife" toggle. If you need "force a side if known, else knife," that logic has to live in
  whatever generates the config, not in MatchZy itself.
- `spectators.players` — **not optional if you want spectators.** See the gotcha below.
- `clinch_series` — end the series early once the outcome is decided (best-of behavior).
- `cvars` — arbitrary per-match cvar overrides, applied on load — the place to set
  `matchzy_demo_upload_url`/header, ready thresholds, or anything else that should be per-match
  rather than baked into the server's static `.cfg` files.

### Gotcha: MatchZy locks the server to the roster — spectators get kicked too

Once a match JSON is loaded, MatchZy kicks anyone connecting who isn't listed in
`team1`/`team2`/`spectators` (confirmed live on DGLS's own server; see
[MatchZy issue #372](https://github.com/shobhit-pathak/MatchZy/issues/372) for another operator
independently hitting the same underlying lockout — a rostered player getting kicked because their
SteamID wasn't in the loaded config — which is the general mechanism behind the spectator case too,
even though that issue itself isn't about spectators specifically). This is easy to miss because a
*player* roster mismatch fails loudly, but a missing `spectators` list fails silently — a friend
trying to watch just gets booted with no obvious cause pointing back to the config.

**Fix pattern:** populate `spectators.players` with every account that should be allowed to watch,
not just the two rostered teams. DGLS's `buildMatchzyConfig()`
(`src/lib/matchzy.ts`) fills it with every known league player's steamid64 minus whoever's already
on team1/team2, so any league member can spectate without being explicitly invited per match. This
only covers *known* accounts — a spectator outside your player table still needs to be added
explicitly if you want them in.

### Demo upload contract

After a map ends (post GOTV-flush), MatchZy `POST`s the raw `.dem` bytes
(`application/octet-stream`, no multipart wrapper) to `matchzy_demo_upload_url` with headers:

- `MatchZy-FileName`
- `MatchZy-MatchId` — whatever `matchid` was in the loaded config
- `MatchZy-MapNumber` — 0-indexed; a BO1 series is always `0`. A receiver that doesn't reject
  `MapNumber > 0` will silently accept and overwrite the same storage key on a multi-map series.
- `MatchZy-RoundNumber`

Optional shared-secret auth via `matchzy_demo_upload_header_key` /
`matchzy_demo_upload_header_value` — MatchZy sends it as a plain header on the POST, so verify it
constant-time before buffering/streaming the body, not after.

**Size matters for the receiver.** A Wingman GOTV demo can exceed typical serverless request-body
caps (e.g. Vercel Functions' hard 4.5 MB limit) — plan the receiving endpoint around a platform that
accepts large streamed bodies (DGLS uses a Cloudflare Worker in front of R2 for exactly this
reason; see [`hosting.md`](./hosting.md)).

MatchZy also POSTs match events (including final `map_result`) to `matchzy_remote_log_url`, and
exposes `matchzy_get_match_stats <matchId>` as a console command — a useful independent
cross-check against whatever your own parser derives from the demo.

### GOTV vs demo recording — MatchZy's recording *is* GOTV, not a separate system

An earlier version of this doc claimed GOTV and MatchZy's demo recording are independent systems —
that's wrong, and DGLS's own match 44 disproved it (`enable_gotv: false` produced **zero demo
files**). Looking at MatchZy's source
([`DemoManagement.cs`](https://github.com/shobhit-pathak/MatchZy/blob/dev/DemoManagement.cs))
confirms why: MatchZy's `StartDemoRecording()`/`StopDemoRecording()` are thin wrappers around the
native `tv_record`/`tv_stoprecord` console commands — i.e. MatchZy doesn't record independently, it
drives the same GOTV/SourceTV recording mechanism GOTV itself uses. `tv_record` has no meaning
without an active GOTV host, so `enable_gotv: false` silently produces no demo. This is inherited
from **Get5**, MatchZy's config-format ancestor: Get5's
[`recording.sp`](https://github.com/splewis/get5/blob/master/scripting/get5/recording.sp) uses the
identical `tv_record` approach, but explicitly checks `IsTVEnabled()` first and logs `"Demo
recording will not work with tv_enable 0..."` if it isn't — a guard-rail MatchZy doesn't reproduce,
so on MatchZy the failure is silent instead of logged. **`enable_gotv` must stay `true`** for demo
recording to work at all; MatchZy's own docs
([shobhit-pathak.github.io/MatchZy/gotv](https://shobhit-pathak.github.io/MatchZy/gotv/)) gesture at
this ("changing `tv_delay` or `tv_enable`... is going to cause problems with your demos") without
spelling out the underlying `tv_record` dependency. Leave `tv_autorecord 0` so MatchZy (not GOTV's
own auto-record) controls recording, and set `tv_delay` at the server level rather than toggling it
inside per-phase cfgs (warmup/live) — MatchZy's phase transitions aren't the right place to be
flipping broadcast-delay state.

## Common MatchZy cvars worth knowing

| cvar | Purpose |
|---|---|
| `matchzy_demo_recording_enabled` | MatchZy-controlled demo recording (independent of GOTV) |
| `matchzy_demo_upload_url` / `_header_key` / `_header_value` | where + how the finished demo is POSTed |
| `matchzy_remote_log_url` | webhook target for match events (`match_started`, `map_result`, …) |
| `matchzy_loadmatch_url` | fetch a match config JSON from an authenticated URL on load |
| ready-threshold cvars | fraction of each team required `!ready` before live starts |

Exact cvar names and defaults drift across MatchZy releases — check the
[MatchZy wiki](https://github.com/shobhit-pathak/MatchZy) for the version actually installed rather
than trusting a cached list.

## Beyond the official docs

The official docs answer "what does this field do." These answer "what does someone who's
actually run this stack know that isn't written down anywhere formal." A lot of CS2-server content
online is thin SEO filler from hosting companies — the ones below are either the maintainers
themselves, a well-known long-running community project, or corroborate something we found the
hard way (GOTV/`tv_autorecord`, spectator lockout), which is why they're worth keeping.

### MatchZy's own docs site (more current than the README)

[shobhit-pathak.github.io/MatchZy](https://shobhit-pathak.github.io/MatchZy/installation/) is the
maintainer's docs site — it's kept more current than the GitHub README and is the right first stop
for install order and config reference. It also flags that the Windows build of CounterStrikeSharp
is a separate download from the Linux one — an easy thing to get wrong if you copy a Linux-oriented
guide.

### Get5 — the plugin MatchZy's config format descends from

MatchZy explicitly supports **Get5-style match configs** (JSON schema compatibility, `Get5 Panel`
integration). [Get5's own docs](https://splewis.github.io/get5/latest/) — especially the
[match schema reference](https://splewis.github.io/get5/latest/match_schema/) — predate MatchZy by
years (Get5 was the CS:GO-era match plugin) and are more thoroughly written than MatchZy's own
config docs in places, since Get5 had a much longer maturation period under SourceMod. Concepts
carry over almost 1:1 (team/player objects, map lists, side selection, cvars), so when MatchZy's
own docs are thin on a config field, checking whether Get5 documents the equivalent field is often
faster than digging through MatchZy's source.

### DatHost's higher-level Match API (an alternative we didn't take)

Beyond the plain game-server REST API DGLS uses (`PUT /game-servers/{id}`, `start`/`stop`,
`console`), DatHost also offers a **[CS2 Match API](https://dathost.readme.io/docs/cs2-match-api-introduction)**
(`POST /api/0.1/cs2-matches`) that manages match lifecycle for you — players, team metadata, map
selection, timeouts — and pushes round-end/match-end/votekick events to webhooks you register,
polled or event-driven. **It explicitly does not manage MatchZy/Get5-style config files** — it
layers match orchestration on top of whatever's already configured on the server, rather than
replacing MatchZy's config-loading model. Worth knowing this exists: if DGLS's own lifecycle code
(`dathost-lifecycle.ts`) ever grows enough bespoke event-handling logic to feel like it's
reinventing part of this, that's the API to evaluate before building more of it in-house — the
tradeoff is giving up the fully self-authored `matchzy_loadmatch_url` config generation DGLS
already relies on.

### MatchZy Auto Tournament / the "Enhanced" fork ecosystem

[mat.sivert.io](https://mat.sivert.io/getting-started/server-setup/) documents a full tournament
platform built on a **MatchZy Enhanced fork**, not mainline MatchZy — it adds event webhooks
mainline MatchZy doesn't expose, at the cost of requiring the fork server-side. This is the concrete
shape of the mainline-vs-fork tradeoff DGLS weighed and settled on mainline for: mainline gets you
DatHost compatibility and no fork-maintenance risk, the Enhanced fork gets you richer events and an
auto-updater at the cost of
depending on a smaller, less-guaranteed-to-track-CS2-patches project. Useful to revisit if DGLS
ever needs an event MatchZy mainline doesn't emit.

### GOTV / demo-recording corroboration

DatHost's own support article on [recording GOTV demos](https://help.dathost.net/article/140-cs2-record-gotv-demo)
independently warns against `tv_autorecord` ("can cause a lot of problems and isn't recommended") —
this matches the `tv_autorecord 0` convention already documented above. The deeper mechanism —
MatchZy's recording being a `tv_record` wrapper, requiring GOTV to be on — is confirmed directly in
source rather than by inference: see [`DemoManagement.cs`](https://github.com/shobhit-pathak/MatchZy/blob/dev/DemoManagement.cs)
and, more explicitly, Get5's [`recording.sp`](https://github.com/splewis/get5/blob/master/scripting/get5/recording.sp)
(which checks `IsTVEnabled()` and logs an explicit error if GOTV is off — the exact failure mode
DGLS hit via match 44, just silent instead of logged on MatchZy). If in-game weirdness recurs with
`enable_gotv` re-enabled, look at MatchZy/CSSharp version compatibility before re-disabling GOTV —
disabling it has a confirmed, unconditional cost (no demo recording at all), not just a maybe.

### Valve's own dedicated-server docs

[developer.valvesoftware.com/wiki/Counter-Strike_2/Dedicated_Servers](https://developer.valvesoftware.com/wiki/Counter-Strike_2/Dedicated_Servers)
is the primal source for anything below the plugin layer — SteamCMD install, GSLT tokens, raw
launch options, and CS2-vs-CS:GO dedicated-server differences (CS2's dedicated server and client
share an appid, unlike CS:GO's separate one). DatHost abstracts almost all of this away, but it's
the right reference if a problem ever turns out to be at the engine/launch-option layer rather than
the MatchZy/CSSharp layer — worth ruling out before assuming a plugin bug.

## Workflow: keeping a live server in sync with a versioned config

Any server that's periodically reconfigured through a web panel (for other game modes, testing, or
by a teammate) will drift from whatever config you think is live. The durable pattern:

1. **Version the intended config** (both the `cs2_settings`-equivalent JSON and any `.cfg` files)
   in the repo — this is your source of truth, not the panel.
2. **Diff before trusting.** A read-only script/tool that fetches live state and compares it
   field-by-field (and file-by-file, normalizing line endings so an editor re-save doesn't look
   like a content change) catches drift before it causes a bad match rather than after.
3. **Never auto-resolve drift in a direction.** Drift is ambiguous — it might be an intentional
   retune worth keeping (capture live → repo) or an unwanted leftover from another use of the
   server (reassert repo → live). Surface the diff and let a human pick the direction.
4. **Re-assert before every use, not just once.** If the server gets reconfigured between uses,
   "set it up correctly once" doesn't hold — the golden config has to be re-applied at the start of
   every session/match, not treated as a one-time setup step.

DGLS implements this as `scripts/dathost-golden-diff.ts` / `scripts/dathost-golden-apply.ts`
(shared plumbing in `scripts/dathost-golden-shared.ts`) plus the `dathost-golden-config` Claude Code
skill that wraps the diff → ask → apply flow. See [`infra/matchzy/README.md`](../infra/matchzy/README.md)
for the DGLS-specific layout.

## Issues we've hit and how they were resolved

| Symptom | Root cause | Fix |
|---|---|---|
| Spectators got kicked on connect | MatchZy locks the server to `team1`/`team2`/`spectators` once a match JSON loads; `spectators` was empty | Populate `spectators.players` with every known player minus the rostered two teams (`buildMatchzyConfig`) |
| Players reported in-game weirdness during matches | Suspected GOTV interaction (`enable_gotv`) | Disabled `enable_gotv` in the golden config to test the theory |
| Match 44 recorded zero demo files | `enable_gotv` was disabled; MatchZy's demo recording is a `tv_record` wrapper with no independent recording path, so it silently no-ops without GOTV (confirmed in MatchZy/Get5 source, see below) | Re-enabled `enable_gotv` in the golden config; `tv_autorecord 0`/`tv_delay 0` in `cfg/server.cfg` keep GOTV from fighting MatchZy for recording control |
| "Server starting" progress UI finished before the server was actually ready | Boot-time estimate was measured once and went stale as real boot time drifted longer | Re-measured against live behavior and bumped the estimate (14s → 20s); treat any hardcoded boot estimate as needing periodic re-validation, not a one-time constant |
| `workshop_collection` map rotation behaved unreliably | DatHost's collection-based map source doesn't reliably resolve/rotate on this server | Always pin a single workshop map per launch (`workshop_single_map`); the provisioning code throws rather than silently falling back to a collection |

## External references

- MatchZy: [github.com/shobhit-pathak/MatchZy](https://github.com/shobhit-pathak/MatchZy) (README +
  wiki + issues — issues are often the fastest way to confirm an undocumented behavior, like #372
  above) · maintainer's docs site: [shobhit-pathak.github.io/MatchZy](https://shobhit-pathak.github.io/MatchZy/installation/)
- CounterStrikeSharp docs: [docs.cssharp.dev](https://docs.cssharp.dev/) · hello-world plugin guide:
  [docfx/docs/guides/hello-world-plugin.md](https://github.com/roflmuffin/CounterStrikeSharp/blob/main/docfx/docs/guides/hello-world-plugin.md)
- Metamod:Source: [sourcemm.net](https://www.sourcemm.net/)
- DatHost API: [dathost.readme.io CS2 REST API](https://dathost.readme.io/reference/cs2-servers-rest-api)
  (the endpoint reference) ·
  [dathost.readthedocs.io](https://dathost.readthedocs.io/en/latest/api.html) (Python client library,
  not the REST reference — see above) ·
  [CS2 Match API](https://dathost.readme.io/docs/cs2-match-api-introduction) (higher-level
  alternative, not currently used — see above) ·
  [GOTV demo recording guide](https://help.dathost.net/article/140-cs2-record-gotv-demo)
- Get5 (MatchZy's config-format ancestor): [splewis.github.io/get5](https://splewis.github.io/get5/latest/)
  · [match schema reference](https://splewis.github.io/get5/latest/match_schema/)
- Valve dedicated-server docs: [developer.valvesoftware.com/wiki/Counter-Strike_2/Dedicated_Servers](https://developer.valvesoftware.com/wiki/Counter-Strike_2/Dedicated_Servers)

## Related DGLS docs

- [`hosting.md`](./hosting.md) — DGLS's own lifecycle state machine, ingestion pipeline, routes, and
  admin surfaces built on top of this stack
- [`infra/matchzy/README.md`](../infra/matchzy/README.md) — the versioned golden config layout and
  diff/apply tooling
- [`demo-ingestion.md`](./demo-ingestion.md) — the parse/confirm pipeline the demo feeds into
