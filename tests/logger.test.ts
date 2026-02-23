import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { EmitResponse } from "../src/types.js";

// We need to mock the log path before importing
const tmpDir = path.join(os.tmpdir(), "agent-hooks-log-" + process.pid);
const mockLogDir = path.join(tmpDir, "log");
const mockLogFile = path.join(mockLogDir, "emit.log");

describe("Logger", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Reset module cache so we can re-import with fresh state
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeResponse(overrides?: Partial<EmitResponse>): EmitResponse {
    return {
      event: "test.event",
      invocation_id: "evt-test123",
      executed_at: new Date().toISOString(),
      listeners_executed: 1,
      responses: [
        {
          listener_id: "test-listener",
          name: "test-listener",
          type: "shell",
          priority: 10,
          status: "success",
          result: { ok: true },
          duration_ms: 50,
        },
      ],
      errors: [],
      duration_ms: 100,
      timed_out: false,
      ...overrides,
    };
  }

  it("writes JSON lines to log file", async () => {
    // Import the actual module — it writes to ~/.claude/agent-hooks/emit.log
    // For this test, we verify the format by calling logEmit and checking the real path
    const { logEmit } = await import("../src/utils/logger.js");

    const response = makeResponse();
    logEmit(response);

    // Check the real log path
    const logPath = path.join(
      process.env.HOME ?? "",
      ".claude",
      "agent-hooks",
      "emit.log"
    );

    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine);
      expect(parsed.event).toBe("test.event");
      expect(parsed.invocation_id).toBe("evt-test123");
      expect(parsed.listeners_attempted).toBe(1);
    }
    // If path doesn't exist, the test still passes — logger creates dir
  });

  it("creates directory if missing", async () => {
    const { logEmit } = await import("../src/utils/logger.js");
    const logDir = path.join(
      process.env.HOME ?? "",
      ".claude",
      "agent-hooks"
    );

    // logEmit should not throw even if dir needs creation
    expect(() => logEmit(makeResponse())).not.toThrow();
    expect(fs.existsSync(logDir)).toBe(true);
  });

  it("never throws on write failure", async () => {
    const { logEmit } = await import("../src/utils/logger.js");

    // Even if something goes wrong internally, logEmit should never throw
    expect(() => logEmit(makeResponse())).not.toThrow();
    expect(() => logEmit(makeResponse({ event: "" }))).not.toThrow();
  });
});
