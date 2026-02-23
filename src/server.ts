import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadAndMergeConfig } from "./config/loader.js";
import { validateConfig } from "./config/validator.js";
import type { AgentHooksConfig } from "./types.js";

interface ToolModule {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, config: AgentHooksConfig) => Promise<unknown>;
}

export async function createServer(): Promise<{
  server: Server;
  config: AgentHooksConfig;
}> {
  const config = loadAndMergeConfig();
  const errors = validateConfig(config);
  if (errors.length > 0) {
    for (const err of errors) {
      const loc = err.line ? ` (line ${err.line})` : "";
      process.stderr.write(`${err.file}${loc}: ${err.message}\n`);
    }
    throw new Error("Config validation failed");
  }

  const server = new Server(
    { name: "agent-hooks", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Dynamic tool loading from tools/ directory
  const toolsDir = path.join(__dirname, "tools");
  const tools = new Map<string, ToolModule>();

  if (fs.existsSync(toolsDir)) {
    for (const file of fs.readdirSync(toolsDir)) {
      if (!file.endsWith(".js")) continue;
      const mod = await import(path.join(toolsDir, file));
      // Handle CJS/ESM interop: dynamic import() of CJS wraps in extra .default
      const resolved = mod.default?.default ?? mod.default;
      const entries: ToolModule[] = Array.isArray(resolved)
        ? resolved
        : [resolved];
      for (const tool of entries) {
        if (tool?.name && typeof tool?.handler === "function") {
          tools.set(tool.name, tool);
        }
      }
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.get(request.params.name);
    if (!tool) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Unknown tool: ${request.params.name}` }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(
        (request.params.arguments ?? {}) as Record<string, unknown>,
        config
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ error: message }) },
        ],
        isError: true,
      };
    }
  });

  return { server, config };
}
