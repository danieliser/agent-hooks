import { describe, it, expect } from "vitest";
import { testEmit, formatTestOutput } from "../../src/commands/test.js";
import type { AgentHooksConfig } from "../../src/types.js";

describe("testEmit", () => {
  const baseConfig: AgentHooksConfig = {
    events: {
      "agent.workflow.step_completed": [
        { name: "notify", type: "shell", command: "notify.sh", priority: 5 },
        { name: "log", type: "template", path: "log.md", priority: 10 },
      ],
      "strategize.spec.drafted": [
        {
          name: "create-adr",
          type: "mcp",
          server: "server-a",
          tool: "tool-a",
          priority: 15,
          args_mapping: { title: "${data.spec_name}" },
        },
      ],
    },
    enabled: true,
  };

  it("matches correct listeners for an event", async () => {
    const result = await testEmit("agent.workflow.step_completed", {}, baseConfig);
    expect(result.listener_count).toBe(2);
    expect(result.listeners).toHaveLength(2);
    expect(result.listeners[0].name).toBe("notify");
    expect(result.listeners[1].name).toBe("log");
  });

  it("returns empty listeners for unknown event", async () => {
    const result = await testEmit("nonexistent.event", {}, baseConfig);
    expect(result.listener_count).toBe(0);
    expect(result.listeners).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it("shell listener shows command and payload size", async () => {
    const result = await testEmit("agent.workflow.step_completed", {}, baseConfig);
    const shellListener = result.listeners.find((l) => l.type === "shell");
    expect(shellListener).toBeDefined();
    expect(shellListener?.command).toBe("notify.sh");
    expect(shellListener?.payloadSize).toBe(2); // "{}" is 2 bytes
  });

  it("template listener shows path", async () => {
    const result = await testEmit("agent.workflow.step_completed", {}, baseConfig);
    const templateListener = result.listeners.find((l) => l.type === "template");
    expect(templateListener).toBeDefined();
    expect(templateListener?.path).toBe("log.md");
  });

  it("mcp listener shows server and tool", async () => {
    const result = await testEmit("strategize.spec.drafted", {}, baseConfig);
    const mcpListener = result.listeners.find((l) => l.type === "mcp");
    expect(mcpListener).toBeDefined();
    expect(mcpListener?.server).toBe("server-a");
    expect(mcpListener?.tool).toBe("tool-a");
  });

  it("mcp args substitution replaces ${data.X} with values", async () => {
    const result = await testEmit("strategize.spec.drafted", { spec_name: "my-spec" }, baseConfig);
    const mcpListener = result.listeners.find((l) => l.type === "mcp");
    expect(mcpListener?.args).toBeDefined();
    expect(mcpListener?.args?.title).toBe("my-spec");
  });

  it("mcp args substitution marks missing fields", async () => {
    const result = await testEmit("strategize.spec.drafted", {}, baseConfig);
    const mcpListener = result.listeners.find((l) => l.type === "mcp");
    expect(mcpListener?.args?.title).toBe("<missing: data.spec_name>");
  });

  it("payload size error when over 10KB", async () => {
    const largeData: Record<string, unknown> = {
      bigfield: "x".repeat(11 * 1024), // 11KB string
    };
    const result = await testEmit("agent.workflow.step_completed", largeData, baseConfig);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Payload exceeds");
    expect(result.errors[0]).toContain("KB limit");
  });

  it("success is true when no errors", async () => {
    const result = await testEmit("agent.workflow.step_completed", {}, baseConfig);
    expect(result.success).toBe(true);
  });

  it("success is false when listener has errors", async () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          {
            name: "broken-shell",
            type: "shell",
            priority: 1,
            // Missing command field
          },
        ],
      },
      enabled: true,
    };
    const result = await testEmit("test.event", {}, config);
    expect(result.success).toBe(false);
    expect(result.listeners[0].errors).toContain("Missing command field");
  });

  it("success is false when payload exceeds limit", async () => {
    const largeData: Record<string, unknown> = {
      bigfield: "x".repeat(11 * 1024),
    };
    const result = await testEmit("agent.workflow.step_completed", largeData, baseConfig);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("detects missing server field in mcp listener", async () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          {
            name: "broken-mcp",
            type: "mcp",
            tool: "some-tool",
            priority: 1,
            // Missing server field
          },
        ],
      },
      enabled: true,
    };
    const result = await testEmit("test.event", {}, config);
    expect(result.listeners[0].errors).toContain("Missing server field");
  });

  it("detects missing tool field in mcp listener", async () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          {
            name: "broken-mcp",
            type: "mcp",
            server: "some-server",
            priority: 1,
            // Missing tool field
          },
        ],
      },
      enabled: true,
    };
    const result = await testEmit("test.event", {}, config);
    expect(result.listeners[0].errors).toContain("Missing tool field");
  });

  it("detects missing path field in template listener", async () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          {
            name: "broken-template",
            type: "template",
            priority: 1,
            // Missing path field
          },
        ],
      },
      enabled: true,
    };
    const result = await testEmit("test.event", {}, config);
    expect(result.listeners[0].errors).toContain("Missing path field");
  });

  it("includes timeout if specified", async () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          {
            name: "listener-with-timeout",
            type: "shell",
            command: "script.sh",
            priority: 1,
            timeout: 3000,
          },
        ],
      },
      enabled: true,
    };
    const result = await testEmit("test.event", {}, config);
    expect(result.listeners[0].timeout).toBe(3000);
  });

  it("priority ordering matches listener order", async () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          { name: "high", type: "shell", command: "h.sh", priority: 20 },
          { name: "low", type: "shell", command: "l.sh", priority: 5 },
          { name: "mid", type: "shell", command: "m.sh", priority: 10 },
        ],
      },
      enabled: true,
    };
    const result = await testEmit("test.event", {}, config);
    expect(result.listeners[0].name).toBe("low");
    expect(result.listeners[0].priority).toBe(5);
    expect(result.listeners[1].name).toBe("mid");
    expect(result.listeners[1].priority).toBe(10);
    expect(result.listeners[2].name).toBe("high");
    expect(result.listeners[2].priority).toBe(20);
  });
});

