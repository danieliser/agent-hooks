import type { AgentHooksConfig, ListenerType, EventEntry } from "../types.js";
import { isChainConfig } from "../types.js";

export interface ListEventEntry {
  event: string;
  listener_count: number;
  min_priority: number | null;
  enabled: boolean;
  listeners?: {
    name: string;
    type: ListenerType | "chain";
    priority: number;
    chain_members?: number;
  }[];
}

function countListeners(entries: EventEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (isChainConfig(entry)) {
      count += entry.chain.length;
    } else {
      count++;
    }
  }
  return count;
}

export function listEvents(
  config: AgentHooksConfig,
  pattern?: string
): ListEventEntry[] {
  const entries: ListEventEntry[] = [];

  const eventNames = Object.keys(config.events ?? {});

  let filteredNames = eventNames;
  if (pattern) {
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      filteredNames = eventNames.filter((name) => name.startsWith(prefix + "."));
    } else {
      filteredNames = eventNames.filter((name) => name === pattern);
    }
  }

  for (const eventName of filteredNames) {
    const eventEntries = config.events[eventName] ?? [];
    const minPriority =
      eventEntries.length > 0 ? Math.min(...eventEntries.map((e) => e.priority)) : null;

    entries.push({
      event: eventName,
      listener_count: countListeners(eventEntries),
      min_priority: minPriority,
      enabled: config.enabled ?? true,
      listeners: eventEntries.map((e) => {
        if (isChainConfig(e)) {
          return {
            name: e.chain[0]?.name ?? "chain",
            type: "chain" as const,
            priority: e.priority,
            chain_members: e.chain.length,
          };
        }
        return { name: e.name, type: e.type, priority: e.priority };
      }),
    });
  }

  entries.sort((a, b) => a.event.localeCompare(b.event));

  return entries;
}

export function formatAsTable(entries: ListEventEntry[]): string {
  if (entries.length === 0) {
    return "Event | Listeners | Min Priority | Enabled\n------+----------+--------------+--------\nNo events\n";
  }

  // Calculate column widths
  const headers = ["Event", "Listeners", "Min Priority", "Enabled"];
  const rows = entries.map((e) => [
    e.event,
    String(e.listener_count),
    e.min_priority === null ? "-" : String(e.min_priority),
    String(e.enabled),
  ]);

  const colWidths = headers.map((header, i) => {
    const maxLen = Math.max(header.length, ...rows.map((row) => row[i].length));
    return maxLen;
  });

  // Build header
  const headerLine = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join(" | ");
  const separatorLine = colWidths.map((w) => "-".repeat(w)).join("-+-");

  // Build data rows
  const dataLines = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ")
  );

  return [headerLine, separatorLine, ...dataLines].join("\n") + "\n";
}

export function formatAsJson(entries: ListEventEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
