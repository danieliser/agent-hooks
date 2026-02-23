import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { executeShellListener } from "../src/listeners/shell-listener.js";
import type { AgentHooksConfig } from "../src/types.js";

const tmpDir = path.join(os.tmpdir(), "agent-hooks-shell-" + process.pid);
const baseConfig: AgentHooksConfig = {
  events: {},
  enabled: true,
  errors: { isolate_failures: true, include_in_response: true },
};

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Shell listener", () => {
  it("successful JSON in/out", async () => {
    const script = path.join(tmpDir, "echo.sh");
    fs.writeFileSync(
      script,
      '#!/bin/bash\nread input\necho \'{"received": true}\'',
    );
    fs.chmodSync(script, 0o755);

    const result = await executeShellListener(
      { name: "echo-test", type: "shell", command: script, priority: 10 },
      "test.event",
      "evt-test123",
      { key: "value" },
      5000,
      baseConfig
    );

    expect(result.status).toBe("success");
    expect((result.result as any).received).toBe(true);
  });

  it("non-zero exit code → error", async () => {
    const script = path.join(tmpDir, "fail.sh");
    fs.writeFileSync(script, "#!/bin/bash\necho 'something broke' >&2\nexit 1");
    fs.chmodSync(script, 0o755);

    const result = await executeShellListener(
      { name: "fail-test", type: "shell", command: script, priority: 10 },
      "test.event",
      "evt-test123",
      {},
      5000,
      baseConfig
    );

    expect(result.status).toBe("error");
    expect(result.error?.type).toBe("execution_error");
    expect(result.error?.details).toContain("something broke");
  });

  it("timeout → SIGTERM/SIGKILL", async () => {
    // Use a node script instead of bash sleep — more reliable signal handling
    const script = path.join(tmpDir, "hang.js");
    fs.writeFileSync(
      script,
      `setTimeout(() => { console.log('{}'); }, 60000);`,
    );

    const result = await executeShellListener(
      { name: "hang-test", type: "shell", command: `node ${script}`, priority: 10 },
      "test.event",
      "evt-test123",
      {},
      500, // 500ms timeout
      baseConfig
    );

    expect(result.status).toBe("timeout");
    expect(result.error?.type).toBe("timeout");
  }, 10000);

  it("invalid JSON output → error", async () => {
    const script = path.join(tmpDir, "bad-json.sh");
    fs.writeFileSync(script, "#!/bin/bash\necho 'not json at all'");
    fs.chmodSync(script, 0o755);

    const result = await executeShellListener(
      { name: "bad-json", type: "shell", command: script, priority: 10 },
      "test.event",
      "evt-test123",
      {},
      5000,
      baseConfig
    );

    expect(result.status).toBe("error");
    expect(result.error?.type).toBe("invalid_output");
  });

  it("stderr capture on failure", async () => {
    const script = path.join(tmpDir, "stderr.sh");
    fs.writeFileSync(
      script,
      "#!/bin/bash\necho 'detailed error info' >&2\nexit 2",
    );
    fs.chmodSync(script, 0o755);

    const result = await executeShellListener(
      { name: "stderr-test", type: "shell", command: script, priority: 10 },
      "test.event",
      "evt-test123",
      {},
      5000,
      baseConfig
    );

    expect(result.status).toBe("error");
    expect(result.error?.details).toContain("detailed error info");
  });

  it("passes event data on stdin", async () => {
    const outFile = path.join(tmpDir, "stdin-capture.json");
    const script = path.join(tmpDir, "capture.sh");
    fs.writeFileSync(
      script,
      `#!/bin/bash\ncat > "${outFile}"\necho '{"captured": true}'`,
    );
    fs.chmodSync(script, 0o755);

    await executeShellListener(
      { name: "capture", type: "shell", command: script, priority: 10 },
      "my.event",
      "evt-abc",
      { hello: "world" },
      5000,
      baseConfig
    );

    const captured = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    expect(captured.event).toBe("my.event");
    expect(captured.invocation_id).toBe("evt-abc");
    expect(captured.data.hello).toBe("world");
  });

  it("sets AGENT_HOOKS env vars", async () => {
    const script = path.join(tmpDir, "env.sh");
    fs.writeFileSync(
      script,
      `#!/bin/bash\necho '{"event_env": "'$AGENT_HOOKS_EVENT'", "id_env": "'$AGENT_HOOKS_INVOCATION_ID'"}'`,
    );
    fs.chmodSync(script, 0o755);

    const result = await executeShellListener(
      { name: "env-test", type: "shell", command: script, priority: 10 },
      "test.event",
      "evt-env123",
      {},
      5000,
      baseConfig
    );

    expect(result.status).toBe("success");
    const res = result.result as any;
    expect(res.event_env).toBe("test.event");
    expect(res.id_env).toBe("evt-env123");
  });
});
