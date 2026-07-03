# CS2 Demo Parsing Reference

External/community knowledge about the CS2 demo format and the parsing library DGLS is built on.
This is **not** DGLS architecture — that's [`demo-ingestion.md`](./demo-ingestion.md) (stats
pipeline) and [`replay.md`](./replay.md) (positions/events pipeline), both of which parse demos
through the same underlying library and share everything below. Update this doc when the parsing
library or CS2's demo format changes something documented here, or a new gotcha costs real
debugging time.

## The library: `@laihoe/demoparser2`

DGLS's parsers (`src/lib/demoParser.ts`, `src/lib/demoOrchestrator.ts`, `src/lib/replay/`) are
built on **[`@laihoe/demoparser2`](https://github.com/LaihoE/demoparser)** — a Rust-core CS2 demo
parser with Python/Node bindings. It's become the de facto standard for CS2 demo analysis: it backs
[**awpy**](https://github.com/pnxenopoulos/awpy), the most widely used Python library for CS2 data
analysis and visualization.

- **Query-style, not streaming/event-hook style.** You call `parseEvent`/`parseTicks` for the
  specific fields you want at specific points, rather than registering callbacks that fire per-tick
  as the demo plays through. This is why DGLS's stats parser reads accumulator fields
  (`ActionTrackingServices.m_i*`) at a specific tick rather than summing kill/damage events one by
  one — it's the natural shape for this library, not an idiosyncratic DGLS choice.
- **`parser.list_game_events()`** (Python) / the equivalent JS call lists every event name actually
  present in a given demo. Useful for discovering a field DGLS doesn't currently read without
  guessing at CS2 internals from memory — the schema has changed across CS2 patches before, so a
  name that worked in one demo isn't guaranteed to exist in an older or newer one.
- **awpy's own parsing walkthrough**
  ([awpy.readthedocs.io](https://awpy.readthedocs.io/en/latest/examples/parse_demo.html)) is a good
  reference for what a *typical* CS2 stats pipeline extracts from a demo — useful as a sanity check
  when deciding whether a new stat DGLS wants is derivable from existing accumulator/tick fields or
  genuinely needs a new query.
- Because it's Rust-cored, expect breaking-schema releases to lag a CS2 patch by however long the
  maintainer needs to catch up — the same "plugin stack breaks on a CS2 update" maintenance reality
  called out for MatchZy/CSSharp in [`cs2-stack-reference.md`](./cs2-stack-reference.md) applies
  here too, just for the parsing side instead of the hosting side.

## CS2 demo format notes worth knowing

- Demos are **tick-based**, not event-based, under the hood — "events" like `player_death` are a
  convenience layer the parser derives; the raw source of truth is per-tick entity state. This is
  why a field that isn't exposed as an "event" is often still recoverable via `parseTicks` against
  the right entity property.
- **Accumulator fields persist and reset on the engine's own schedule** (round boundaries, not demo
  boundaries) — reading one at the wrong tick silently gives you a partial or carried-over value
  rather than an error. DGLS's approach of reading at a specific, deliberately-chosen tick (the
  final live tick per round) exists specifically to avoid this trap.
- **Warmup and knife rounds are present in the raw tick/event stream** — the demo doesn't mark them
  as excluded for you; whatever's consuming the parser output has to filter on round state
  (`is_warmup_period`, round number, winner) itself. See `liveRounds` filtering in
  `demoParser.ts` for DGLS's version of this.

## External references

- `@laihoe/demoparser2`: [github.com/LaihoE/demoparser](https://github.com/LaihoE/demoparser)
  (README has the fullest usage documentation)
- awpy: [github.com/pnxenopoulos/awpy](https://github.com/pnxenopoulos/awpy) ·
  [demo-parsing walkthrough](https://awpy.readthedocs.io/en/latest/examples/parse_demo.html)

## Related DGLS docs

- [`demo-ingestion.md`](./demo-ingestion.md) — the upload → parse → stats pipeline built on this
  library
- [`replay.md`](./replay.md) — the positions/events pipeline built on the same library
- [`cs2-stack-reference.md`](./cs2-stack-reference.md) — the sibling reference doc for the
  DatHost/MatchZy/CounterStrikeSharp hosting stack
