import { dispatch, dispatchAsync } from "../events/dispatcher.js";
import { EVENT_NAME_PATTERN, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS } from "../config/schema.js";
import type { AgentHooksConfig, EmitMode } from "../types.js";

const tool = {
  name: "emit",
  description:
    "Emit a named event to registered listeners. Returns results and any MCP tool call instructions for the agent to execute. Use mode 'async' to fire-and-forget.",
  inputSchema: {
    type: "object",
    properties: {
      event: {
        type: "string",
        description:
          "Event name in dot-notation snake_case. Examples: 'strategize.spec.drafted', 'panel.review.completed', 'execute.batch.done'.",
      },
      data: {
        type: "object",
        description:
          "Event payload. Passed to all listeners. Enforced max 10KB for performance.",
        additionalProperties: true,
      },
      timeout: {
        type: "integer",
        description:
          "Max milliseconds to wait for all listeners. Default: 5000. Ignored in async mode.",
        default: 5000,
        minimum: MIN_TIMEOUT_MS,
        maximum: MAX_TIMEOUT_MS,
      },
      mode: {
        type: "string",
        enum: ["sync", "async"],
        default: "sync",
        description:
          "'sync' waits for all listeners and returns results. 'async' returns immediately with invocation_id; listeners execute in background.",
      },
    },
    required: ["event"],
  },

  async handler(
    args: Record<string, unknown>,
    config: AgentHooksConfig
  ): Promise<unknown> {
    const event = args.event as string;
    const data = args.data as Record<string, unknown> | undefined;
    const timeout = args.timeout as number | undefined;
    const mode = (args.mode as EmitMode) ?? "sync";

    if (!event || typeof event !== "string") {
      throw new Error("'event' is required and must be a string");
    }

    if (!EVENT_NAME_PATTERN.test(event)) {
      throw new Error(
        `Invalid event name '${event}'. Must be dot-notation snake_case (e.g., 'domain.entity.action').`
      );
    }

    if (config.enabled === false) {
      return {
        event,
        invocation_id: "disabled",
        executed_at: new Date().toISOString(),
        listeners_executed: 0,
        responses: [],
        errors: [],
        duration_ms: 0,
        timed_out: false,
      };
    }

    if (mode === "async") {
      return dispatchAsync(event, data, timeout, config);
    }

    return dispatch(event, data, timeout, config);
  },
};

export default tool;
