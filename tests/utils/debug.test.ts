import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Debug logging utilities", () => {
  const originalDebug = process.env.DEBUG;

  afterEach(() => {
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug;
    } else {
      delete process.env.DEBUG;
    }
    vi.resetModules();
  });

  it("exports all 5 required namespaces", async () => {
    const debug = await import("../../src/utils/debug.js");

    expect(debug.debugConfig).toBeDefined();
    expect(debug.debugDispatcher).toBeDefined();
    expect(debug.debugShellListener).toBeDefined();
    expect(debug.debugTemplateListener).toBeDefined();
    expect(debug.debugMcpListener).toBeDefined();
  });

  it("each namespace has the correct name", async () => {
    const debug = await import("../../src/utils/debug.js");

    expect(debug.debugConfig.namespace).toBe("agent-hooks:config");
    expect(debug.debugDispatcher.namespace).toBe("agent-hooks:dispatcher");
    expect(debug.debugShellListener.namespace).toBe("agent-hooks:shell-listener");
    expect(debug.debugTemplateListener.namespace).toBe("agent-hooks:template-listener");
    expect(debug.debugMcpListener.namespace).toBe("agent-hooks:mcp-listener");
  });

  it("debug functions are callable without errors when DEBUG is not set", async () => {
    delete process.env.DEBUG;
    const debug = await import("../../src/utils/debug.js");

    // Should be no-ops — no errors thrown
    expect(() => debug.debugConfig("test %s", "value")).not.toThrow();
    expect(() => debug.debugDispatcher("test %d", 42)).not.toThrow();
    expect(() => debug.debugShellListener("test")).not.toThrow();
    expect(() => debug.debugTemplateListener("test")).not.toThrow();
    expect(() => debug.debugMcpListener("test")).not.toThrow();
  });
});
