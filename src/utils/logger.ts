import * as fs from "node:fs";
import * as path from "node:path";
import type { EmitResponse } from "../types.js";

const LOG_DIR = path.join(process.env.HOME ?? "", ".claude", "agent-hooks");
const LOG_FILE = path.join(LOG_DIR, "emit.log");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATED = 5;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_LOG_SIZE) return;

    // Rotate: emit.log.5 → delete, emit.log.4 → .5, ... emit.log → .1
    for (let i = MAX_ROTATED; i >= 1; i--) {
      const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
      const dst = `${LOG_FILE}.${i}`;
      if (i === MAX_ROTATED && fs.existsSync(dst)) {
        fs.unlinkSync(dst);
      }
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }
  } catch {
    // Silent — logging failures never throw
  }
}

export function logEmit(response: EmitResponse): void {
  try {
    ensureLogDir();
    rotateIfNeeded();

    const entry = {
      timestamp: response.executed_at,
      invocation_id: response.invocation_id,
      event: response.event,
      listeners_attempted: response.responses.length,
      listeners_succeeded: response.responses.filter((r) => r.status === "success" || r.status === "pending_execution").length,
      listeners_failed: response.errors.length,
      status: response.errors.length > 0 ? "partial" : "success",
      duration_ms: response.duration_ms,
      timed_out: response.timed_out,
      listener_details: response.responses.map((r) => ({
        name: r.name,
        listener_id: r.listener_id,
        type: r.type,
        status: r.status,
        duration_ms: r.duration_ms,
        ...(r.error ? { error: r.error.message } : {}),
      })),
    };

    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Silent — logging failures never throw
  }
}
