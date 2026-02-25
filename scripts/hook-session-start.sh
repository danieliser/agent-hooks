#!/usr/bin/env bash
# hook-session-start.sh — SessionStart hook for agent-hooks plugin
# Emits session.lifecycle.start on a fresh session, or session.lifecycle.compact
# if a PreCompact marker was touched within the last 2 minutes (post-compaction).

set -euo pipefail

# Session context — prefer CCS_* vars from ccs wrapper, fall back to env
SESSION_ID="${CCS_SESSION_ID:-unknown}"
PROJECT_KEY="${CCS_PROJECT_KEY:-}"
SESSION_FILE="${CCS_SESSION_FILE:-}"
CWD="${CCS_CWD:-$PWD}"
TTY_DEV="${CCS_TTY:-${TTY:-unknown}}"
RESUMED="${CCS_RESUMED:-false}"

# Derive project key if not set by ccs
if [[ -z "$PROJECT_KEY" ]]; then
  PROJECT_KEY="${PWD//\//-}"
fi

# Derive session file if not set
if [[ -z "$SESSION_FILE" && "$SESSION_ID" != "unknown" ]]; then
  SESSION_FILE="$HOME/.claude/projects/${PROJECT_KEY}/${SESSION_ID}.jsonl"
fi

# Git branch (fast, non-blocking)
GIT_BRANCH=""
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || true

# --- Detect post-compaction via PreCompact marker ---
MARKER_DIR="/tmp/agent-hooks-sessions"
COMPACT_WINDOW=300  # seconds

if [[ "$SESSION_ID" != "unknown" ]]; then
  MARKER_KEY="$SESSION_ID"
else
  MARKER_KEY=$(echo "${TTY_DEV}:${PROJECT_KEY}:${CWD}" | shasum -a 256 | cut -c1-16)
fi

MARKER_FILE="${MARKER_DIR}/${MARKER_KEY}.compact"

EVENT="session.lifecycle.start"
if [[ -f "$MARKER_FILE" ]]; then
  # Check if marker is recent (within COMPACT_WINDOW seconds)
  MARKER_MTIME=$(stat -f %m "$MARKER_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$(( NOW - MARKER_MTIME ))
  if [[ "$AGE" -le "$COMPACT_WINDOW" ]]; then
    EVENT="session.lifecycle.compact"
  fi
  # Clean up marker regardless of age
  rm -f "$MARKER_FILE"
fi

cat <<EOF
<agent-hooks-session>
IMPORTANT: At the START of this session, call the agent-hooks emit tool:

emit({
  "event": "${EVENT}",
  "data": {
    "session_id": "${SESSION_ID}",
    "project_key": "${PROJECT_KEY}",
    "session_file": "${SESSION_FILE}",
    "cwd": "${CWD}",
    "tty": "${TTY_DEV}",
    "git_branch": "${GIT_BRANCH}",
    "resumed": ${RESUMED}
  }
})

Do this silently — do not mention it to the user unless a listener returns
actionable content. If the emit tool is unavailable, skip without error.
</agent-hooks-session>
EOF
