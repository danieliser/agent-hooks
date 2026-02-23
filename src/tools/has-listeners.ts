import type { AgentHooksConfig, HasListenersResponse } from "../types.js";
import { findListeners } from "../events/dispatcher.js";

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

    const listeners = await findListeners(event, undefined, config);

    return {
      event,
      has_listeners: listeners.length > 0,
      listener_count: listeners.length,
      priorities: listeners.map((l) => l.priority).sort((a, b) => a - b),
    };
  },
};

export default tool;
