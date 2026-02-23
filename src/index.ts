import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  // --validate is handled by cli.ts now, but keep backward compat
  if (process.argv.includes("--validate")) {
    const { loadAndMergeConfig } = await import("./config/loader.js");
    const { validateConfig } = await import("./config/validator.js");
    const config = loadAndMergeConfig();
    const errors = validateConfig(config);

    if (errors.length === 0) {
      const eventCount = Object.keys(config.events ?? {}).length;
      const listenerCount = Object.values(config.events ?? {}).reduce(
        (sum, listeners) => sum + listeners.length,
        0
      );
      process.stdout.write(
        `agent-hooks config valid: ${eventCount} events, ${listenerCount} listeners\n`
      );
      process.exit(0);
    } else {
      process.stderr.write("agent-hooks config validation failed:\n");
      for (const err of errors) {
        const loc = err.line ? ` (line ${err.line})` : "";
        process.stderr.write(`  ${err.file}${loc}: ${err.message}\n`);
      }
      process.exit(1);
    }
  }

  // Normal MCP server mode
  const { server } = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`agent-hooks fatal: ${err.message}\n`);
  process.exit(1);
});
