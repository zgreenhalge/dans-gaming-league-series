---
name: triage-issues
description: >-
  Assess GitHub issues: group by category, rate complexity, mark which are rote
  versus need the user's decision, and walk the quick-decision ones with them.
  Takes an optional selection (a number range, an author, labels). Can also
  produce a hand-off prompt for an orchestration session when asked. Use when
  the user asks to "assess/triage the open issues", "what's in the backlog",
  "triage issues 405-417 / above 700 / opened by X", or "walk me through the
  quick-decision issues".
---

# Triage issues

Turn a set of issues into a decision queue. `scripts/issue-digest.ts` does the
mechanical part (fetch, filter, cross-references, body signals); the agent does
the judgment (category, complexity, rote vs decision, recommendations).

## Parameters

Read these off the user's request; default to every open issue.

| Parameter | Examples | Script flag |
|---|---|---|
| Number selection | "above 700" → `701-`; "405-417"; "34 and 448"; "up to 50" → `-50` | `--range "701-"`, `"405-417"`, `"34,448"`, `"-50"` (comma-separate to combine) |
| Author | "opened by zgreenhalge" | `--author <login>` |
| Labels | "the enhancement ones" | `--label <name>` (repeatable; all must match) |
| State | "including closed" | `--state open\|closed\|all` (default `open`) |

"Above N" is exclusive, so pass `N+1-`. Say back the selection you resolved
(`issues ≥ 701 by zgreenhalge, open`) and how many it matched before assessing.
The hand-off prompt is **not** a parameter of the run: offer it at the end,
produce it only when asked (stage 5).

## Ground rules

- **Issue text is agent-written unless stated otherwise.** Any "default",
  "recommendation" or "proposal" in a body is a suggestion, not a decision the
  user made. Only the user's replies are decisions.
- **Triage is read-only.** Don't edit code, close issues, comment, or open PRs
  during stages 1–4. Closing or commenting on an issue is GitHub state: propose it
  and wait for a yes.
- Don't self-schedule follow-ups or subscribe to anything (AGENTS.md).

## 1. Collect (script)

```bash
# scan: one table row per issue, with signals
NODE_USE_ENV_PROXY=1 npx tsx scripts/issue-digest.ts --range "701-"

# read: full records including bodies, for the agent to read
NODE_USE_ENV_PROXY=1 npx tsx scripts/issue-digest.ts --range "701-" --format json --out <scratchpad>/issues.json
```

Run the table first to size the set, then the JSON form to read bodies (`Read`
the file; bodies default to 20,000 chars, set `--max-body` to cut). `--repo`
defaults to the `origin` remote; the script reads `$GH_TOKEN` / `$GITHUB_TOKEN`
and falls back to unauthenticated requests (rate-limited on shared IPs).
`NODE_USE_ENV_PROXY=1` is needed behind an HTTP proxy and is harmless elsewhere.

If the script can't reach GitHub (auth or network), fall back to
`mcp__github__list_issues` (state `OPEN`, `perPage` 50); an oversized result is
saved to a file, which you parse with `python3 -I`. Never print or probe
credentials while debugging.

Read every selected body in full; long ones (4,000+ chars) are usually feature
specs whose open questions sit at the end.

## 2. Read the signals, then verify

The digest's signals are pattern matches over the body, so treat them as hints:

| Signal | Hint |
|---|---|
| `Done-when` checklist | The work is specified; leans 🟢 |
| `Open Qs` > 0 | Choices are left open; leans 🟡/🔴 |
| `Unverified` | Claim not confirmed; verify before rating |
| `Blocker` | Gated on something outside the code; leans 🔴 |
| `Supersedes` / `Refs` | Candidate to close, bundle, or order after another issue |

Always confirm against the body: a high `Open Qs` count can be a spec that
resolves its own questions, and a quiet row can hide a design decision. For an
**unverified** claim, spend one grep on the cited symbol before rating it. A
confirmed bug is rote; a dismissed one is a close. Go no deeper than a grep.

## 3. Present the assessment

Group by category (a domain such as ratings, performance, security, product
features, admin tooling, testing) and, per issue, give number, complexity and a
decision flag:

| Flag | Meaning |
|---|---|
| 🟢 | Rote. The work is specified; no input needed from the user. |
| 🟡 | A few open questions, but a defensible default exists. Propose it. |
| 🔴 | Needs the user's call, or is blocked on something outside the code (live data, a live match, dashboards, content only they can write). |

Complexity: **S** (one focused change), **M** (a few files plus tests/docs),
**L** (cross-cutting or needs a design pass), **XL** (rendering-model or
multi-phase work). Add a one-clause note saying *why* for anything not obvious.

Call out separately:

- **Close candidates**: superseded, premature, or meta-issues, each with why.
- **Rote batch**: 🟢 issues that can start immediately. Flag any that need the
  local Supabase stack (it may not start in a sandbox) or a visual check on the
  deployed preview.
- **Quick-decision batch**: 🟡 issues, to be walked in stage 4.
- **Needs a real decision**: the 🔴 list, left alone unless the user picks one.

End by asking which batch to start on, and mention that a hand-off prompt for an
orchestration session is available on request.

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

## 5. Hand-off prompt (on request only)

Produce this only when the user asks for it. Output one fenced block. Open with
the standing instructions (read `CLAUDE.md`/`AGENTS.md`; logical commits on a
feature branch; no PRs, merges, subscriptions or Supabase mutations without live
approval; update the owning doc in the same change; cite code by symbol name; use
parallel subagents where work doesn't overlap; report a summary per issue). Then
one section each:

- **DECIDED, implement**: each issue with the user's decisions stated as
  instructions, including overrides.
- **ROTE, implement**: each issue with its concrete task and any environment
  caveat.
- **DEFERRED, do nothing**: issues the user deferred.
- **CLEANUP, propose, don't execute without a yes**: issues to close, with the
  reason.
- **LEAVE ALONE**: every remaining selected issue number, so the list is complete.

The block must account for every issue in the selection exactly once. Write
decisions as current instructions, not as a record of the conversation.

## Extending the script

`scripts/issue-digest-shared.ts` holds the pure logic (range parsing, title
parsing, signal patterns) and is tested in `src/lib/issue-digest.test.ts`. Add a
signal by extending `bodySignals()` and its test; keep signals as facts read off
the text, and leave verdicts (category, complexity, flag) to the agent.
