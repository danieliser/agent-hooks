# Contributing to agent-hooks

## Development Setup

```bash
git clone https://github.com/danieliser/agent-hooks.git
cd agent-hooks
npm install
npm run build
npm test
```

## Project Structure

```
src/
  index.ts          # MCP server entry point (stdio transport)
  cli.ts            # CLI entry point (init, validate, help)
  server.ts         # MCP server setup, dynamic tool loading
  types.ts          # TypeScript interfaces
  config/
    loader.ts       # YAML config loading + cascade merge
    validator.ts    # Config validation with line-number precision
    schema.ts       # Constants (limits, patterns, defaults)
  events/
    dispatcher.ts   # Event dispatch + wildcard matching
  listeners/
    shell-listener.ts     # Subprocess execution
    template-listener.ts  # Markdown template loading + substitution
    mcp-listener.ts       # MCP tool call instruction generation
  tools/
    emit.ts         # emit MCP tool definition
    has-listeners.ts # has_listeners MCP tool definition
  utils/
    logger.ts       # JSON-lines emit logging with rotation
tests/
  *.test.ts         # Vitest test suites
```

## Code Style

- TypeScript strict mode — no `any` types
- No external linting dependencies yet (keep it simple)
- Prefer explicit types over inference for public APIs
- Error messages should be specific and actionable

## Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

Tests use Vitest. All tests should be self-contained — no external services or network calls.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add wildcard support for event matching
fix: handle empty config file gracefully
docs: update permissions section in README
```

This enables automated changelog generation via semantic-release.

## Pull Request Process

1. Fork the repo and create a feature branch
2. Write tests for new functionality
3. Ensure all tests pass (`npm test`)
4. Ensure the build succeeds (`npm run build`)
5. Open a PR with a clear description of the change

## Reporting Issues

Use [GitHub Issues](https://github.com/danieliser/agent-hooks/issues). Include:
- agent-hooks version
- Node.js version
- Config file (redact sensitive values)
- Steps to reproduce
- Expected vs actual behavior
