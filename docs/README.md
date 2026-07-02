# DGLS Documentation

Reference docs for **Dan's Gaming League Series** — a CS2 Wingman stat tracker. Start here, then
follow the link that matches what you're doing. New to the codebase? Read
[`glossary.md`](./glossary.md) first.

| Doc | What's in it |
|---|---|
| [`glossary.md`](./glossary.md) | DGLS-specific domain terms (gauntlet, H2H, faction, RWR, veto, …) + a map of where each concept lives in the code |
| [`patterns.md`](./patterns.md) | Cross-cutting conventions every change should follow |
| [`recipes.md`](./recipes.md) | Step-by-step patterns for common changes (new stat, page, query helper, map) |
| [`architecture.md`](./architecture.md) | Routes, auth, the mutation API, database schema, deployment |
| [`calculations.md`](./calculations.md) | Formulas behind every stat and ranking (sabremetrics, canonical sorts, narrative metrics) |
| [`visual-conventions.md`](./visual-conventions.md) | The shared CSS hover/glow/accent system and UI primitives |
| [`ehog.md`](./ehog.md) | The EHOG player skill rating engine (OpenSkill) |
| [`demo-ingestion.md`](./demo-ingestion.md) | The in-app CS2 demo upload → parse → stats pipeline |
| [`hosting.md`](./hosting.md) | DatHost + MatchZy per-match server hosting, the auto-ingestion pipeline, and admin surfaces |
| [`replay.md`](./replay.md) | The 2D match replay + core-events pipeline (`replay.json`, GitHub Actions jobs, `background_jobs`) |
| [`github-actions.md`](./github-actions.md) | When to run work as a GitHub Action vs a Vercel function, and how to build a background-job Action (the dispatch → workflow → `scripts/*` pattern) |

For quick-start, env vars, and npm commands see the root [`README.md`](../README.md). Agent-specific
guidance lives in [`../CLAUDE.md`](../CLAUDE.md) and [`../AGENTS.md`](../AGENTS.md). The historical
CSV ingestion pipeline is documented in [`../ingestion/README.md`](../ingestion/README.md).
