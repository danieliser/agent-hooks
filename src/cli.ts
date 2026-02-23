#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { loadAndMergeConfig } from "./config/loader.js";
import { validateConfig } from "./config/validator.js";
import { testEmit, formatTestOutput } from "./commands/test.js";

const STARTER_CONFIG = `# agent-hooks configuration
# Docs: https://github.com/danieliser/agent-hooks/blob/main/docs/CONFIGURATION.md
version: "1.0"
enabled: true

events:
  # Example: shell listener — runs a script when an event fires
  # my_plugin.task.completed:
  #   - name: notify-on-complete
  #     type: shell
  #     command: ./scripts/on-complete.sh
  #     priority: 10
  #     timeout: 3000

  # Example: template listener — injects markdown into agent context
  # session.lifecycle.start:
  #   - name: project-context
  #     type: template
  #     path: .claude/templates/project-context.md
  #     priority: 5

  # Example: MCP listener — returns tool call instructions for the agent
  # strategize.spec.drafted:
  #   - name: create-adr
  #     type: mcp
  #     server: my-mcp-server
  #     tool: create_record
  #     priority: 10
  #     args_mapping:
  #       title: "\${data.spec_name}"
`;

const EXAMPLE_SHELL_LISTENER = `#!/usr/bin/env bash
# Example shell listener for agent-hooks
# Receives event data as JSON on stdin, returns JSON on stdout.
#
# Available env vars:
#   AGENT_HOOKS_EVENT          — the event name that fired
#   AGENT_HOOKS_INVOCATION_ID  — unique ID for this emit() call

set -euo pipefail

# Read event payload from stdin
PAYLOAD=$(cat)

# Extract fields (requires jq)
# EVENT_NAME=$(echo "$PAYLOAD" | jq -r '.event')
# SPEC_PATH=$(echo "$PAYLOAD" | jq -r '.data.spec_path // empty')

# Your logic here...

# Return JSON response (optional — empty stdout is fine)
echo '{"status": "ok", "message": "Listener executed successfully"}'
`;

function printUsage(): void {
  process.stdout.write(`agent-hooks — Event system for Claude Code plugins

Usage:
  agent-hooks init       Scaffold .claude/agent-hooks.yml and example listener
  agent-hooks validate   Validate config files and report errors
  agent-hooks test       Dry-run event simulation (no execution)
  agent-hooks help       Show this help message

Flags:
  --data '{}'            Event data for test command (JSON)

When run without arguments, starts the MCP server (stdio transport).

Docs: https://github.com/danieliser/agent-hooks
`);
}

function runInit(): void {
  const configDir = path.join(process.cwd(), ".claude");
  const configPath = path.join(configDir, "agent-hooks.yml");
  const scriptsDir = path.join(process.cwd(), "scripts");
  const listenerPath = path.join(scriptsDir, "on-event.sh");

  let created = 0;

  // Config file
  if (fs.existsSync(configPath)) {
    process.stdout.write(`  exists  ${path.relative(process.cwd(), configPath)}\n`);
  } else {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, STARTER_CONFIG, "utf-8");
    process.stdout.write(`  create  ${path.relative(process.cwd(), configPath)}\n`);
    created++;
  }

  // Example shell listener
  if (fs.existsSync(listenerPath)) {
    process.stdout.write(`  exists  ${path.relative(process.cwd(), listenerPath)}\n`);
  } else {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(listenerPath, EXAMPLE_SHELL_LISTENER, { encoding: "utf-8", mode: 0o755 });
    process.stdout.write(`  create  ${path.relative(process.cwd(), listenerPath)}\n`);
    created++;
  }

  if (created > 0) {
    process.stdout.write(`
Next steps:

  1. Edit .claude/agent-hooks.yml to register your event listeners
  2. Auto-approve agent-hooks tools (prevents permission prompts):

     Add to .claude/settings.local.json → "permissions" → "allow":

       "mcp__plugin_agent-hooks_agent-hooks__*"

     Or granular:

       "mcp__plugin_agent-hooks_agent-hooks__emit"
       "mcp__plugin_agent-hooks_agent-hooks__has_listeners"

  3. Validate your config:

       npx agent-hooks validate

  Docs: https://github.com/danieliser/agent-hooks
`);
  } else {
    process.stdout.write("\n  Nothing to create — config and listener already exist.\n");
  }
}

function runValidate(): void {
  const config = loadAndMergeConfig();
  const errors = validateConfig(config);

  if (errors.length === 0) {
    const eventCount = Object.keys(config.events ?? {}).length;
    const listenerCount = Object.values(config.events ?? {}).reduce(
      (sum, listeners) => sum + listeners.length,
      0
    );
    process.stdout.write(
      `agent-hooks config valid: ${eventCount} events, ${listenerCount} listeners\n`
    );
    process.exit(0);
  } else {
    process.stderr.write("agent-hooks config validation failed:\n");
    for (const err of errors) {
      const loc = err.line ? ` (line ${err.line})` : "";
      process.stderr.write(`  ${err.file}${loc}: ${err.message}\n`);
    }
    process.exit(1);
  }
}

const command = process.argv[2];

switch (command) {
  case "init":
    runInit();
    break;
  case "validate":
  case "--validate":
    runValidate();
    break;
  case "test": {
    const eventName = process.argv[3];
    if (!eventName) {
      process.stderr.write("Usage: agent-hooks test <event> [--data '{}']\n");
      process.exit(1);
    }
    const config = loadAndMergeConfig();
    const args = process.argv.slice(4);
    const dataIdx = args.indexOf("--data");
    let data: Record<string, unknown> = {};
    if (dataIdx !== -1 && args[dataIdx + 1]) {
      try {
        data = JSON.parse(args[dataIdx + 1]);
      } catch {
        process.stderr.write("Invalid JSON in --data\n");
        process.exit(1);
      }
    }
    const result = testEmit(eventName, data, config);
    process.stdout.write(formatTestOutput(result) + "\n");
    process.exit(result.success ? 0 : 1);
    break;
  }
  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;
  default:
    printUsage();
    process.exit(command ? 1 : 0);
}
