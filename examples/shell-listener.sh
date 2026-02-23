#!/usr/bin/env bash
# Example shell listener for agent-hooks
#
# Shell listeners receive the full emit payload as JSON on stdin and should
# return a JSON response on stdout. Non-zero exit codes are reported as errors.
#
# Available environment variables:
#   AGENT_HOOKS_EVENT          — event name (e.g., "my_plugin.task.completed")
#   AGENT_HOOKS_INVOCATION_ID  — unique ID for this emit() call
#   Any vars from the listener's `env:` config or `global_env:` config
#
# Register in .claude/agent-hooks.yml:
#   events:
#     my_plugin.task.completed:
#       - name: example-shell
#         type: shell
#         command: ./scripts/on-complete.sh
#         priority: 10

set -euo pipefail

# Read the full event payload from stdin
PAYLOAD=$(cat)

# Parse fields with jq (if available)
if command -v jq &>/dev/null; then
  EVENT=$(echo "$PAYLOAD" | jq -r '.event')
  # Access nested data: .data.field_name
  # MESSAGE=$(echo "$PAYLOAD" | jq -r '.data.message // "no message"')
else
  EVENT="$AGENT_HOOKS_EVENT"
fi

# --- Your logic here ---
# Examples:
#   curl -s -X POST "$SLACK_WEBHOOK" -d "{\"text\": \"Event: $EVENT\"}"
#   echo "$PAYLOAD" >> /tmp/event-log.jsonl
#   notify-send "Agent Event" "$EVENT"

# Return JSON response (optional — empty stdout is valid)
echo "{\"status\": \"ok\", \"event\": \"$EVENT\"}"
