import type { ListenerConfig, ListenerResponse, McpCall } from "../types.js";
import { debugMcpListener } from "../utils/debug.js";

/**
 * MCP listeners don't execute tool calls — they return instruction arrays.
 * The calling agent reads mcp_calls from the response and executes them.
 * CTO Condition #1: status is "pending_execution", not "success".
 */
export async function executeMcpListener(
  listener: ListenerConfig,
  event: string,
  data: Record<string, unknown>
): Promise<ListenerResponse> {
  const startTime = Date.now();

  if (!listener.server || !listener.tool) {
    return {
      listener_id: listener.name,
      name: listener.name,
      type: "mcp",
      priority: listener.priority,
      status: "error",
      result: null,
      duration_ms: 0,
      error: {
        listener_id: listener.name,
        type: "invalid_config",
        message: "MCP listener missing 'server' or 'tool'",
      },
    };
  }

  debugMcpListener("mcp server=%s tool=%s", listener.server, listener.tool);

  // Build args from args_mapping with substitution
  const args: Record<string, unknown> = {};
  if (listener.args_mapping) {
    for (const [key, template] of Object.entries(listener.args_mapping)) {
      args[key] = substituteTemplate(template, data);
    }
  }
  debugMcpListener("mapped args=%O", args);

  const mcpCall: McpCall = {
    server: listener.server,
    tool: listener.tool,
    args,
  };

  return {
    listener_id: listener.name,
    name: listener.name,
    type: "mcp",
    priority: listener.priority,
    status: "pending_execution", // CTO Condition #1
    result: {
      mcp_calls: [mcpCall],
    },
    duration_ms: Date.now() - startTime,
  };
}

function substituteTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  let result = template;
  result = result.replace(/\$\{data\.([^}]+)\}/g, (_, key) => {
    return String(data[key] ?? "");
  });
  result = result.replace(/\$\{env\.([^}]+)\}/g, (_, key) => {
    return process.env[key] ?? "";
  });
  return result;
}
