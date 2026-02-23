<!-- Example template listener for agent-hooks

Template listeners inject markdown content into the agent's context.
Use ${data.X} for event payload substitution and ${env.Y} for environment variables.

Register in .claude/agent-hooks.yml:
  events:
    session.lifecycle.start:
      - name: project-context
        type: template
        path: .claude/templates/project-context.md
        priority: 5
-->

## Project Context

This project uses the following conventions:

- **Language**: TypeScript with strict mode
- **Testing**: Vitest for unit and integration tests
- **Branch**: ${data.git_branch}

Before making changes, check existing patterns in the codebase.
After completing work, run the test suite to verify nothing is broken.
