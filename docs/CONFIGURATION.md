# Agent-Hooks Configuration

## Config File Locations

Agent-hooks uses a cascading YAML config:

- **Global**: `~/.claude/agent-hooks.yml` — applies to all projects
- **Project**: `.claude/agent-hooks.yml` — project-specific overrides

Both are optional. If neither exists, agent-hooks starts with no listeners.

**Important**: Configuration is loaded once when the agent-hooks MCP server starts. Modifications to `agent-hooks.yml` files take effect only after the server restarts.

## Config Schema

```yaml
version: "1.0"
default_timeout: 5000       # Default timeout (ms) for all emit() calls
enabled: true                # Enable/disable the plugin without removing config

events:
  domain.entity.action:      # Event name (dot-notation snake_case)
    - name: my-listener      # Optional — auto-generated if omitted
      type: shell             # shell | template | mcp
      command: ./scripts/handle.sh
      priority: 10            # Lower = runs first (0-100, default 10)
      timeout: 3000           # Per-listener timeout override
      description: "What this listener does"
      env:                    # Extra env vars for this listener
        MY_VAR: "value"

errors:
  isolate_failures: true      # One failure doesn't block others (default: true)
  include_in_response: true   # Include errors in emit() response (default: true)

global_env:                   # Env vars available to all shell listeners
  PROJECT_NAME: "my-project"
```

## Listener Types

### Shell

Executes a command via subprocess. Receives event data as JSON on stdin, returns JSON on stdout.

```yaml
- name: slack-notifier
  type: shell
  command: ./scripts/notify-slack.sh
  priority: 20
  timeout: 2000
  env:
    SLACK_CHANNEL: "#architecture"
```

**Path rules**:
- Project config: relative paths resolve from project root
- Global config: paths **must** be absolute or use `~` expansion

### Template

Loads a markdown file and returns its content. Supports `${data.X}` and `${env.Y}` substitution.

```yaml
- name: style-guide-injector
  type: template
  path: .claude/templates/style-guide.md
  priority: 5
```

Template files must be under 100KB.

### MCP

Generates instructions for the agent to call tools on other MCP servers. Agent-hooks does **not** execute the calls — it returns a `mcp_calls` instruction array.

```yaml
- name: ddd-adr-creator
  type: mcp
  server: ddd-tool
  tool: add_decision_record
  priority: 10
  args_mapping:
    title: "${data.spec_name} Decision Record"
    context: "${data.spec_path}"
```

## Config Merge (Name-Based Dedup)

When both global and project configs exist, they deep-merge:

1. **Same `name`**: project version overwrites global
2. **Different `name`**: both fire
3. **Auto-generated names**: `shell-{basename}`, `template-{basename}`, `{server}/{tool}`
4. After merge, listeners sort by priority (ascending)

**Example**:

Global (`~/.claude/agent-hooks.yml`):
```yaml
events:
  strategize.spec.drafted:
    - name: event-logger
      type: shell
      command: ~/scripts/log-all-events.sh
      priority: 100
    - name: ddd-adr-creator
      type: mcp
      server: ddd-tool
      tool: add_decision
      priority: 10
```

Project (`.claude/agent-hooks.yml`):
```yaml
events:
  strategize.spec.drafted:
    - name: ddd-adr-creator       # Same name → overwrites global
      type: mcp
      server: ddd-tool
      tool: add_decision
      priority: 15
    - name: slack-notifier         # New name → appends
      type: shell
      command: ./notify.sh
      priority: 20
```

**Merged result** (3 listeners, sorted by priority):
1. `ddd-adr-creator` (priority 15, project version)
2. `slack-notifier` (priority 20, from project)
3. `event-logger` (priority 100, from global)

## Event Naming

Use dot-notation snake_case: `domain.entity.action`

- `strategize.spec.drafted`
- `panel.review.completed`
- `execute.batch.started`

Wildcard listeners: `strategize.*` matches any `strategize.X.Y` event.

## Validation

Validate config without starting the server:

```bash
node dist/index.js --validate
```

Reports errors with file paths and line numbers. Exits 0 (valid) or 1 (errors).
