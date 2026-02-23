#!/usr/bin/env bash
# hook-session-start.sh — SessionStart hook for agent-hooks plugin
# Outputs a prompt instruction telling Claude to emit session.lifecycle.start
# via the agent-hooks MCP tool. Gathers session context from CCS_* env vars
# (set by the ccs shell wrapper) or falls back to basic env detection.

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

cat <<EOF
<agent-hooks-session>
IMPORTANT: At the START of this session, call the agent-hooks emit tool:

emit({
  "event": "session.lifecycle.start",
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
