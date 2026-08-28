#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Bootstraps this repo for an agent session with no `.env.local`: installs npm dependencies, then
# brings up the throwaway local Supabase stack documented in docs/e2e.md (`supabase start`, Docker
# required — starting the daemon itself if it isn't already running) and exports its fixed
# connection values (`supabase/local.env`) so `npm run dev`/`npm run build`/`npm test` get a real
# schema-accurate database instead of `src/lib/dev-fallback-supabase.ts`'s in-memory fixture data.
# Every step is independent and best-effort: a failure anywhere (no Docker, no network access to
# pull images, a real `.env.local` already present) is logged and the hook falls back rather than
# blocking the session — worst case, `npm run build`/`npm run dev` still work against fixture data.
#
# All output goes to both stdout (visible in the session start log) and $STATUS_LOG, so a failure
# here is diagnosable without re-running anything by hand.

set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# `supabase start` pulls ~7 images on a cold cache. A sandbox whose network policy blocks the
# registry doesn't fail fast — the CLI retries each image with growing backoff for a long time — so
# this cap keeps a blocked sandbox from stalling the (synchronous) session start for minutes. Bump it
# if your environment's registry access is just slow rather than blocked.
DB_START_TIMEOUT_SECONDS="${DB_START_TIMEOUT_SECONDS:-120}"

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$REPO_DIR" || exit 0

STATUS_LOG="$REPO_DIR/.claude/session-start.log"
mkdir -p "$(dirname "$STATUS_LOG")"
: > "$STATUS_LOG"

log() {
  echo "[session-start] $*" | tee -a "$STATUS_LOG"
}

# --- 1. Install npm dependencies -------------------------------------------------------------

install_deps() {
  log "Installing npm dependencies..."
  if npm install >>"$STATUS_LOG" 2>&1; then
    log "npm install: done"
    return 0
  fi
  log "npm install: FAILED — see $STATUS_LOG for output"
  return 1
}

# --- 2. Skip entirely if a real .env.local is already configured -----------------------------

has_real_env_local() {
  [ -f "$REPO_DIR/.env.local" ] && grep -q '^NEXT_PUBLIC_SUPABASE_URL=' "$REPO_DIR/.env.local"
}

# --- 3. Confirm Docker is actually usable, starting the daemon ourselves if it's just idle -----

# `docker info` failing only means no daemon has been started yet in this container — dockerd
# itself is present and startable (confirmed: it comes up in ~5-10s given root, which sandbox
# containers run as). There's no init system here to have started it automatically, so start it
# ourselves rather than treating "not running" as "not available". This doesn't help a sandbox
# whose network policy blocks the image registry (a separate failure `start_local_supabase`'s own
# timeout already handles) — it only removes the "nobody ever ran dockerd" case.
start_dockerd() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if ! command -v dockerd >/dev/null 2>&1; then
    log "dockerd binary not found — cannot start the Docker daemon."
    return 1
  fi
  if [ "$(id -u)" -ne 0 ]; then
    log "not running as root — cannot start the Docker daemon ourselves."
    return 1
  fi
  log "docker daemon not running — starting dockerd..."
  nohup dockerd >>"$STATUS_LOG" 2>&1 &
  local waited=0
  while [ "$waited" -lt 30 ]; do
    if docker info >/dev/null 2>&1; then
      log "dockerd started."
      return 0
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
  log "dockerd didn't come up within 15s — giving up on it."
  pkill dockerd >/dev/null 2>&1 || true
  return 1
}

docker_available() {
  if ! command -v docker >/dev/null 2>&1; then
    log "docker CLI not found — skipping local Supabase bootstrap."
    return 1
  fi
  if ! start_dockerd; then
    log "docker daemon not reachable — skipping local Supabase bootstrap."
    return 1
  fi
  return 0
}

# --- 4. Start the local Supabase stack (supabase/config.toml + migrations + seed.sql) --------

start_local_supabase() {
  log "Starting local Supabase stack (npm run db:start — this pulls Postgres/PostgREST/Realtime images on first run, capped at ${DB_START_TIMEOUT_SECONDS}s)..."
  if timeout "$DB_START_TIMEOUT_SECONDS" npm run db:start >>"$STATUS_LOG" 2>&1; then
    log "local Supabase stack: up"
    return 0
  fi
  log "local Supabase stack: FAILED to start within ${DB_START_TIMEOUT_SECONDS}s (this sandbox's network policy may block Docker registry pulls — see $STATUS_LOG for the actual CLI output)"
  # The timeout above kills the CLI process, not any containers it already started (those run
  # detached from it) — clean those up so a later manual `supabase start` doesn't find a half-up
  # stack from this attempt.
  npx --yes supabase stop --no-backup >>"$STATUS_LOG" 2>&1 || true
  return 1
}

# --- 5. Export the stack's fixed connection values for the rest of the session ----------------

export_local_env() {
  local env_file="$REPO_DIR/supabase/local.env"
  if [ ! -f "$env_file" ]; then
    log "supabase/local.env not found — cannot export connection env vars."
    return 1
  fi
  if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
    log "\$CLAUDE_ENV_FILE not set — cannot persist env vars for this session."
    return 1
  fi
  while IFS= read -r line; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    echo "export $line" >> "$CLAUDE_ENV_FILE"
  done < "$env_file"
  log "Exported NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from supabase/local.env."
  return 0
}

# --- Run ---------------------------------------------------------------------------------------

NO_LOCAL_STACK_MSG="No local Supabase stack this session — npm run build/dev/test will use src/lib/dev-fallback-supabase.ts's in-memory fixture data instead. Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY manually (see README.md's Environment Variables table) for a real connection."

install_deps

if has_real_env_local; then
  log "Existing .env.local already sets NEXT_PUBLIC_SUPABASE_URL — leaving it alone, skipping local Supabase bootstrap."
  exit 0
fi

if ! docker_available; then
  log "$NO_LOCAL_STACK_MSG"
  exit 0
fi

if ! start_local_supabase; then
  log "$NO_LOCAL_STACK_MSG"
  exit 0
fi

if export_local_env; then
  log "Ready — npm run dev / npm run build / npm test can now reach the local Supabase stack."
else
  log "Local Supabase stack is up but env vars weren't exported — set NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 and the keys in supabase/local.env manually."
fi

exit 0
