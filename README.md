# agent-hooks

[![npm version](https://img.shields.io/npm/v/@danieliser/agent-hooks)](https://www.npmjs.com/package/@danieliser/agent-hooks)
[![CI](https://github.com/danieliser/agent-hooks/actions/workflows/test.yml/badge.svg)](https://github.com/danieliser/agent-hooks/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/node/v/@danieliser/agent-hooks)](https://nodejs.org)

WordPress-style event system for Claude Code plugins. Fire named events, registered listeners respond with shell output, template content, or MCP tool call instructions.

## Why agent-hooks?

- **Decoupling** — Plugins don't need to know about each other. Emit events; whoever's listening handles the rest.
- **Priority ordering** — Listeners run in priority order (lower = first). Control execution sequence without tight coupling.
- **Error isolation** — One listener's failure never blocks others. Your workflows stay resilient.
- **Zero coupling** — If nothing listens, nothing happens. No overhead, no errors, no dependencies.

## Quick Start

### 1. Install the plugin

```bash
# From npm
npm install @danieliser/agent-hooks

# Or add to your Claude Code plugin marketplace
```

### 2. Initialize config

```bash
npx agent-hooks init
```

This creates:
- `.claude/agent-hooks.yml` — starter config with commented examples
- `scripts/on-event.sh` — example shell listener

### 3. Auto-approve permissions

Every `emit()` call requires user approval unless you allow it. Add to `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_agent-hooks_agent-hooks__*"
    ]
  }
}
```

Or granular:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_agent-hooks_agent-hooks__emit",
      "mcp__plugin_agent-hooks_agent-hooks__has_listeners"
    ]
  }
}
```

### 4. Configure a listener

Edit `.claude/agent-hooks.yml`:

```yaml
events:
  session.lifecycle.start:
    - name: project-context
      type: template
      path: .claude/templates/context.md
      priority: 5
```

### 5. Emit events

From any Claude Code plugin or agent:

```
emit(event: "session.lifecycle.start", data: { git_branch: "main" })
```

## How It Works

```
Agent → emit("domain.entity.action", data)
         ↓
       MCP Server (agent-hooks)
         ↓
       Config lookup → matched listeners (sorted by priority)
         ↓
       Execute each: shell | template | mcp
         ↓
       Return merged results to agent
```

1. An agent calls `emit()` with an event name and optional data payload
2. agent-hooks finds all listeners registered for that event (including wildcards)
3. Listeners execute in priority order (lower number = first)
4. Results are merged and returned to the calling agent

## API Reference

### `emit`

Fire a named event. Returns listener results and any MCP call instructions.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `event` | string | yes | — | Event name in dot-notation snake_case |
| `data` | object | no | `{}` | Event payload (max 10KB) |
| `timeout` | integer | no | `5000` | Max wait time in ms |
| `mode` | string | no | `"sync"` | `"sync"` waits for results; `"async"` fire-and-forget |

**Sync response:**
```json
{
  "event": "my.event",
  "invocation_id": "evt-abc123",
  "listeners_executed": 2,
  "responses": [
    { "name": "listener-a", "status": "success", "result": { ... } },
    { "name": "listener-b", "status": "success", "result": { ... } }
  ],
  "errors": [],
  "duration_ms": 45
}
```

**Async response:**
```json
{
  "event": "my.event",
  "invocation_id": "evt-abc123",
  "mode": "async",
  "listeners_enqueued": 2,
  "status": "enqueued"
}
```

### `has_listeners`

Check if listeners are registered for an event. Fast, no side effects.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event` | string | yes | Event name to query (no wildcards) |

**Response:**
```json
{
  "event": "my.event",
  "has_listeners": true,
  "listener_count": 2,
  "priorities": [5, 10]
}
```

## Configuration

Config files are YAML. Both are optional:

- **Project**: `.claude/agent-hooks.yml` — project-specific listeners
- **Global**: `~/.claude/agent-hooks.yml` — applies to all projects

When both exist, they deep-merge. Same-name listeners: project wins. Different names: both fire.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full schema reference.

### Listener Types

**Shell** — Runs a subprocess. JSON on stdin, JSON on stdout.

```yaml
- name: slack-notifier
  type: shell
  command: ./scripts/notify-slack.sh
  priority: 20
```

**Template** — Loads markdown, applies `${data.X}` / `${env.Y}` substitution.

```yaml
- name: project-context
  type: template
  path: .claude/templates/context.md
  priority: 5
```

**MCP** — Returns tool call instructions for the agent to execute.

```yaml
- name: create-adr
  type: mcp
  server: my-server
  tool: create_record
  priority: 10
  args_mapping:
    title: "${data.spec_name}"
```

### Event Naming

Dot-notation snake_case: `domain.entity.action`

- `strategize.spec.drafted`
- `session.lifecycle.start`
- `execute.batch.completed`

Wildcard listeners: `strategize.*` matches any `strategize.X.Y` event.

## Permissions

agent-hooks tools require explicit permission in Claude Code. Without this, every `emit()` call will prompt for user approval.

**Recommended** — wildcard allow (covers both tools):

```json
"mcp__plugin_agent-hooks_agent-hooks__*"
```

Add this to `.claude/settings.local.json` under `permissions.allow`. See the [Quick Start](#3-auto-approve-permissions) for the full config block.

## CLI

```bash
npx agent-hooks init       # Scaffold config + example listener
npx agent-hooks validate   # Validate config, report errors with line numbers
npx agent-hooks help       # Show usage
```

## Examples

See the [`examples/`](examples/) directory for ready-to-use listeners:

- [`shell-listener.sh`](examples/shell-listener.sh) — Shell script with stdin/stdout JSON
- [`template-listener.md`](examples/template-listener.md) — Markdown template with substitution
- [`mcp-listener.yml`](examples/mcp-listener.yml) — MCP listener config snippet
- [`starter-config.yml`](examples/starter-config.yml) — Full annotated config file

## Security

**This tool executes user-defined shell commands.** Only register listeners you trust.

Mitigations:
- Payload size limit: 10KB max per emit
- Template size limit: 100KB max per file
- Listener timeout: configurable, default 5s, SIGTERM then SIGKILL
- Error isolation: failures don't cascade
- YAML safe loading: no object deserialization
- Shell commands use `execFile` (no shell injection via command string)

See [SECURITY.md](SECURITY.md) for the full risk model and responsible disclosure.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR process.

## License

[MIT](LICENSE) &copy; [Daniel Iser](https://github.com/danieliser)
