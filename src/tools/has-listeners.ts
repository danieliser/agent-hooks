import type { AgentHooksConfig, HasListenersResponse } from "../types.js";

const tool = {
  name: "has_listeners",
  description:
    "Query whether listeners are registered for an event name. Useful for conditional logic to avoid overhead of emit() if no listeners.",
  inputSchema: {
    type: "object",
    properties: {
      event: {
        type: "string",
        description: "Event name to query (no wildcards).",
      },
    },
    required: ["event"],
  },

  async handler(
    args: Record<string, unknown>,
    config: AgentHooksConfig
  ): Promise<HasListenersResponse> {
    const event = args.event as string;

    if (!event || typeof event !== "string") {
      throw new Error("'event' is required and must be a string");
    }

    const listeners = findMatchingListeners(event, config);

    return {
      event,
      has_listeners: listeners.length > 0,
      listener_count: listeners.length,
      priorities: listeners.map((l) => l.priority).sort((a, b) => a - b),
    };
  },
};

function findMatchingListeners(
  event: string,
  config: AgentHooksConfig
): Array<{ priority: number }> {
  if (!config.events) return [];

  const matches: Array<{ priority: number }> = [];

  for (const [pattern, listeners] of Object.entries(config.events)) {
    if (pattern === event) {
      matches.push(...listeners);
    } else if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      if (event.startsWith(prefix + ".")) {
        matches.push(...listeners);
      }
    }
  }

  return matches;
}

export default tool;
