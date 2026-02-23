import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAndMergeConfig } from "../src/config/loader.js";
import { validateConfig } from "../src/config/validator.js";
import { dispatch } from "../src/events/dispatcher.js";

const tmpDir = path.join(os.tmpdir(), "agent-hooks-int-" + process.pid);

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Integration: end-to-end emit with shell listener", () => {
  it("full path: config → validate → dispatch → shell → response", async () => {
    // 1. Create a shell listener script
    const script = path.join(tmpDir, "e2e-listener.sh");
    fs.writeFileSync(
      script,
      `#!/bin/bash
read input
event=$(echo "$input" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).event))")
echo "{\\"processed\\": true, \\"event_received\\": \\"$event\\"}"
`,
    );
    fs.chmodSync(script, 0o755);

    // 2. Create config YAML
    const configPath = path.join(tmpDir, "project.yml");
    fs.writeFileSync(
      configPath,
      `version: "1.0"
events:
  test.integration.run:
    - name: e2e-shell
      type: shell
      command: ${script}
      priority: 10
`,
    );

    // 3. Load and validate config
    const config = loadAndMergeConfig(
      path.join(tmpDir, "nonexistent-global.yml"),
      configPath
    );
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);

    // 4. Dispatch event
    const result = await dispatch(
      "test.integration.run",
      { foo: "bar" },
      10000,
      config
    );

    // 5. Verify response structure matches EmitResponse
    expect(result.event).toBe("test.integration.run");
    expect(result.invocation_id).toMatch(/^evt-/);
    expect(result.executed_at).toBeDefined();
    expect(result.listeners_executed).toBe(1);
    expect(result.responses).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.timed_out).toBe(false);

    // 6. Verify listener response
    const listener = result.responses[0];
    expect(listener.name).toBe("e2e-shell");
    expect(listener.type).toBe("shell");
    expect(listener.status).toBe("success");
    expect((listener.result as any).processed).toBe(true);
  });

  it("MCP listener returns pending_execution with mcp_calls", async () => {
    const configPath = path.join(tmpDir, "mcp-config.yml");
    fs.writeFileSync(
      configPath,
      `events:
  test.mcp.emit:
    - name: ddd-adr-creator
      type: mcp
      server: ddd-tool
      tool: add_decision_record
      priority: 10
      args_mapping:
        title: "\${data.title}"
        context: "\${data.spec_path}"
`,
    );

    const config = loadAndMergeConfig(
      path.join(tmpDir, "nonexistent.yml"),
      configPath
    );

    const result = await dispatch(
      "test.mcp.emit",
      { title: "Test Decision", spec_path: "docs/spec.md" },
      5000,
      config
    );

    expect(result.listeners_executed).toBe(1);
    const resp = result.responses[0];
    expect(resp.status).toBe("pending_execution"); // CTO Condition #1
    expect(resp.type).toBe("mcp");

    const mcpCalls = (resp.result as any).mcp_calls;
    expect(mcpCalls).toHaveLength(1);
    expect(mcpCalls[0].server).toBe("ddd-tool");
    expect(mcpCalls[0].tool).toBe("add_decision_record");
    expect(mcpCalls[0].args.title).toBe("Test Decision");
    expect(mcpCalls[0].args.context).toBe("docs/spec.md");
  });

  it("template listener returns content with substitution", async () => {
    const templateFile = path.join(tmpDir, "style-guide.md");
    fs.writeFileSync(
      templateFile,
      "# Style Guide for ${data.project}\nFollow these rules.",
    );

    const configPath = path.join(tmpDir, "template-config.yml");
    fs.writeFileSync(
      configPath,
      `events:
  test.template.emit:
    - name: style-injector
      type: template
      path: ${templateFile}
      priority: 5
`,
    );

    const config = loadAndMergeConfig(
      path.join(tmpDir, "nonexistent.yml"),
      configPath
    );

    const result = await dispatch(
      "test.template.emit",
      { project: "agent-hooks" },
      5000,
      config
    );

    expect(result.listeners_executed).toBe(1);
    const resp = result.responses[0];
    expect(resp.status).toBe("success");
    expect((resp.result as any).template_content).toBe(
      "# Style Guide for agent-hooks\nFollow these rules.",
    );
    expect((resp.result as any).word_count).toBeGreaterThan(0);
  });

  it("mixed listener types in priority order", async () => {
    const script = path.join(tmpDir, "mixed-shell.sh");
    fs.writeFileSync(script, '#!/bin/bash\necho \'{"shell": true}\'');
    fs.chmodSync(script, 0o755);

    const templateFile = path.join(tmpDir, "mixed-template.md");
    fs.writeFileSync(templateFile, "Template content");

    const configPath = path.join(tmpDir, "mixed-config.yml");
    fs.writeFileSync(
      configPath,
      `events:
  test.mixed:
    - name: template-first
      type: template
      path: ${templateFile}
      priority: 1
    - name: mcp-second
      type: mcp
      server: test-srv
      tool: test_tool
      priority: 5
    - name: shell-third
      type: shell
      command: ${script}
      priority: 10
`,
    );

    const config = loadAndMergeConfig(
      path.join(tmpDir, "nonexistent.yml"),
      configPath
    );

    const result = await dispatch("test.mixed", {}, 10000, config);

    expect(result.listeners_executed).toBe(3);
    expect(result.responses[0].name).toBe("template-first");
    expect(result.responses[0].type).toBe("template");
    expect(result.responses[1].name).toBe("mcp-second");
    expect(result.responses[1].type).toBe("mcp");
    expect(result.responses[1].status).toBe("pending_execution");
    expect(result.responses[2].name).toBe("shell-third");
    expect(result.responses[2].type).toBe("shell");
  });
});
