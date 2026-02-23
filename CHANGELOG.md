# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-02-22

### Added

- `emit` MCP tool — fire named events to registered listeners with sync and async modes
- `has_listeners` MCP tool — query whether listeners exist for an event
- Three listener types: shell (subprocess), template (markdown injection), MCP (tool call instructions)
- YAML config cascade — global (`~/.claude/agent-hooks.yml`) + project (`.claude/agent-hooks.yml`)
- Name-based dedup on config merge (project overrides global by listener name)
- Priority ordering (lower = first, 0-100, default 10)
- Error isolation — one listener failure never blocks others
- Payload size enforcement (10KB max)
- Template size enforcement (100KB max)
- Config validation with line-number precision
- Wildcard event matching (`domain.*` matches `domain.entity.action`)
- Async emit mode — fire-and-forget with invocation ID
- JSON-lines emit logging with 10MB rotation
- `npx agent-hooks init` CLI scaffolding tool
- `npx agent-hooks validate` config validation
- SessionStart/Stop hooks for session lifecycle events
- Example listeners (shell, template, MCP)
