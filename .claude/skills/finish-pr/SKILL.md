---
name: finish-pr
description: >-
  Keep a PR in scope and its description free of dangling leftovers. Use when
  implementing an issue end to end, before opening a PR, when writing or
  editing a PR body, or when /simplify, /code-review or a subagent returns
  findings that need sorting. Triggers: "open the PR", "finish this issue",
  "write the PR description", "what do we do with these review findings".
---

# Finish a PR: stay in scope, leave no loose threads

A PR does what its issue and the recorded decisions say, and nothing else. Every finding
raised along the way ends in exactly one of three places — fixed in the PR, filed as an
issue, or dropped. It never ends as an open question in the PR body.

## 1. Scope

- Read the issue and its latest triage comment first; the recorded decisions are the spec.
  Don't re-litigate them.
- Don't add adjacent improvements, extra hardening, or new features "while here". A fix
  that isn't needed for the issue is a separate issue or nothing.
- Related rote items (same shape, tiny) may share one PR: one commit each, a `Closes #n`
  line each. Anything needing a decision gets its own PR.
- Migration and merge approvals stay governed by AGENTS.md. This skill changes neither.

## 2. Triage every finding

Applies to your own notes and to everything from /simplify, /code-review and subagents.
Put each finding in one bucket:

| Bucket | Test | Action |
| --- | --- | --- |
| **Fix now** | Inside the diff, correct, and cheap (a few lines) | Fix it, in the same PR |
| **Decision** | Real risk or a real design choice, outside the diff or needing the user | File an issue with the options and a recommendation; comment on an existing issue instead of filing a duplicate |
| **Noise** | Any test below | Drop it. Don't list it anywhere |

Noise tests — a finding is noise if it is:

- a race or edge on a rare, admin-only action with no data loss;
- micro-performance with a bounded cost;
- already true before the diff and untouched by it;
- a design nit that only matters to a hypothetical second consumer;
- a note about test-mock fidelity;
- a difference that is unreachable in practice (check reachability before reporting it).

Rote refactors that review turns up and that are real: file them as small issues, bundle
them later. Don't grow this PR.

## 3. The PR body

Follow `.github/pull_request_template.md`.

- **Summary**: what and why, by symbol name. If a refactor changes behavior anywhere, say
  so once here, with the fact that shows whether it is reachable. Don't repeat it elsewhere.
- **Test plan**: tick a box only for something actually run on this PR. Say "inferred"
  for anything inferred. Verify a new test by breaking the code it guards and watching it
  fail, then restoring.
- **Leftovers** (omit the section when empty): every line has a disposition —
  `fixed in <commit>`, `filed as #n`, or `accepted: <one-line reason the reviewer needs>`.
  No hedges ("optionally", "could", "would need"), no review noise, no questions to the
  reader. A line without a disposition is a bug in the description: fix it, file it, or
  delete it.
- **Related issues**: `Closes #n` only when fully resolved; otherwise a bare `#n`.

## 4. Before opening

1. Typecheck, lint, tests and build all pass (`npm run build` catches type and lint errors;
   don't spin up the dev server to check UI).
2. Run /simplify, then /code-review at high effort. Triage each finding by section 2.
3. Re-read the body against section 3. Every Leftovers line has a disposition; nothing in
   it is noise.
4. Open the PR only when the user has asked for one. Don't subscribe to PR activity or
   schedule check-ins unless asked, and don't poll CI.
