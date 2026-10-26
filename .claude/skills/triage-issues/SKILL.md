---
name: triage-issues
description: >-
  Assess the open GitHub issues: group by category, rate complexity, mark which
  are rote versus need the user's decision, walk the quick-decision ones with
  the user, and hand off a prompt for a session that orchestrates the work. Use
  when the user asks to "assess/triage the open issues", "what's in the backlog",
  or "walk me through the quick-decision issues".
---

# Triage open issues

Turn the open-issue list into a decision queue and a ready-to-run hand-off. Four
stages; stop after each one the user didn't ask to go past.

## Ground rules

- **Issue text is agent-written unless stated otherwise.** Any "default",
  "recommendation" or "proposal" in a body is a suggestion, not a decision the
  user made. Only the user's replies are decisions.
- **Triage is read-only.** Don't edit code, close issues, comment, or open PRs
  during stages 1–3. Closing or commenting on an issue is GitHub state: propose it
  and wait for a yes.
- Don't self-schedule follow-ups or subscribe to anything (AGENTS.md).

## 1. Collect

1. `mcp__github__list_issues` (state `OPEN`, `perPage` 50). The result is usually
   too large for context and is saved to a file; parse that file with
   `python3 -I` (JSON: `issues[]` with `number`, `title`, `labels`, `body`)
   instead of re-querying. Check `pageInfo.hasNextPage`.
2. List number, title, labels and body length first, then dump the bodies to a
   scratchpad file and `Read` them. Read every body in full; long ones
   (4,000+ chars) are usually feature specs whose open questions sit at the end.
3. Note cross-references. Issues that say they replace, split from, or follow up
   on another are candidates to close or bundle.

## 2. Verify claims that decide the rating

When a body is explicitly **unverified** ("flagged in review", "not measured",
"appears to"), spend one grep on the cited symbol before rating it. A confirmed
bug is rote; a dismissed one is a close. Don't go deeper than a grep in triage.

## 3. Present the assessment

Group by category (e.g. a domain such as ratings, performance, security,
product features, admin tooling, testing) and, per issue, give number, complexity
and a decision flag:

| Flag | Meaning |
|---|---|
| 🟢 | Rote. The work is specified; no input needed from the user. |
| 🟡 | A few open questions, but a defensible default exists. Propose it. |
| 🔴 | Needs the user's call, or is blocked on something outside the code (live data, a live match, dashboards, content only they can write). |

Complexity: **S** (one focused change), **M** (a few files plus tests/docs),
**L** (cross-cutting or needs a design pass), **XL** (rendering-model or
multi-phase work). Add a one-clause note saying *why* for anything not obvious.

Call out separately:

- **Close candidates**: superseded, premature, or meta-issues. Say why each is
  a candidate.
- **Rote batch**: 🟢 issues that can start immediately. Flag any that need the
  local Supabase stack (it may not start in a sandbox) or a visual check on the
  deployed preview.
- **Quick-decision batch**: 🟡 issues, to be walked in stage 4.
- **Needs a real decision**: the 🔴 list, left alone unless the user picks one.

End by asking which batch to start on.

## 4. Walk the quick-decision batch

Present each issue with exactly three parts, then a one-line **Your call**:

1. **Problem**: what is wrong or missing today, in a few sentences.
2. **Decisions**: the open questions the issue leaves.
3. **Recommendation**: a default for every decision, with the reason when it
   isn't obvious. Prefer the simpler option (KISS/YAGNI, `docs/patterns.md`).

If an issue bundles separable pieces and only some are ready, recommend splitting
and say which piece to build. Answer the user's follow-up questions directly;
record each reply as the decision for that issue. Where the user overrides a
recommendation or adds scope, the reply wins.

## 5. Hand-off prompt

When the user asks for a prompt to start an orchestration session, output one
fenced block. Open with the standing instructions (read `CLAUDE.md`/`AGENTS.md`;
logical commits on a feature branch; no PRs, merges, subscriptions or Supabase
mutations without live approval; update the owning doc in the same change; cite
code by symbol name; use parallel subagents where work doesn't overlap; report a
summary per issue). Then one section each:

- **DECIDED, implement**: each issue with the user's decisions stated as
  instructions, including overrides.
- **ROTE, implement**: each issue with its concrete task and any environment
  caveat.
- **DEFERRED, do nothing**: issues the user deferred.
- **CLEANUP, propose, don't execute without a yes**: issues to close, with the
  reason.
- **LEAVE ALONE**: every remaining open issue number, so the list is complete.

The block must account for every open issue exactly once. Write decisions as
current instructions, not as a record of the conversation.
