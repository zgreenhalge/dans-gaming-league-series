<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Artifacts describe the present, not the past

Everything committed to this repo — docs, code comments, README / `note` / config fields, `.cfg`
files, tracked JSON — describes how things **are**, never how they **got that way**. No change
history, no changelog prose, no dates, no `previously / used to / re-enabled / now / we discovered /
confirmed live / disproved`, and no citing past incidents or prior versions *as explanation*.

Rationale for a **current** choice is welcome (`game_mode is competitive because the season is a
wingman hybrid`). Narration of the **change** is not (`game_mode was recreational, flipped on
2026-07-03 after X broke`).

**Litmus test:** if a sentence only makes sense to someone who saw the previous version, delete it. A
reader arriving fresh should never be able to tell the file was ever different. The "why it changed"
context belongs in the commit message, the PR, or the conversation — **never in the tree.**

This is a hard rule, not a style preference. The single exception is a *deliberately maintained*
decision log kept to stop the team regressing to a known-bad configuration (e.g. the "Issues we've
hit and how they were resolved" table in `docs/cs2-stack-reference.md`): it lives in **one designated
place**, framed as forward guidance — not license to scatter history into other files.

# Tools and scripts should be task-agnostic

When you build something reusable — anything in `scripts/`, a CLI, a shared helper — keep it general
and neutral. **Don't bake the current task into it.** No references to the issue/phase/spike you
happen to be working on, no assumptions about *why* it's being run, no comments narrating the
investigation in progress, no "throwaway"/"spike" framing that discourages reuse. Name it for what it
does (`inspect-demo`, not `parse-demo-parity`), document its inputs/outputs factually, and let the
caller interpret the results for their situation. A tool written for "verify X for feature Y" quietly
rots into a single-use script; the same tool written as "inspect X" stays reusable. Put the
task-specific interpretation in the conversation, the PR, or a doc — not in the tool.

# Supabase changes require live, per-operation approval

A Supabase MCP connector is available in agent sessions working on this repo, with tools that
directly read and mutate the live database — `apply_migration`, `execute_sql`, `create_project`,
`create_branch`, `delete_branch`, `merge_branch`, `rebase_branch`, `reset_branch`,
`restore_project`, `pause_project`, `deploy_edge_function`, `confirm_cost`, and any `execute_sql`
call that isn't a plain read (`SELECT`). Before running any of these, show the user the **exact**
command or statement you're about to run and get their explicit go-ahead **at that moment** — not a
blanket "yes, go ahead" from earlier in the conversation, and not an approval that covered a
different operation. Every mutating call gets its own explicit approval, every time, no exceptions.

This holds even when a change looks obviously correct, reversible, or already agreed upon in
principle (e.g. "add the seed_ehog column we discussed") — describe the literal command and wait for
a yes before running it. RLS is off on every table in this project (see
[`docs/architecture.md`](./docs/architecture.md)), so there is no database-level backstop if a
mutation goes wrong — the live approval step is the only guardrail, and it is not optional.

Read-only tools — `list_tables`, `get_logs`, `get_advisors`, `search_docs`, `list_migrations`,
`list_branches`, `list_extensions`, `list_projects`, `get_project`, `get_organization`,
`list_organizations`, `get_cost`, `get_project_url`, `get_publishable_keys`, `list_edge_functions`,
`get_edge_function`, `generate_typescript_types`, and `execute_sql` for a plain `SELECT` — can be
used freely for investigation without asking first.

# Local `*_handoff/` dirs are gitignored scratch

Directories matching `*_handoff/` (e.g. `dathost_handoff/`, `ehog_handoff/`) hold planning and
handoff material piped down from Claude online sessions to drive iterative implementation. They are
**gitignored and local-only** (`.gitignore`: `*handoff/`) — nothing in them is tracked or expected
to persist beyond local disk. Use them freely for plans, specs, and session-to-session progress
notes, but don't commit them, don't rely on them existing in a fresh clone, and keep anything that
must outlive the work in tracked docs (`docs/`) or code.
