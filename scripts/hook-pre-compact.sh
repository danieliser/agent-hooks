#!/usr/bin/env bash
# hook-pre-compact.sh — PreCompact hook for agent-hooks plugin
# Touches a marker file so the SessionStart hook (which fires immediately
# after compaction) can detect it's post-compaction, not a fresh session.

set -euo pipefail

SESSION_ID="${CCS_SESSION_ID:-unknown}"
PROJECT_KEY="${CCS_PROJECT_KEY:-}"
CWD="${CCS_CWD:-$PWD}"
TTY_DEV="${CCS_TTY:-${TTY:-unknown}}"

if [[ -z "$PROJECT_KEY" ]]; then
  PROJECT_KEY="${PWD//\//-}"
fi

MARKER_DIR="/tmp/agent-hooks-sessions"
mkdir -p "$MARKER_DIR"

if [[ "$SESSION_ID" != "unknown" ]]; then
  MARKER_KEY="$SESSION_ID"
else
  MARKER_KEY=$(echo "${TTY_DEV}:${PROJECT_KEY}:${CWD}" | shasum -a 256 | cut -c1-16)
fi

# Touch the marker — SessionStart checks recency to detect post-compaction
touch "${MARKER_DIR}/${MARKER_KEY}.compact"
