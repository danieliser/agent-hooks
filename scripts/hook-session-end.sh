#!/usr/bin/env bash
# hook-session-end.sh — Stop hook for agent-hooks plugin
# Outputs a prompt instruction telling Claude to emit session.lifecycle.end
# via the agent-hooks MCP tool. Reads session context from CCS_* env vars
# and computes duration from the session log if available.

set -euo pipefail

# Read hook input from stdin (Claude Code passes JSON with transcript_path etc.)
HOOK_INPUT="$(cat)"

# Session context from ccs wrapper
SESSION_ID="${CCS_SESSION_ID:-unknown}"
PROJECT_KEY="${CCS_PROJECT_KEY:-}"
SESSION_FILE="${CCS_SESSION_FILE:-}"
CWD="${CCS_CWD:-$PWD}"
TTY_DEV="${CCS_TTY:-${TTY:-unknown}}"
RESUMED="${CCS_RESUMED:-false}"

# Derive if not set by ccs
if [[ -z "$PROJECT_KEY" ]]; then
  PROJECT_KEY="${PWD//\//-}"
fi
if [[ -z "$SESSION_FILE" && "$SESSION_ID" != "unknown" ]]; then
  SESSION_FILE="$HOME/.claude/projects/${PROJECT_KEY}/${SESSION_ID}.jsonl"
fi

# Git branch
GIT_BRANCH=""
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || true


# Estimate duration from session file timestamps if available
DURATION=0
if [[ -f "$SESSION_FILE" ]]; then
  # First and last line timestamps could give us duration, but parsing
  # JSONL is expensive. Use file mtime vs ctime as rough estimate.
  CREATED=$(stat -f %B "$SESSION_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  if [[ "$CREATED" -gt 0 ]]; then
    DURATION=$(( NOW - CREATED ))
  fi
fi

# Use CCS_DURATION if available (more accurate, set by ccs wrapper post-exit)
# Note: this env var is set AFTER claude exits, so it won't be available here.
# The duration estimate above is the best we can do from inside the Stop hook.

cat <<EOF
<agent-hooks-session>
IMPORTANT: Before this session ends, call the agent-hooks emit tool:

emit({
  "event": "session.lifecycle.end",
  "data": {
    "session_id": "${SESSION_ID}",
    "project_key": "${PROJECT_KEY}",
    "session_file": "${SESSION_FILE}",
    "cwd": "${CWD}",
    "tty": "${TTY_DEV}",
    "git_branch": "${GIT_BRANCH}",
    "duration": ${DURATION},
    "resumed": ${RESUMED}
  }
})

Do this silently — do not mention it to the user unless a listener returns
actionable content. If the emit tool is unavailable, skip without error.
</agent-hooks-session>
EOF
