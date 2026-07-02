# Demo Ingestion

How an uploaded CS2 `.dem` file becomes match and sabremetric stats. This is the live in-app
ingestion path (distinct from the historical CSV pipeline in `ingestion/`). The formulas the parser
feeds are defined in [`calculations.md`](./calculations.md); the storage/route surface is summarized
in [`architecture.md`](./architecture.md).

## Pipeline

1. **Upload URL** — `POST /api/matches/[id]/demo/upload-url` mints a presigned **Cloudflare R2**
   PUT URL (via `getSignedUrl` over the S3-compatible client in `src/lib/r2.ts`). The object key is
   deterministic per match: `demoKey(matchId)` → `<matchId>/game.dem`. The caller must be in the
   match or an admin.
2. **Client upload** — the browser (`DemoUploadModal.tsx`, opened from `MatchTabView.tsx`) PUTs the
   `.dem` straight to R2 with the presigned URL. The file never passes through the Next.js server.
3. **Parse** — `POST /api/matches/[id]/demo/parse` fetches the object back from R2, decompresses if
   needed, and runs two parsers over the buffer:
   - `parseDemoFile()` (`src/lib/demoParser.ts`) — basic per-player stats (K/A/D, damage, ADR,
     rounds, win flags) plus warnings.
   - `parseDemoSabremetrics()` (`src/lib/demoOrchestrator.ts`) — the advanced sabremetric fields.
   The route returns the merged result for review; it does **not** write to the DB. The reviewed
   stats are persisted through the score-submission endpoint (`PATCH /api/matches/[id]/score`),
   which writes basics to `player_match_stats` and upserts the sabremetric rows into
   `player_match_sabremetrics` (keyed by `player_match_stats_id`).

Both parsers take the same inputs: the demo buffer, the resolved **roster**, `skins_starting_side`,
and the season's `target_win_rounds`. The roster (which Steam player maps to which DGLS player and
faction) is resolved server-side before parsing — see `parsers/rosterResolver.ts`.

`skins_starting_side` is **optional**. When it's `null` (gauntlet/knife matches, which have no
stored side), the parser infers it from the demo — see "Starting-side inference" below — so those
matches still self-derive a score and stats with no manual entry.

## Sabremetric collectors

`demoOrchestrator.ts` composes one collector per metric family, each in `src/lib/parsers/`:

| Module | Produces |
|---|---|
| `rosterResolver.ts` | Steam-id → DGLS player + faction resolution |
| `matchContext.ts` | Per-round/per-death context shared by the collectors |
| `roundSides.ts` | Which side (CT/T) each faction is on each round — see "Side splits" below |
| `accumulators.ts` | Per-side K/A/D/damage/headshot deltas from round-end accumulator ticks |
| `entry.ts` | Opening kills/deaths (`Entry+`) |
| `kast.ts` | KAST rounds + trade tracking (`KAST+`, Trade Score) |
| `multikill.ts` | Multikill rounds |
| `clutch.ts` | 1vN attempts/wins (`Clutch+`, `Choke+`) |
| `utility.ts` | Flash assists, utility damage, teamflash/self-flash (`Utility+`, Beer Tax) |
| `objectives.ts` | Bomb plants/defuses (`Objective+`) |

## Side splits (deterministic from the round-1 anchor)

CT/T splits are derived **deterministically** from faction (SHIRTS/SKINS), the starting side, and the
round number — the regulation half-swap and overtime (MR3) logic in `parsers/roundSides.ts` walks the
sides from that single round-1 anchor, with no per-round `team_num` reads. Per-round deltas come from
the engine's `ActionTrackingServices` accumulators in `parsers/accumulators.ts`. See
[`calculations.md`](./calculations.md#side-splits) for the exact rules.

### Starting-side inference

The anchor is `skins_starting_side` when stored. When it's absent (gauntlet/knife), `parsers/
sideInference.ts` reads `team_num` **once**, at the first live round's tick, and maps each resolved
player's side to their faction to decide which side SKINS started on (majority vote; falls back to the
inverse of SHIRTS if no SKINS player resolved). This is a single anchor read — not the fragile
per-round lookup the split logic deliberately avoids.

Precedence: **a stored side always wins** (it was entered deliberately); the demo only fills a missing
value. When a stored side and the demo disagree, the parser keeps the stored side and emits a warning,
which surfaces on the admin ingestion page (`/admin/ingestion`) as a data-quality flag.

## Environment

The demo path needs Cloudflare R2 credentials (in addition to the standard env vars in the root
[`README.md`](../README.md)):

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_R2_ACCOUNT_ID` | R2 account — used to build the S3 endpoint |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 access key |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 secret key |
| `CLOUDFLARE_R2_BUCKET_NAME` | Bucket that holds uploaded `.dem` files |
