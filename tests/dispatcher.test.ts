import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { dispatch, dispatchAsync } from "../src/events/dispatcher.js";
import type { AgentHooksConfig } from "../src/types.js";

const tmpDir = path.join(os.tmpdir(), "agent-hooks-disp-" + process.pid);

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(
  listeners: AgentHooksConfig["events"]
): AgentHooksConfig {
  return {
    events: listeners,
    enabled: true,
    errors: { isolate_failures: true, include_in_response: true },
  };
}

describe("Event dispatcher", () => {
  it("priority ordering — lower runs first", async () => {
    // Create two scripts that write their name to a shared file to verify order
    const orderFile = path.join(tmpDir, "order.txt");
    const script1 = path.join(tmpDir, "first.sh");
    const script2 = path.join(tmpDir, "second.sh");

    fs.writeFileSync(
      script1,
      `#!/bin/bash\necho -n "first," >> "${orderFile}"\necho '{"ran": "first"}'`,
    );
    fs.writeFileSync(
      script2,
      `#!/bin/bash\necho -n "second," >> "${orderFile}"\necho '{"ran": "second"}'`,
    );
    fs.chmodSync(script1, 0o755);
    fs.chmodSync(script2, 0o755);

    const config = makeConfig({
      "test.event": [
        { name: "second", type: "shell", command: script2, priority: 20 },
        { name: "first", type: "shell", command: script1, priority: 5 },
      ],
    });

    const result = await dispatch("test.event", {}, 10000, config);
    expect(result.responses).toHaveLength(2);
    expect(result.responses[0].name).toBe("first");
    expect(result.responses[1].name).toBe("second");

    const order = fs.readFileSync(orderFile, "utf-8");
    expect(order).toBe("first,second,");
  });

  it("error isolation — one fails, others run", async () => {
    const goodScript = path.join(tmpDir, "good.sh");
    const badScript = path.join(tmpDir, "bad.sh");

    fs.writeFileSync(goodScript, '#!/bin/bash\necho \'{"ok": true}\'');
    fs.writeFileSync(badScript, "#!/bin/bash\nexit 1");
    fs.chmodSync(goodScript, 0o755);
    fs.chmodSync(badScript, 0o755);

    const config = makeConfig({
      "test.event": [
        { name: "bad", type: "shell", command: badScript, priority: 1 },
        { name: "good", type: "shell", command: goodScript, priority: 10 },
      ],
    });

    const result = await dispatch("test.event", {}, 10000, config);
    expect(result.responses).toHaveLength(2);
    expect(result.responses[0].status).toBe("error");
    expect(result.responses[1].status).toBe("success");
    expect(result.errors).toHaveLength(1);
  });

  it("10KB payload rejection", async () => {
    const config = makeConfig({ "test.event": [] });
    const bigData: Record<string, unknown> = {
      payload: "x".repeat(11 * 1024),
    };

    await expect(
      dispatch("test.event", bigData, 5000, config)
    ).rejects.toThrow("10KB limit");
  });

  it("empty listener list → empty response", async () => {
    const config = makeConfig({ "other.event": [] });
    const result = await dispatch("test.event", {}, 5000, config);
    expect(result.listeners_executed).toBe(0);
    expect(result.responses).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("MCP listener returns pending_execution status (CTO Condition #1)", async () => {
    const config = makeConfig({
      "test.event": [
        {
          name: "mcp-test",
          type: "mcp",
          server: "test-server",
          tool: "test_tool",
          priority: 10,
        },
      ],
    });

    const result = await dispatch("test.event", {}, 5000, config);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].status).toBe("pending_execution");
    expect(result.responses[0].result).toHaveProperty("mcp_calls");
  });

  it("wildcard matching — strategize.* catches strategize.spec.drafted", async () => {
    const script = path.join(tmpDir, "wildcard.sh");
    fs.writeFileSync(script, '#!/bin/bash\necho \'{"matched": true}\'');
    fs.chmodSync(script, 0o755);

    const config = makeConfig({
      "strategize.*": [
        { name: "wildcard", type: "shell", command: script, priority: 10 },
      ],
    });

    const result = await dispatch(
      "strategize.spec.drafted",
      {},
      10000,
      config
    );
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].status).toBe("success");
  });

  it("template listener returns content", async () => {
    const templateFile = path.join(tmpDir, "test-template.md");
    fs.writeFileSync(templateFile, "# Test Template\nHello ${data.name}!");

    const config = makeConfig({
      "test.event": [
        {
          name: "template-test",
          type: "template",
          path: templateFile,
          priority: 10,
        },
      ],
    });

    const result = await dispatch(
      "test.event",
      { name: "World" },
      5000,
      config
    );
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].status).toBe("success");
    expect((result.responses[0].result as any).template_content).toBe(
      "# Test Template\nHello World!"
    );
  });

  it("async mode returns immediately with enqueued status", async () => {
    const script = path.join(tmpDir, "async-slow.sh");
    fs.writeFileSync(script, '#!/bin/bash\nsleep 2\necho \'{"done": true}\'');
    fs.chmodSync(script, 0o755);

    const config = makeConfig({
      "test.event": [
        { name: "slow-listener", type: "shell", command: script, priority: 10 },
      ],
    });

    const startTime = Date.now();
    const result = await dispatchAsync("test.event", { key: "val" }, 10000, config);
    const elapsed = Date.now() - startTime;

    // Should return immediately (well under the 2s sleep)
    expect(elapsed).toBeLessThan(500);
    expect(result.mode).toBe("async");
    expect(result.status).toBe("enqueued");
    expect(result.listeners_registered).toBe(1);
    expect(result.invocation_id).toMatch(/^evt-/);
  });

  it("async mode with no listeners returns zero registered", async () => {
    const config = makeConfig({});
    const result = await dispatchAsync("no.listeners", undefined, 5000, config);
    expect(result.listeners_registered).toBe(0);
    expect(result.status).toBe("enqueued");
  });

  it("async mode enforces 10KB payload limit", async () => {
    const config = makeConfig({ "test.event": [] });
    await expect(() =>
      dispatchAsync("test.event", { big: "x".repeat(11 * 1024) }, 5000, config)
    ).rejects.toThrow("10KB limit");
  });

  it("conditional listener with matching condition — executes", async () => {
    const script = path.join(tmpDir, "conditional.sh");
    fs.writeFileSync(script, '#!/bin/bash\necho \'{"executed": true}\'');
    fs.chmodSync(script, 0o755);

    const config = makeConfig({
      "test.event": [
        {
          name: "conditional-match",
          type: "shell",
          command: script,
          priority: 10,
          when: '.category == "security"',
        },
      ],
    });

    const result = await dispatch("test.event", { category: "security" }, 5000, config);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].name).toBe("conditional-match");
    expect(result.responses[0].status).toBe("success");
  });

  it("conditional listener with non-matching condition — skipped", async () => {
    const script = path.join(tmpDir, "conditional2.sh");
    fs.writeFileSync(script, '#!/bin/bash\necho \'{"executed": true}\'');
    fs.chmodSync(script, 0o755);

    const config = makeConfig({
      "test.event": [
        {
          name: "conditional-skip",
          type: "shell",
          command: script,
          priority: 10,
          when: '.category == "security"',
        },
      ],
    });

    const result = await dispatch("test.event", { category: "logging" }, 5000, config);
    // Listener is skipped, so no responses
    expect(result.responses).toHaveLength(0);
    expect(result.listeners_executed).toBe(0);
  });

  it("mix of conditional and unconditional listeners — correct subset executes", async () => {
    const unconditionalScript = path.join(tmpDir, "unconditional.sh");
    const conditionalScript = path.join(tmpDir, "conditional3.sh");

    fs.writeFileSync(unconditionalScript, '#!/bin/bash\necho \'{"type": "unconditional"}\'');
    fs.writeFileSync(conditionalScript, '#!/bin/bash\necho \'{"type": "conditional"}\'');
    fs.chmodSync(unconditionalScript, 0o755);
    fs.chmodSync(conditionalScript, 0o755);

    const config = makeConfig({
      "test.event": [
        {
          name: "unconditional",
          type: "shell",
          command: unconditionalScript,
          priority: 5,
        },
        {
          name: "conditional-match",
          type: "shell",
          command: conditionalScript,
          priority: 10,
          when: '.priority > 5',
        },
      ],
    });

    const result = await dispatch("test.event", { priority: 10 }, 5000, config);
    expect(result.responses).toHaveLength(2);
    expect(result.responses[0].name).toBe("unconditional");
    expect(result.responses[1].name).toBe("conditional-match");
  });

  it("conditional listener with invalid when expression — graceful degradation executes anyway", async () => {
    const script = path.join(tmpDir, "invalid-cond.sh");
    fs.writeFileSync(script, '#!/bin/bash\necho \'{"executed": true}\'');
    fs.chmodSync(script, 0o755);

    const config = makeConfig({
      "test.event": [
        {
          name: "bad-condition",
          type: "shell",
          command: script,
          priority: 10,
          when: "invalid jq syntax [[[",
        },
      ],
    });

    const result = await dispatch("test.event", { data: "test" }, 5000, config);
    // Even with invalid condition, listener executes (graceful degradation)
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].name).toBe("bad-condition");
    expect(result.responses[0].status).toBe("success");
  });

  it("async dispatch respects conditional matching", async () => {
    const script = path.join(tmpDir, "async-conditional.sh");
    fs.writeFileSync(script, '#!/bin/bash\necho \'{"async": true}\'');
    fs.chmodSync(script, 0o755);

    const config = makeConfig({
      "test.event": [
        {
          name: "async-cond",
          type: "shell",
          command: script,
          priority: 10,
          when: '.enabled == true',
        },
      ],
    });

    // Condition matches
    const result1 = await dispatchAsync("test.event", { enabled: true }, 10000, config);
    expect(result1.listeners_registered).toBe(1);

    // Condition doesn't match
    const result2 = await dispatchAsync("test.event", { enabled: false }, 10000, config);
    expect(result2.listeners_registered).toBe(0);
  });
});
