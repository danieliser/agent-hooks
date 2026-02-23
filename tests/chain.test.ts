import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { dispatch } from "../src/events/dispatcher.js";
import { findEntries, findAllEntriesForEvent } from "../src/events/dispatcher.js";
import { validateConfig } from "../src/config/validator.js";
import { testEmit, formatTestOutput } from "../src/commands/test.js";
import { listEvents } from "../src/commands/list.js";
import type { AgentHooksConfig, ListenerConfig, ChainConfig } from "../src/types.js";
import { isChainConfig } from "../src/types.js";

// Helper to create a temp shell script that writes to a shared file
function createScript(dir: string, name: string, content: string): string {
  const scriptPath = path.join(dir, name);
  fs.writeFileSync(scriptPath, content, { mode: 0o755 });
  return scriptPath;
}

describe("Listener chaining", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("isChainConfig type guard", () => {
    it("returns true for chain entries", () => {
      const chain: ChainConfig = {
        chain: [{ name: "step1", type: "shell", command: "echo hi", priority: 1 }],
        priority: 5,
      };
      expect(isChainConfig(chain)).toBe(true);
    });

    it("returns false for regular listeners", () => {
      const listener: ListenerConfig = { name: "test", type: "shell", command: "echo hi", priority: 5 };
      expect(isChainConfig(listener)).toBe(false);
    });
  });

  describe("chain execution", () => {
    it("executes chain members in sequence", async () => {
      const orderFile = path.join(tmpDir, "order.txt");
      const script1 = createScript(tmpDir, "step1.sh", `#!/bin/bash\necho -n "1" >> ${orderFile}\necho '{"step":1}'`);
      const script2 = createScript(tmpDir, "step2.sh", `#!/bin/bash\necho -n "2" >> ${orderFile}\necho '{"step":2}'`);

      const config: AgentHooksConfig = {
        events: {
          "test.chain": [
            {
              chain: [
                { name: "step1", type: "shell", command: script1, priority: 1 },
                { name: "step2", type: "shell", command: script2, priority: 2 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const result = await dispatch("test.chain", { msg: "hello" }, undefined, config);
      expect(result.responses.length).toBe(2);
      expect(result.responses[0].name).toBe("step1");
      expect(result.responses[1].name).toBe("step2");

      // Verify sequential execution order
      const order = fs.readFileSync(orderFile, "utf-8");
      expect(order).toBe("12");
    });

    it("passes _chain_results to subsequent members", async () => {
      const resultFile = path.join(tmpDir, "stdin.json");
      const script1 = createScript(tmpDir, "step1.sh", `#!/bin/bash\necho '{"value":"from-step1"}'`);
      const script2 = createScript(tmpDir, "step2.sh", `#!/bin/bash\ncat > ${resultFile}`);

      const config: AgentHooksConfig = {
        events: {
          "test.chain": [
            {
              chain: [
                { name: "step1", type: "shell", command: script1, priority: 1 },
                { name: "step2", type: "shell", command: script2, priority: 2 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      await dispatch("test.chain", { original: true }, undefined, config);

      // step2 should have received stdin with _chain_results
      const stdin = JSON.parse(fs.readFileSync(resultFile, "utf-8"));
      expect(stdin.data.original).toBe(true);
      expect(stdin.data._chain_results).toBeDefined();
      expect(stdin.data._chain_results.length).toBe(1);
      expect(stdin.data._chain_results[0].name).toBe("step1");
    });

    it("stops chain on member error (fail-fast)", async () => {
      const orderFile = path.join(tmpDir, "order.txt");
      fs.writeFileSync(orderFile, "");
      const script1 = createScript(tmpDir, "fail.sh", `#!/bin/bash\necho -n "1" >> ${orderFile}\nexit 1`);
      const script2 = createScript(tmpDir, "step2.sh", `#!/bin/bash\necho -n "2" >> ${orderFile}\necho ok`);

      const config: AgentHooksConfig = {
        events: {
          "test.chain": [
            {
              chain: [
                { name: "fail-step", type: "shell", command: script1, priority: 1 },
                { name: "step2", type: "shell", command: script2, priority: 2 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const result = await dispatch("test.chain", {}, undefined, config);
      // Only 1 response because chain stopped after error
      expect(result.responses.length).toBe(1);
      expect(result.responses[0].name).toBe("fail-step");
      expect(result.responses[0].status).toBe("error");
      expect(result.errors.length).toBeGreaterThan(0);

      // step2 never ran
      const order = fs.readFileSync(orderFile, "utf-8");
      expect(order).toBe("1");
    });

    it("chain with when: condition filters correctly", async () => {
      const script1 = createScript(tmpDir, "step1.sh", `#!/bin/bash\necho ok`);

      const config: AgentHooksConfig = {
        events: {
          "test.chain": [
            {
              chain: [
                { name: "step1", type: "shell", command: script1, priority: 1 },
              ],
              priority: 5,
              when: '.status == "success"',
            } as any,
          ],
        },
      };

      // Matching data — chain should execute
      const result1 = await dispatch("test.chain", { status: "success" }, undefined, config);
      expect(result1.responses.length).toBe(1);

      // Non-matching data — chain should be skipped
      const result2 = await dispatch("test.chain", { status: "failed" }, undefined, config);
      expect(result2.responses.length).toBe(0);
    });

    it("chain executes alongside independent listeners", async () => {
      const script1 = createScript(tmpDir, "independent.sh", `#!/bin/bash\necho '{"who":"independent"}'`);
      const script2 = createScript(tmpDir, "chain1.sh", `#!/bin/bash\necho '{"who":"chain-step1"}'`);
      const script3 = createScript(tmpDir, "chain2.sh", `#!/bin/bash\necho '{"who":"chain-step2"}'`);

      const config: AgentHooksConfig = {
        events: {
          "test.mixed": [
            { name: "independent", type: "shell", command: script1, priority: 1 },
            {
              chain: [
                { name: "chain-step1", type: "shell", command: script2, priority: 1 },
                { name: "chain-step2", type: "shell", command: script3, priority: 2 },
              ],
              priority: 10,
            } as any,
          ],
        },
      };

      const result = await dispatch("test.mixed", {}, undefined, config);
      expect(result.responses.length).toBe(3); // 1 independent + 2 chain members
      expect(result.responses[0].name).toBe("independent");
      expect(result.responses[1].name).toBe("chain-step1");
      expect(result.responses[2].name).toBe("chain-step2");
    });
  });

  describe("findEntries", () => {
    it("returns both listeners and chains sorted by priority", async () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            { name: "low", type: "shell", command: "echo", priority: 1 },
            {
              chain: [{ name: "chain-step", type: "shell", command: "echo", priority: 1 }],
              priority: 5,
            } as any,
            { name: "high", type: "shell", command: "echo", priority: 20 },
          ],
        },
      };

      const entries = await findEntries("test.event", undefined, config);
      expect(entries.length).toBe(3);
      expect(entries[0].priority).toBe(1);
      expect(entries[1].priority).toBe(5);
      expect(isChainConfig(entries[1])).toBe(true);
      expect(entries[2].priority).toBe(20);
    });
  });

  describe("validator", () => {
    it("validates chain with valid members", () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            {
              chain: [
                { name: "step1", type: "shell", command: "echo hi", priority: 1 },
                { name: "step2", type: "shell", command: "echo bye", priority: 2 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const errors = validateConfig(config);
      // No errors about chain structure (may have errors about command paths)
      const chainErrors = errors.filter((e) => e.message.includes("chain"));
      expect(chainErrors.length).toBe(0);
    });

    it("rejects MCP listeners inside chains", () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            {
              chain: [
                { name: "bad", type: "mcp", server: "s", tool: "t", priority: 1 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const errors = validateConfig(config);
      expect(errors.some((e) => e.message.includes("not allowed in chains"))).toBe(true);
    });

    it("rejects empty chains", () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            { chain: [], priority: 5 } as any,
          ],
        },
      };

      const errors = validateConfig(config);
      expect(errors.some((e) => e.message.includes("non-empty"))).toBe(true);
    });

    it("rejects when: on chain members", () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            {
              chain: [
                { name: "step1", type: "shell", command: "echo", priority: 1, when: ".x == 1" },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const errors = validateConfig(config);
      expect(errors.some((e) => e.message.includes("not allowed on chain members"))).toBe(true);
    });
  });

  describe("list command", () => {
    it("counts chain members in listener totals", () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            { name: "solo", type: "shell", command: "echo", priority: 1 },
            {
              chain: [
                { name: "c1", type: "shell", command: "echo", priority: 1 },
                { name: "c2", type: "shell", command: "echo", priority: 2 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const entries = listEvents(config);
      expect(entries[0].listener_count).toBe(3); // 1 solo + 2 chain members
    });

    it("shows chain type in listener details", () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            {
              chain: [
                { name: "c1", type: "shell", command: "echo", priority: 1 },
                { name: "c2", type: "shell", command: "echo", priority: 2 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const entries = listEvents(config);
      expect(entries[0].listeners![0].type).toBe("chain");
      expect(entries[0].listeners![0].chain_members).toBe(2);
    });
  });

  describe("test command", () => {
    it("shows chain structure in test output", async () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            {
              chain: [
                { name: "step1", type: "shell", command: "echo hi", priority: 1 },
                { name: "step2", type: "shell", command: "echo bye", priority: 2 },
              ],
              priority: 5,
            } as any,
          ],
        },
      };

      const result = await testEmit("test.event", {}, config, false);
      expect(result.chains.length).toBe(1);
      expect(result.chains[0].members.length).toBe(2);
      expect(result.chains[0].members[0].name).toBe("step1");
      expect(result.chains[0].members[1].name).toBe("step2");

      const output = formatTestOutput(result);
      expect(output).toContain("chain (2 members)");
      expect(output).toContain("step1");
      expect(output).toContain("step2");
    });

    it("shows chain condition evaluation with --when", async () => {
      const config: AgentHooksConfig = {
        events: {
          "test.event": [
            {
              chain: [
                { name: "step1", type: "shell", command: "echo", priority: 1 },
              ],
              priority: 5,
              when: '.status == "ok"',
            } as any,
          ],
        },
      };

      const result = await testEmit("test.event", { status: "ok" }, config, true);
      expect(result.chains[0].conditionalMatched).toBe(true);

      const result2 = await testEmit("test.event", { status: "bad" }, config, true);
      expect(result2.chains[0].conditionalMatched).toBe(false);
    });
  });
});