describe("formatTestOutput", () => {
  it("includes event name and listener count", () => {
    const result = {
      event: "test.event",
      listener_count: 2,
      listeners: [],
      errors: [],
      success: true,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("Event: test.event");
    expect(output).toContain("Listeners: 2");
  });

  it("shows shell listener details with command and payload size", () => {
    const result = {
      event: "test.event",
      listener_count: 1,
      listeners: [
        {
          name: "my-shell",
          type: "shell" as const,
          priority: 5,
          command: "script.sh",
          payloadSize: 100,
          timeout: undefined,
          warnings: [],
          errors: [],
        },
      ],
      errors: [],
      success: true,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("[1] my-shell (shell) [priority 5]");
    expect(output).toContain("command: script.sh");
    expect(output).toContain("payload size: 100 bytes");
  });

  it("shows mcp listener details with server, tool, and args", () => {
    const result = {
      event: "test.event",
      listener_count: 1,
      listeners: [
        {
          name: "my-mcp",
          type: "mcp" as const,
          priority: 10,
          server: "my-server",
          tool: "my-tool",
          args: { title: "my-title" },
          timeout: undefined,
          warnings: [],
          errors: [],
        },
      ],
      errors: [],
      success: true,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("[1] my-mcp (mcp) [priority 10]");
    expect(output).toContain("server: my-server");
    expect(output).toContain("tool: my-tool");
    expect(output).toContain('args: {"title":"my-title"}');
  });

  it("shows OK status when success is true", () => {
    const result = {
      event: "test.event",
      listener_count: 0,
      listeners: [],
      errors: [],
      success: true,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("Status: OK");
  });

  it("shows FAILED status when success is false", () => {
    const result = {
      event: "test.event",
      listener_count: 1,
      listeners: [
        {
          name: "broken",
          type: "shell" as const,
          priority: 1,
          timeout: undefined,
          warnings: [],
          errors: ["Missing command field"],
        },
      ],
      errors: [],
      success: false,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("Status: FAILED");
    expect(output).toContain("ERROR: Missing command field");
  });

  it("shows overall errors", () => {
    const result = {
      event: "test.event",
      listener_count: 0,
      listeners: [],
      errors: ["Payload exceeds 10KB limit (15KB)"],
      success: false,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("Overall errors:");
    expect(output).toContain("ERROR: Payload exceeds 10KB limit (15KB)");
  });

  it("shows timeout if specified", () => {
    const result = {
      event: "test.event",
      listener_count: 1,
      listeners: [
        {
          name: "with-timeout",
          type: "shell" as const,
          priority: 5,
          command: "script.sh",
          payloadSize: 100,
          timeout: 2000,
          warnings: [],
          errors: [],
        },
      ],
      errors: [],
      success: true,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("timeout: 2000ms");
  });

  it("shows template listener with path", () => {
    const result = {
      event: "test.event",
      listener_count: 1,
      listeners: [
        {
          name: "my-template",
          type: "template" as const,
          priority: 5,
          path: "context.md",
          timeout: undefined,
          warnings: [],
          errors: [],
        },
      ],
      errors: [],
      success: true,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("[1] my-template (template) [priority 5]");
    expect(output).toContain("path: context.md");
  });

  it("shows no listeners message for empty listener list", () => {
    const result = {
      event: "test.event",
      listener_count: 0,
      listeners: [],
      errors: [],
      success: true,
    };
    const output = formatTestOutput(result);
    expect(output).toContain("No listeners registered for this event");
  });
});
