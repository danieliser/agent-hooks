import type { AgentHooksConfig, ListenerConfig, ListenerType } from "../types.js";
import { findListeners } from "../events/dispatcher.js";
import { MAX_PAYLOAD_SIZE_BYTES } from "../config/schema.js";

export interface TestResult {
  event: string;
  listener_count: number;
  listeners: TestListenerResult[];
  errors: string[];
  success: boolean;
}

export interface TestListenerResult {
  name: string;
  type: ListenerType;
  priority: number;
  // Type-specific details
  command?: string; // shell
  path?: string; // template
  server?: string; // mcp
  tool?: string; // mcp
  args?: Record<string, unknown>; // mcp after substitution
  payloadSize?: number; // bytes
  timeout?: number; // ms
  warnings: string[];
  errors: string[];
}

export function testEmit(
  event: string,
  data: Record<string, unknown>,
  config: AgentHooksConfig
): TestResult {
  const listeners = findListeners(event, config);
  const payloadSize = Buffer.byteLength(JSON.stringify(data), "utf-8");
  const results: TestListenerResult[] = [];
  const errors: string[] = [];

  if (payloadSize > MAX_PAYLOAD_SIZE_BYTES) {
    errors.push(
      `Payload exceeds ${MAX_PAYLOAD_SIZE_BYTES / 1024}KB limit (${Math.round(payloadSize / 1024)}KB)`
    );
  }

  for (const listener of listeners) {
    const result: TestListenerResult = {
      name: listener.name,
      type: listener.type,
      priority: listener.priority,
      timeout: listener.timeout,
      warnings: [],
      errors: [],
    };

    // Type-specific simulation
    if (listener.type === "shell") {
      result.command = listener.command;
      result.payloadSize = payloadSize;
      if (!listener.command) result.errors.push("Missing command field");
    } else if (listener.type === "template") {
      result.path = listener.path;
      if (!listener.path) result.errors.push("Missing path field");
    } else if (listener.type === "mcp") {
      result.server = listener.server;
      result.tool = listener.tool;
      // Simulate args_mapping substitution
      if (listener.args_mapping) {
        const args: Record<string, unknown> = {};
        for (const [key, template] of Object.entries(listener.args_mapping)) {
          // Replace ${data.X} with actual values
          args[key] = template.replace(/\$\{data\.(\w+)\}/g, (_, field) => {
            const val = data[field];
            return val !== undefined ? String(val) : `<missing: data.${field}>`;
          });
        }
        result.args = args;
      }
      if (!listener.server) result.errors.push("Missing server field");
      if (!listener.tool) result.errors.push("Missing tool field");
    }

    results.push(result);
  }

  return {
    event,
    listener_count: results.length,
    listeners: results,
    errors,
    success: errors.length === 0 && results.every((r) => r.errors.length === 0),
  };
}

export function formatTestOutput(result: TestResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`Event: ${result.event}`);
  lines.push(`Listeners: ${result.listener_count}`);
  lines.push("");

  // Listener details
  if (result.listeners.length === 0) {
    lines.push("No listeners registered for this event.");
  } else {
    for (let i = 0; i < result.listeners.length; i++) {
      const listener = result.listeners[i];
      lines.push(`[${i + 1}] ${listener.name} (${listener.type}) [priority ${listener.priority}]`);

      // Type-specific details
      if (listener.type === "shell") {
        lines.push(`    command: ${listener.command || "(missing)"}`);
        if (listener.payloadSize !== undefined) {
          lines.push(`    payload size: ${listener.payloadSize} bytes`);
        }
      } else if (listener.type === "template") {
        lines.push(`    path: ${listener.path || "(missing)"}`);
      } else if (listener.type === "mcp") {
        lines.push(`    server: ${listener.server || "(missing)"}`);
        lines.push(`    tool: ${listener.tool || "(missing)"}`);
        if (listener.args) {
          lines.push(`    args: ${JSON.stringify(listener.args)}`);
        }
      }

      if (listener.timeout !== undefined) {
        lines.push(`    timeout: ${listener.timeout}ms`);
      }

      // Warnings
      if (listener.warnings.length > 0) {
        for (const warning of listener.warnings) {
          lines.push(`    WARNING: ${warning}`);
        }
      }

      // Errors
      if (listener.errors.length > 0) {
        for (const error of listener.errors) {
          lines.push(`    ERROR: ${error}`);
        }
      }

      if (i < result.listeners.length - 1) {
        lines.push("");
      }
    }
  }

  // Footer
  lines.push("");
  if (result.errors.length > 0) {
    lines.push("Overall errors:");
    for (const error of result.errors) {
      lines.push(`  ERROR: ${error}`);
    }
  }

  if (result.success) {
    lines.push("Status: OK (all listeners valid)");
  } else {
    lines.push("Status: FAILED (errors detected)");
  }

  return lines.join("\n");
}
