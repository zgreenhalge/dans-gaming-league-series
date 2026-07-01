<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Tools and scripts should be task-agnostic

When you build something reusable — anything in `scripts/`, a CLI, a shared helper — keep it general
and neutral. **Don't bake the current task into it.** No references to the issue/phase/spike you
happen to be working on, no assumptions about *why* it's being run, no comments narrating the
investigation in progress, no "throwaway"/"spike" framing that discourages reuse. Name it for what it
does (`inspect-demo`, not `parse-demo-parity`), document its inputs/outputs factually, and let the
caller interpret the results for their situation. A tool written for "verify X for feature Y" quietly
rots into a single-use script; the same tool written as "inspect X" stays reusable. Put the
task-specific interpretation in the conversation, the PR, or a doc — not in the tool.

# Local `*_handoff/` dirs are gitignored scratch

Directories matching `*_handoff/` (e.g. `dathost_handoff/`, `ehog_handoff/`) hold planning and
handoff material piped down from Claude online sessions to drive iterative implementation. They are
**gitignored and local-only** (`.gitignore`: `*handoff/`) — nothing in them is tracked or expected
to persist beyond local disk. Use them freely for plans, specs, and session-to-session progress
notes, but don't commit them, don't rely on them existing in a fresh clone, and keep anything that
must outlive the work in tracked docs (`docs/`) or code.
