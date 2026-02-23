import type { AgentHooksConfig, ListenerConfig, ListenerType, EventEntry } from "../types.js";
import { isChainConfig } from "../types.js";
import { findListeners, findAllListenersForEvent } from "../events/dispatcher.js";
import { MAX_PAYLOAD_SIZE_BYTES } from "../config/schema.js";
import { evaluateCondition } from "../utils/conditions.js";

export interface TestResult {
  event: string;
  listener_count: number;
  listeners: TestListenerResult[];
  chains: TestChainResult[];
  errors: string[];
  success: boolean;
}

export interface TestListenerResult {
  name: string;
  type: ListenerType;
  priority: number;
  conditionalMatched?: boolean;
  when?: string;
  command?: string;
  path?: string;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  payloadSize?: number;
  timeout?: number;
  warnings: string[];
  errors: string[];
}

export interface TestChainResult {
  priority: number;
  when?: string;
  conditionalMatched?: boolean;
  timeout?: number;
  members: TestListenerResult[];
  warnings: string[];
  errors: string[];
}

function buildListenerResult(
  listener: ListenerConfig,
  data: Record<string, unknown>,
  payloadSize: number,
  showConditions: boolean
): TestListenerResult {
  const result: TestListenerResult = {
    name: listener.name,
    type: listener.type,
    priority: listener.priority,
    timeout: listener.timeout,
    warnings: [],
    errors: [],
  };

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
    if (listener.args_mapping) {
      const args: Record<string, unknown> = {};
      for (const [key, template] of Object.entries(listener.args_mapping)) {
        args[key] = template.replace(/\$\{data\.([^}]+)\}/g, (_, fieldPath) => {
          const val = fieldPath.split(".").reduce((obj: any, key: string) => obj?.[key], data);
          return val !== undefined ? String(val) : `<missing: data.${fieldPath}>`;
        });
      }
      result.args = args;
    }
    if (!listener.server) result.errors.push("Missing server field");
    if (!listener.tool) result.errors.push("Missing tool field");
  }

  return result;
}

export async function testEmit(
  event: string,
  data: Record<string, unknown>,
  config: AgentHooksConfig,
  showConditions: boolean = false
): Promise<TestResult> {
  const entries: EventEntry[] = showConditions
    ? findAllListenersForEvent(event, config)
    : await findListeners(event, data, config);
  const payloadSize = Buffer.byteLength(JSON.stringify(data), "utf-8");
  const listenerResults: TestListenerResult[] = [];
  const chainResults: TestChainResult[] = [];
  const errors: string[] = [];

  if (payloadSize > MAX_PAYLOAD_SIZE_BYTES) {
    errors.push(
      `Payload exceeds ${MAX_PAYLOAD_SIZE_BYTES / 1024}KB limit (${Math.round(payloadSize / 1024)}KB)`
    );
  }

  for (const entry of entries) {
    if (isChainConfig(entry)) {
      const chainResult: TestChainResult = {
        priority: entry.priority,
        timeout: entry.timeout,
        members: entry.chain.map((m) => buildListenerResult(m, data, payloadSize, showConditions)),
        warnings: [],
        errors: [],
      };

      if (showConditions && entry.when) {
        chainResult.when = entry.when;
        chainResult.conditionalMatched = await evaluateCondition(entry.when, data);
      }

      chainResults.push(chainResult);
    } else {
      const result = buildListenerResult(entry, data, payloadSize, showConditions);

      if (showConditions && entry.when) {
        result.when = entry.when;
        result.conditionalMatched = await evaluateCondition(entry.when, data);
      }

      listenerResults.push(result);
    }
  }

  const allListenerErrors = listenerResults.every((r) => r.errors.length === 0);
  const allChainErrors = chainResults.every(
    (c) => c.errors.length === 0 && c.members.every((m) => m.errors.length === 0)
  );

  return {
    event,
    listener_count: listenerResults.length + chainResults.reduce((sum, c) => sum + c.members.length, 0),
    listeners: listenerResults,
    chains: chainResults,
    errors,
    success: errors.length === 0 && allListenerErrors && allChainErrors,
  };
}

export function formatTestOutput(result: TestResult): string {
  const lines: string[] = [];

  lines.push(`Event: ${result.event}`);
  lines.push(`Listeners: ${result.listener_count}`);
  lines.push("");

  const hasListeners = (result.listeners?.length ?? 0) > 0 || (result.chains?.length ?? 0) > 0;
  if (!hasListeners) {
    lines.push("No listeners registered for this event.");
  }

  let idx = 1;

  // Independent listeners
  for (const listener of result.listeners ?? []) {
    lines.push(`[${idx}] ${listener.name} (${listener.type}) [priority ${listener.priority}]`);
    formatListenerDetails(listener, lines);
    idx++;
    lines.push("");
  }

  // Chains
  for (const chain of result.chains ?? []) {
    lines.push(`[${idx}] chain (${chain.members.length} members) [priority ${chain.priority}]`);

    if (chain.when) {
      lines.push(`    when: ${chain.when}`);
      if (chain.conditionalMatched === true) {
        lines.push(`    \u2713 condition met`);
      } else if (chain.conditionalMatched === false) {
        lines.push(`    \u2717 condition not met \u2014 chain skipped`);
      }
    }

    if (chain.timeout !== undefined) {
      lines.push(`    timeout: ${chain.timeout}ms`);
    }

    for (let j = 0; j < chain.members.length; j++) {
      const member = chain.members[j];
      const arrow = j === 0 ? "\u2514" : "\u2514";
      lines.push(`    ${j < chain.members.length - 1 ? "\u251C" : "\u2514"} [${j + 1}] ${member.name} (${member.type})`);
      formatListenerDetails(member, lines, "      ");
    }

    idx++;
    lines.push("");
  }

  // Footer
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

function formatListenerDetails(
  listener: TestListenerResult,
  lines: string[],
  indent: string = "    "
): void {
  if (listener.type === "shell") {
    lines.push(`${indent}command: ${listener.command || "(missing)"}`);
    if (listener.payloadSize !== undefined) {
      lines.push(`${indent}payload size: ${listener.payloadSize} bytes`);
    }
  } else if (listener.type === "template") {
    lines.push(`${indent}path: ${listener.path || "(missing)"}`);
  } else if (listener.type === "mcp") {
    lines.push(`${indent}server: ${listener.server || "(missing)"}`);
    lines.push(`${indent}tool: ${listener.tool || "(missing)"}`);
    if (listener.args) {
      lines.push(`${indent}args: ${JSON.stringify(listener.args)}`);
    }
  }

  if (listener.when) {
    lines.push(`${indent}when: ${listener.when}`);
    if (listener.conditionalMatched === true) {
      lines.push(`${indent}\u2713 condition met`);
    } else if (listener.conditionalMatched === false) {
      lines.push(`${indent}\u2717 condition not met \u2014 listener skipped`);
    }
  }

  if (listener.timeout !== undefined) {
    lines.push(`${indent}timeout: ${listener.timeout}ms`);
  }

  for (const warning of listener.warnings) {
    lines.push(`${indent}WARNING: ${warning}`);
  }
  for (const error of listener.errors) {
    lines.push(`${indent}ERROR: ${error}`);
  }
}
