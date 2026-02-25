import { spawn } from "node:child_process";
import * as path from "node:path";
import type {
  AgentHooksConfig,
  ListenerConfig,
  ListenerResponse,
  ShellPayload,
} from "../types.js";
import { debugShellListener } from "../utils/debug.js";

function resolveHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(process.env.HOME ?? "", p.slice(1));
  }
  return p;
}

export async function executeShellListener(
  listener: ListenerConfig,
  event: string,
  invocationId: string,
  data: Record<string, unknown>,
  timeout: number,
  config: AgentHooksConfig
): Promise<ListenerResponse> {
  const startTime = Date.now();

  if (!listener.command) {
    return {
      listener_id: listener.name,
      name: listener.name,
      type: "shell",
      priority: listener.priority,
      status: "error",
      result: null,
      duration_ms: 0,
      error: {
        listener_id: listener.name,
        type: "invalid_config",
        message: "Shell listener missing 'command'",
      },
    };
  }

  const command = resolveHome(listener.command);
  debugShellListener("executing command=%s timeout=%dms", command, timeout);
  const payload: ShellPayload = {
    event,
    invocation_id: invocationId,
    data,
    timestamp: new Date().toISOString(),
  };

  // Build environment
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...(config.global_env ?? {}),
    ...(listener.env ?? {}),
    AGENT_HOOKS_EVENT: event,
    AGENT_HOOKS_INVOCATION_ID: invocationId,
  };

  return new Promise<ListenerResponse>((resolve) => {
    // Use argument array to prevent injection — spec Section 5 security note
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const child = spawn(cmd, args, {
      env,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      debugShellListener("command stdout length=%d", stdout.length);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Write payload to stdin — ignore EPIPE if child exits before read
    child.stdin.on("error", () => {});
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    // Timeout handling: SIGTERM then SIGKILL after grace period
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may already be dead
        }
      }, 500);
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const durationMs = Date.now() - startTime;

      if (killed) {
        resolve({
          listener_id: listener.name,
          name: listener.name,
          type: "shell",
          priority: listener.priority,
          status: "timeout",
          result: null,
          duration_ms: durationMs,
          error: {
            listener_id: listener.name,
            type: "timeout",
            message: `Shell listener timed out after ${timeout}ms`,
            details: stderr || undefined,
          },
        });
        return;
      }

      if (code !== 0) {
        resolve({
          listener_id: listener.name,
          name: listener.name,
          type: "shell",
          priority: listener.priority,
          status: "error",
          result: null,
          duration_ms: durationMs,
          error: {
            listener_id: listener.name,
            type: "execution_error",
            message: `Shell listener exited with code ${code}`,
            details: stderr || undefined,
          },
        });
        return;
      }

      // Parse JSON stdout
      let result: unknown;
      try {
        result = stdout.trim() ? JSON.parse(stdout.trim()) : {};
      } catch {
        resolve({
          listener_id: listener.name,
          name: listener.name,
          type: "shell",
          priority: listener.priority,
          status: "error",
          result: null,
          duration_ms: durationMs,
          error: {
            listener_id: listener.name,
            type: "invalid_output",
            message: "Shell listener output is not valid JSON",
            details: stdout.slice(0, 500),
          },
        });
        return;
      }

      resolve({
        listener_id: listener.name,
        name: listener.name,
        type: "shell",
        priority: listener.priority,
        status: "success",
        result,
        duration_ms: durationMs,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      debugShellListener("command error: %s", err.message);
      resolve({
        listener_id: listener.name,
        name: listener.name,
        type: "shell",
        priority: listener.priority,
        status: "error",
        result: null,
        duration_ms: Date.now() - startTime,
        error: {
          listener_id: listener.name,
          type: "execution_error",
          message: err.message,
        },
      });
    });
  });
}
