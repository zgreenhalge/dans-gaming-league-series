<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Local `*_handoff/` dirs are gitignored scratch

Directories matching `*_handoff/` (e.g. `dathost_handoff/`, `ehog_handoff/`) hold planning and
handoff material piped down from Claude online sessions to drive iterative implementation. They are
**gitignored and local-only** (`.gitignore`: `*handoff/`) — nothing in them is tracked or expected
to persist beyond local disk. Use them freely for plans, specs, and session-to-session progress
notes, but don't commit them, don't rely on them existing in a fresh clone, and keep anything that
must outlive the work in tracked docs (`docs/`) or code.
