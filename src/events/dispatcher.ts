import { v4 as uuidv4 } from "uuid";
import type {
  AgentHooksConfig,
  EmitResponse,
  EmitAsyncResponse,
  ListenerConfig,
  ListenerResponse,
  ListenerError,
} from "../types.js";
import { MAX_PAYLOAD_SIZE_BYTES, DEFAULT_TIMEOUT_MS } from "../config/schema.js";
import { executeShellListener } from "../listeners/shell-listener.js";
import { executeTemplateListener } from "../listeners/template-listener.js";
import { executeMcpListener } from "../listeners/mcp-listener.js";
import { logEmit } from "../utils/logger.js";
import { debugDispatcher } from "../utils/debug.js";
import { evaluateCondition } from "../utils/conditions.js";

export async function dispatch(
  event: string,
  data: Record<string, unknown> | undefined,
  timeout: number | undefined,
  config: AgentHooksConfig
): Promise<EmitResponse> {
  const startTime = Date.now();
  const invocationId = `evt-${uuidv4().slice(0, 12)}`;
  const effectiveTimeout = timeout ?? config.default_timeout ?? DEFAULT_TIMEOUT_MS;
  debugDispatcher("emit event=%s invocation_id=%s", event, invocationId);

  // Enforce 10KB payload limit
  if (data !== undefined) {
    const payloadSize = Buffer.byteLength(JSON.stringify(data), "utf-8");
    if (payloadSize > MAX_PAYLOAD_SIZE_BYTES) {
      throw new Error(
        `Event payload exceeds ${MAX_PAYLOAD_SIZE_BYTES / 1024}KB limit (${Math.round(payloadSize / 1024)}KB)`
      );
    }
  }

  // Find matching listeners
  const listeners = await findListeners(event, data, config);
  debugDispatcher("found %d matching listeners", listeners.length);

  if (listeners.length === 0) {
    const response: EmitResponse = {
      event,
      invocation_id: invocationId,
      executed_at: new Date().toISOString(),
      listeners_executed: 0,
      responses: [],
      errors: [],
      duration_ms: Date.now() - startTime,
      timed_out: false,
    };
    logEmit(response);
    return response;
  }

  // Execute listeners in priority order with overall timeout
  const responses: ListenerResponse[] = [];
  const errors: ListenerError[] = [];
  let timedOut = false;

  for (const listener of listeners) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= effectiveTimeout) {
      timedOut = true;
      break;
    }

    const remainingTime = effectiveTimeout - elapsed;
    const listenerTimeout = Math.min(
      listener.timeout ?? effectiveTimeout,
      remainingTime
    );

    try {
      debugDispatcher("executing listener priority=%d name=%s type=%s", listener.priority, listener.name, listener.type);
      const result = await executeListener(
        listener,
        event,
        invocationId,
        data ?? {},
        listenerTimeout,
        config
      );
      debugDispatcher("listener result status=%s duration=%dms", result.status, result.duration_ms);
      responses.push(result);

      if (result.status === "error" || result.status === "timeout") {
        if (result.error) {
          errors.push(result.error);
        }
      }
    } catch (err) {
      // Error isolation: one listener failure doesn't block others
      const error: ListenerError = {
        listener_id: listener.name,
        type: "execution_error",
        message: err instanceof Error ? err.message : String(err),
        details: err instanceof Error ? err.stack : undefined,
      };
      errors.push(error);
      responses.push({
        listener_id: listener.name,
        name: listener.name,
        type: listener.type,
        priority: listener.priority,
        status: "error",
        result: null,
        duration_ms: 0,
        error,
      });
    }
  }

  const response: EmitResponse = {
    event,
    invocation_id: invocationId,
    executed_at: new Date().toISOString(),
    listeners_executed: responses.length,
    responses,
    errors,
    duration_ms: Date.now() - startTime,
    timed_out: timedOut,
  };

  debugDispatcher("dispatch complete listeners=%d errors=%d duration=%dms", responses.length, errors.length, response.duration_ms);
  logEmit(response);
  return response;
}

export async function dispatchAsync(
  event: string,
  data: Record<string, unknown> | undefined,
  timeout: number | undefined,
  config: AgentHooksConfig
): Promise<EmitAsyncResponse> {
  const invocationId = `evt-${uuidv4().slice(0, 12)}`;

  // Enforce 10KB payload limit
  if (data !== undefined) {
    const payloadSize = Buffer.byteLength(JSON.stringify(data), "utf-8");
    if (payloadSize > MAX_PAYLOAD_SIZE_BYTES) {
      throw new Error(
        `Event payload exceeds ${MAX_PAYLOAD_SIZE_BYTES / 1024}KB limit (${Math.round(payloadSize / 1024)}KB)`
      );
    }
  }

  const listeners = await findListeners(event, data, config);
  debugDispatcher("async emit event=%s listeners=%d", event, listeners.length);

  // Fire and forget — run dispatch in background, don't await
  if (listeners.length > 0) {
    dispatch(event, data, timeout, config).catch(() => {
      // Errors logged by dispatch/logEmit — swallow here
    });
  }

  return {
    event,
    mode: "async",
    invocation_id: invocationId,
    status: "enqueued",
    listeners_registered: listeners.length,
    message: `${listeners.length} listener(s) will execute in background`,
  };
}

export async function findListeners(
  event: string,
  data: Record<string, unknown> | undefined,
  config: AgentHooksConfig
): Promise<ListenerConfig[]> {
  if (!config.events) return [];

  const listeners: ListenerConfig[] = [];

  for (const [pattern, eventListeners] of Object.entries(config.events)) {
    if (matchesEvent(pattern, event)) {
      for (const listener of eventListeners) {
        if (!listener.when) {
          listeners.push(listener); // No condition, always execute
        } else {
          const matched = await evaluateCondition(listener.when, data ?? {});
          if (matched) {
            listeners.push(listener);
          } else {
            debugDispatcher("listener %s skipped by condition: %s", listener.name, listener.when);
          }
        }
      }
    }
  }

  // Sort by priority (already sorted per-event, but after merging wildcards we need to re-sort)
  return listeners.sort((a, b) => a.priority - b.priority);
}

/**
 * Returns ALL listeners matching an event pattern, ignoring `when` conditions.
 * Used by the test command to show which listeners would match and display
 * condition evaluation results (matched/skipped) for debugging.
 */
export function findAllListenersForEvent(
  event: string,
  config: AgentHooksConfig
): ListenerConfig[] {
  if (!config.events) return [];

  const listeners: ListenerConfig[] = [];

  for (const [pattern, eventListeners] of Object.entries(config.events)) {
    if (matchesEvent(pattern, event)) {
      listeners.push(...eventListeners);
    }
  }

  return listeners.sort((a, b) => a.priority - b.priority);
}

export function matchesEvent(pattern: string, event: string): boolean {
  // Exact match
  if (pattern === event) return true;

  // Wildcard: "strategize.*" matches "strategize.spec.drafted"
  // Single-level wildcard only per spec Section 8
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return event.startsWith(prefix + ".");
  }

  return false;
}

async function executeListener(
  listener: ListenerConfig,
  event: string,
  invocationId: string,
  data: Record<string, unknown>,
  timeout: number,
  config: AgentHooksConfig
): Promise<ListenerResponse> {
  switch (listener.type) {
    case "shell":
      return executeShellListener(listener, event, invocationId, data, timeout, config);
    case "template":
      return executeTemplateListener(listener, event, data);
    case "mcp":
      return executeMcpListener(listener, event, data);
    default:
      throw new Error(`Unknown listener type: ${listener.type}`);
  }
}
