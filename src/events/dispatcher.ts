import { v4 as uuidv4 } from "uuid";
import type {
  AgentHooksConfig,
  EmitResponse,
  EmitAsyncResponse,
  ListenerConfig,
  ListenerResponse,
  ListenerError,
  EventEntry,
  ChainConfig,
} from "../types.js";
import { isChainConfig } from "../types.js";
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

  // Find matching entries (listeners + chains)
  const entries = await findEntries(event, data, config);
  debugDispatcher("found %d matching entries", entries.length);

  if (entries.length === 0) {
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

  // Execute entries in priority order with overall timeout
  const responses: ListenerResponse[] = [];
  const errors: ListenerError[] = [];
  let timedOut = false;

  for (const entry of entries) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= effectiveTimeout) {
      timedOut = true;
      break;
    }

    const remainingTime = effectiveTimeout - elapsed;

    if (isChainConfig(entry)) {
      const chainTimeout = Math.min(entry.timeout ?? effectiveTimeout, remainingTime);
      debugDispatcher("executing chain with %d members, priority=%d", entry.chain.length, entry.priority);
      const chainResults = await executeChain(entry, event, invocationId, data ?? {}, chainTimeout, config);
      responses.push(...chainResults.responses);
      errors.push(...chainResults.errors);
      if (chainResults.timedOut) {
        timedOut = true;
        break;
      }
    } else {
      const listenerTimeout = Math.min(entry.timeout ?? effectiveTimeout, remainingTime);
      try {
        debugDispatcher("executing listener priority=%d name=%s type=%s", entry.priority, entry.name, entry.type);
        const result = await executeListener(entry, event, invocationId, data ?? {}, listenerTimeout, config);
        debugDispatcher("listener result status=%s duration=%dms", result.status, result.duration_ms);
        responses.push(result);

        if (result.status === "error" || result.status === "timeout") {
          if (result.error) {
            errors.push(result.error);
          }
        }
      } catch (err) {
        const error: ListenerError = {
          listener_id: entry.name,
          type: "execution_error",
          message: err instanceof Error ? err.message : String(err),
          details: err instanceof Error ? err.stack : undefined,
        };
        errors.push(error);
        responses.push({
          listener_id: entry.name,
          name: entry.name,
          type: entry.type,
          priority: entry.priority,
          status: "error",
          result: null,
          duration_ms: 0,
          error,
        });
      }
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

async function executeChain(
  chain: ChainConfig,
  event: string,
  invocationId: string,
  data: Record<string, unknown>,
  timeout: number,
  config: AgentHooksConfig
): Promise<{ responses: ListenerResponse[]; errors: ListenerError[]; timedOut: boolean }> {
  const chainStart = Date.now();
  const responses: ListenerResponse[] = [];
  const errors: ListenerError[] = [];
  const chainResults: ListenerResponse[] = []; // accumulated for _chain_results

  for (const member of chain.chain) {
    const elapsed = Date.now() - chainStart;
    if (elapsed >= timeout) {
      debugDispatcher("chain timed out after %d members", responses.length);
      return { responses, errors, timedOut: true };
    }

    const remainingTime = timeout - elapsed;
    const memberTimeout = Math.min(member.timeout ?? timeout, remainingTime);

    // Build enriched data with chain results
    const enrichedData: Record<string, unknown> = {
      ...data,
      _chain_results: [...chainResults],
    };

    try {
      debugDispatcher("executing chain member name=%s type=%s", member.name, member.type);
      const result = await executeListener(member, event, invocationId, enrichedData, memberTimeout, config);
      debugDispatcher("chain member result status=%s duration=%dms", result.status, result.duration_ms);
      responses.push(result);
      chainResults.push(result);

      // Fail-fast: stop chain on error or timeout
      if (result.status === "error" || result.status === "timeout") {
        debugDispatcher("chain stopped: member %s returned %s", member.name, result.status);
        if (result.error) errors.push(result.error);
        break;
      }
    } catch (err) {
      const error: ListenerError = {
        listener_id: member.name,
        type: "chain_execution_error",
        message: err instanceof Error ? err.message : String(err),
        details: err instanceof Error ? err.stack : undefined,
      };
      errors.push(error);
      responses.push({
        listener_id: member.name,
        name: member.name,
        type: member.type,
        priority: member.priority,
        status: "error",
        result: null,
        duration_ms: 0,
        error,
      });
      debugDispatcher("chain stopped: member %s threw error", member.name);
      break; // fail-fast
    }
  }

  return { responses, errors, timedOut: false };
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

  const entries = await findEntries(event, data, config);
  debugDispatcher("async emit event=%s entries=%d", event, entries.length);

  // Fire and forget — run dispatch in background, don't await
  if (entries.length > 0) {
    dispatch(event, data, timeout, config).catch(() => {
      // Errors logged by dispatch/logEmit — swallow here
    });
  }

  return {
    event,
    mode: "async",
    invocation_id: invocationId,
    status: "enqueued",
    listeners_registered: entries.length,
    message: `${entries.length} entry(ies) will execute in background`,
  };
}

/**
 * Find matching event entries (listeners + chains), filtering by conditions.
 * Chains with a `when:` that doesn't match are excluded entirely.
 */
export async function findEntries(
  event: string,
  data: Record<string, unknown> | undefined,
  config: AgentHooksConfig
): Promise<EventEntry[]> {
  if (!config.events) return [];

  const entries: EventEntry[] = [];

  for (const [pattern, eventEntries] of Object.entries(config.events)) {
    if (matchesEvent(pattern, event)) {
      for (const entry of eventEntries) {
        const when = isChainConfig(entry) ? entry.when : entry.when;
        if (!when) {
          entries.push(entry);
        } else {
          const matched = await evaluateCondition(when, data ?? {});
          if (matched) {
            entries.push(entry);
          } else {
            const label = isChainConfig(entry) ? `chain(${entry.chain.length} members)` : entry.name;
            debugDispatcher("%s skipped by condition: %s", label, when);
          }
        }
      }
    }
  }

  return entries.sort((a, b) => a.priority - b.priority);
}

/**
 * Returns ALL entries matching an event pattern, ignoring `when` conditions.
 * Used by the test command to show which entries would match and display
 * condition evaluation results (matched/skipped) for debugging.
 */
export function findAllEntriesForEvent(
  event: string,
  config: AgentHooksConfig
): EventEntry[] {
  if (!config.events) return [];

  const entries: EventEntry[] = [];

  for (const [pattern, eventEntries] of Object.entries(config.events)) {
    if (matchesEvent(pattern, event)) {
      entries.push(...eventEntries);
    }
  }

  return entries.sort((a, b) => a.priority - b.priority);
}

// Backward-compat aliases — existing code that imports these still works
export async function findListeners(
  event: string,
  data: Record<string, unknown> | undefined,
  config: AgentHooksConfig
): Promise<EventEntry[]> {
  return findEntries(event, data, config);
}

export function findAllListenersForEvent(
  event: string,
  config: AgentHooksConfig
): EventEntry[] {
  return findAllEntriesForEvent(event, config);
}

export function matchesEvent(pattern: string, event: string): boolean {
  if (pattern === event) return true;

  // Wildcard: "strategize.*" matches "strategize.spec.drafted"
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
