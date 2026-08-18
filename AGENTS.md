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

# Merging a PR requires its own live approval

Opening a PR, pushing fixes to a PR you opened, and merging a PR are three different levels of
authorization — never conflate them. Merging always needs an explicit go-ahead given **for that PR,
at that moment.** An approval for an earlier PR does not carry over, no matter how closely related
the two are — a precursor PR and its own follow-up fix are still two separate approvals, not one
approval covering the pair. "Drive a PR you own to green" (fixing CI failures, responding to review
comments) is not the same permission as "merge it once it's green" — treat merge as always requiring
its own ask unless the user's message about *that specific PR* says otherwise.

This holds even when merging looks obviously correct — CI is green, the change is small, the user
approved the general direction earlier, or an almost-identical PR was already approved in this same
conversation. Describe which PR you'd be merging and wait for a yes before running it.

Opening a PR is a lower-stakes action than merging but still isn't free: don't open one speculatively
just because a natural next step suggests it (e.g. splitting a change into a precursor + follow-up).
If the user hasn't asked for a PR, say what you'd open and why, and let them confirm first.

# Don't self-schedule reminders or event subscriptions

Agent sessions on this repo have access to tools that create standing follow-up work without a human
watching in the moment — scheduled wakeups/check-ins, `send_later`, trigger/Routine creation, and PR
activity subscriptions (`subscribe_pr_activity` and equivalents). Do not reach for any of these on
your own initiative. The user checks back on long-running work manually; a self-scheduled reminder or
subscription burns their tokens on a cadence they didn't ask for and aren't necessarily watching.

Only use these tools when the user's current message explicitly asks for that behavior — "watch this
PR," "check back in an hour," "remind me later," "babysit this," or similar. A task being long-running,
async, or "the kind of thing you'd normally follow up on" is not itself a request — if the user hasn't
asked, finish the turn and let them check back or ask you to watch it. This includes follow-up
check-ins on a PR you just opened yourself: don't subscribe or schedule a reminder unless asked, even
though the PR workflow above describes what to do *if* you are watching one.

# Local `*_handoff/` dirs are gitignored scratch

Directories matching `*_handoff/` (e.g. `dathost_handoff/`, `ehog_handoff/`) hold planning and
handoff material piped down from Claude online sessions to drive iterative implementation. They are
**gitignored and local-only** (`.gitignore`: `*handoff/`) — nothing in them is tracked or expected
to persist beyond local disk. Use them freely for plans, specs, and session-to-session progress
notes, but don't commit them, don't rely on them existing in a fresh clone, and keep anything that
must outlive the work in tracked docs (`docs/`) or code.
