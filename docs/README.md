# DGLS Documentation

Reference docs for **Dan's Gaming League Series** — a CS2 Wingman stat tracker. Start here, then
follow the link that matches what you're doing. New to the codebase? Read
[`glossary.md`](./glossary.md) first.

| Doc | What's in it |
|---|---|
| [`glossary.md`](./glossary.md) | DGLS-specific domain terms (gauntlet, H2H, faction, RWR, veto, …) + a map of where each concept lives in the code |
| [`season-lifecycle.md`](./season-lifecycle.md) | How a season runs end to end: each stage in order, who acts, what gates it, and the route or function behind it; who can do what (the access gates); every process timer |
| [`patterns.md`](./patterns.md) | Cross-cutting conventions every change should follow |
| [`recipes.md`](./recipes.md) | Step-by-step patterns for common changes (new stat, page, query helper, map) |
| [`architecture.md`](./architecture.md) | Routes, auth, the mutation API, database schema, deployment |
| [`calculations.md`](./calculations.md) | Formulas behind every stat and ranking (sabremetrics, canonical sorts, narrative metrics) |
| [`visual-conventions.md`](./visual-conventions.md) | The shared CSS hover/glow/accent system and UI primitives |
| [`ehog.md`](./ehog.md) | The EHOG player skill rating engine (OpenSkill) |
| [`demo-ingestion.md`](./demo-ingestion.md) | The in-app CS2 demo upload → parse → stats pipeline |
| [`hosting.md`](./hosting.md) | DatHost + MatchZy per-match server hosting, the auto-ingestion pipeline, and admin surfaces |
| [`cs2-stack-reference.md`](./cs2-stack-reference.md) | DatHost/MatchZy/CounterStrikeSharp best practices, gotchas, and external references (tool-level, not DGLS architecture) |
| [`replay.md`](./replay.md) | The 2D match replay + core-events pipeline (`replay.json`, GitHub Actions jobs, `background_jobs`) |
| [`demo-parsing-reference.md`](./demo-parsing-reference.md) | External/community knowledge about the CS2 demo format and the `demoparser2` library (tool-level, shared by demo-ingestion and replay) |
| [`github-actions.md`](./github-actions.md) | When to run work as a GitHub Action vs a Vercel function, and how to build a background-job Action (the dispatch → workflow → `scripts/*` pattern) |
| [`e2e.md`](./e2e.md) | Playwright end-to-end coverage: local Supabase stack, dev-mode mock auth, self-seeding fixtures, CI placement, and the Claude Code `SessionStart` hook that bootstraps the local stack for agent sessions |

## Diagrams

Diagrams are Mermaid code blocks inside the doc that owns their area: GitHub renders them, and they
read as text in a diff or to an agent. Search the docs for ```` ```mermaid ```` to find them all.

| Diagram | Kind | Where |
|---|---|---|
| A season from creation to archive | Flowchart | [`season-lifecycle.md`](./season-lifecycle.md#at-a-glance) |
| Schedule draft → real weeks and matches | State | [`season-lifecycle.md`](./season-lifecycle.md#setup-upcoming) |
| One match, from scheduling to the committed score | Sequence | [`season-lifecycle.md`](./season-lifecycle.md#regular-season-active) |
| `seasons.status`, regular and gauntlet | State | [`architecture.md`](./architecture.md#season-status-lifecycle) |
| Core league tables and their foreign keys | Entity-relationship | [`architecture.md`](./architecture.md#tables) |
| `match_server_state.server_state` | State | [`hosting.md`](./hosting.md#server-state-machine) |
| `demo_ingest` job statuses | State | [`hosting.md`](./hosting.md#job-state-background_jobs-job_type--demo_ingest) |

For quick-start, env vars, and npm commands see the root [`README.md`](../README.md). Agent-specific
guidance lives in [`../CLAUDE.md`](../CLAUDE.md) and [`../AGENTS.md`](../AGENTS.md). The historical
CSV ingestion pipeline is documented in [`../ingestion/README.md`](../ingestion/README.md).
