# Security

## Risk Model

agent-hooks executes **user-defined shell commands** as part of its shell listener functionality. This is by design — it's a hook system that runs your scripts in response to events. The security boundary is config-level: only commands you register in your YAML config will run.

## Threat Surface

| Vector | Risk | Mitigation |
|--------|------|------------|
| Shell command execution | Arbitrary code runs as your user | Only commands from your YAML config execute; `execFile` used (no shell expansion) |
| YAML config injection | Malicious config could register dangerous commands | Config is a local file under your control; YAML safe loader prevents deserialization attacks |
| Payload size abuse | Large payloads could cause memory issues | 10KB max payload enforced per emit |
| Template size abuse | Large templates could consume memory | 100KB max template size enforced |
| Listener timeout abuse | Listeners could hang indefinitely | Configurable timeout (default 5s); SIGTERM then SIGKILL after 500ms grace |
| Cascading failures | One listener failure breaks all | Error isolation: each listener runs independently |
| Log file growth | Emit logs could fill disk | 10MB rotation with 5 rotated files kept |

## What agent-hooks Does NOT Do

- Does not execute commands from event payloads (only from static config)
- Does not eval or interpret arbitrary code
- Does not make network requests (shell listeners can, but that's your code)
- Does not access files outside your configured paths
- Does not modify your Claude Code settings or permissions

## Best Practices

1. **Only register trusted scripts** — Review any shell listener command before adding it to config
2. **Use absolute paths** in global config — Relative paths in global config could resolve unexpectedly
3. **Set tight timeouts** — Don't leave the default 5s if your listener should finish in 100ms
4. **Review permissions** — The `mcp__plugin_agent-hooks_agent-hooks__*` wildcard approves all agent-hooks tools; use granular permissions if you prefer explicit control
5. **Check emit logs** — Review `~/.claude/agent-hooks/emit.log` periodically for unexpected events

## Responsible Disclosure

If you discover a security vulnerability, please report it privately:

- Email: daniel@code-atlantic.com
- Subject: `[SECURITY] agent-hooks: <brief description>`

Please do not open a public GitHub issue for security vulnerabilities. I aim to respond within 48 hours and issue a fix within 7 days for confirmed vulnerabilities.
