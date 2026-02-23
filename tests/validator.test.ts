import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validateConfig, validateYamlWithLineNumbers } from "../src/config/validator.js";
import type { AgentHooksConfig } from "../src/types.js";

const tmpDir = path.join(os.tmpdir(), "agent-hooks-val-" + process.pid);

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Config validation — line-number precision (CTO Condition #4)", () => {
  it("1. missing required field → reports line", () => {
    const yamlFile = path.join(tmpDir, "missing-field.yml");
    fs.writeFileSync(
      yamlFile,
      `events:
  test.event:
    - name: bad-mcp
      type: mcp
      priority: 10
`
    );
    const errors = validateYamlWithLineNumbers(yamlFile);
    expect(errors.length).toBeGreaterThan(0);
    const serverErr = errors.find((e) => e.message.includes("server"));
    expect(serverErr).toBeDefined();
    expect(serverErr!.line).toBeDefined();
    expect(typeof serverErr!.line).toBe("number");
  });

  it("2. invalid field value type → reports line", () => {
    const yamlFile = path.join(tmpDir, "bad-type.yml");
    fs.writeFileSync(
      yamlFile,
      `events:
  test.event:
    - name: bad-priority
      type: shell
      command: /usr/bin/echo
      priority: "not-a-number"
`
    );
    const errors = validateYamlWithLineNumbers(yamlFile);
    expect(errors.length).toBeGreaterThan(0);
    const priErr = errors.find((e) => e.message.includes("priority"));
    expect(priErr).toBeDefined();
    expect(priErr!.line).toBeDefined();
  });

  it("3. YAML syntax error → reports line", () => {
    const yamlFile = path.join(tmpDir, "syntax.yml");
    fs.writeFileSync(
      yamlFile,
      `events:
  test.event:
    - name bad-yaml
      type: shell
`
    );
    const errors = validateYamlWithLineNumbers(yamlFile);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].line).toBeDefined();
  });

  it("4. invalid listener type → reports line", () => {
    const yamlFile = path.join(tmpDir, "bad-listener-type.yml");
    fs.writeFileSync(
      yamlFile,
      `events:
  test.event:
    - name: unknown-type
      type: webhook
      url: http://example.com
`
    );
    const errors = validateYamlWithLineNumbers(yamlFile);
    expect(errors.length).toBeGreaterThan(0);
    const typeErr = errors.find((e) => e.message.includes("invalid type"));
    expect(typeErr).toBeDefined();
    expect(typeErr!.line).toBeDefined();
  });

  it("5. missing required field for shell type → reports line", () => {
    const yamlFile = path.join(tmpDir, "missing-command.yml");
    fs.writeFileSync(
      yamlFile,
      `events:
  test.event:
    - name: no-command
      type: shell
      priority: 10
`
    );
    const errors = validateYamlWithLineNumbers(yamlFile);
    const cmdErr = errors.find((e) => e.message.includes("command"));
    expect(cmdErr).toBeDefined();
    expect(cmdErr!.line).toBeDefined();
  });

  it("6. nonexistent file returns no errors", () => {
    const errors = validateYamlWithLineNumbers(
      path.join(tmpDir, "does-not-exist.yml")
    );
    expect(errors).toHaveLength(0);
  });
});

describe("Config validation — semantic checks", () => {
  it("rejects invalid event name format", () => {
    const config: AgentHooksConfig = {
      events: {
        "INVALID-NAME": [
          { name: "test", type: "shell", command: "/usr/bin/echo", priority: 10 },
        ],
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.message.includes("does not match"))).toBe(true);
  });

  it("rejects priority out of range", () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          { name: "test", type: "shell", command: "/usr/bin/echo", priority: 999 },
        ],
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.message.includes("priority"))).toBe(true);
  });

  it("detects duplicate listener names in same event", () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          { name: "dupe", type: "shell", command: "/usr/bin/echo", priority: 10 },
          { name: "dupe", type: "shell", command: "/usr/bin/true", priority: 20 },
        ],
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.message.includes("duplicate"))).toBe(true);
  });

  it("rejects template file exceeding 100KB (CTO Condition #3)", () => {
    const bigFile = path.join(tmpDir, "big-template.md");
    // Write 101KB file
    fs.writeFileSync(bigFile, "x".repeat(101 * 1024));

    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          { name: "big", type: "template", path: bigFile, priority: 10 },
        ],
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.message.includes("100KB limit"))).toBe(true);
  });

  it("accepts valid template under 100KB", () => {
    const smallFile = path.join(tmpDir, "small-template.md");
    fs.writeFileSync(smallFile, "# Hello\nValid template content\n");

    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          { name: "small", type: "template", path: smallFile, priority: 10 },
        ],
      },
    };
    const errors = validateConfig(config);
    expect(errors.filter((e) => e.message.includes("100KB"))).toHaveLength(0);
  });

  it("reports template file not found", () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          {
            name: "missing",
            type: "template",
            path: "/nonexistent/template.md",
            priority: 10,
          },
        ],
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.message.includes("not found"))).toBe(true);
  });

  it("validates MCP listener requires server and tool", () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [
          { name: "bad-mcp", type: "mcp", priority: 10 },
        ],
      },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.message.includes("server"))).toBe(true);
    expect(errors.some((e) => e.message.includes("tool"))).toBe(true);
  });
});
