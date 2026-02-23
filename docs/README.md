# agent-hooks

Event-driven extensibility for Claude Code plugins. Fire named events, registered listeners respond.

## Quick Start

1. **Install**: Add to your Claude Code plugin config or clone into `claude-plugins/agent-hooks`

2. **Configure**: Create `.claude/agent-hooks.yml` in your project:

```yaml
events:
  strategize.spec.drafted:
    - name: slack-notifier
      type: shell
      command: ./scripts/notify-slack.sh
      priority: 20
```

3. **Emit events** from any plugin:

```
emit(event: "strategize.spec.drafted", data: { spec_path: "docs/spec.md" })
```

4. **Validate config**:

```bash
node dist/index.js --validate
```

## How It Works

- Single MCP tool: `emit` dispatches events to registered listeners
- `has_listeners` tool: check if listeners exist before emitting
- Three listener types: `shell`, `template`, `mcp`
- Priority ordering (lower = first, default 10)
- Error isolation: one listener failure never blocks others
- Zero coupling: `emit` is optional — nothing breaks if agent-hooks isn't installed

## Tools

### `emit`

Fire an event. Returns listener results and any MCP call instructions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event` | string | yes | Event name (dot-notation snake_case) |
| `data` | object | no | Event payload (max 10KB) |
| `timeout` | integer | no | Max wait time in ms (default 5000) |

### `has_listeners`

Check if listeners are registered for an event.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event` | string | yes | Event name to query |

## Configuration

See [CONFIGURATION.md](CONFIGURATION.md) for full config reference.

## Building

```bash
npm install
npm run build    # TypeScript → dist/
npm test         # Run test suite
```
