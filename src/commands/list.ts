import type { AgentHooksConfig, ListenerType } from "../types.js";

export interface ListEventEntry {
  event: string;
  listener_count: number;
  min_priority: number | null;
  enabled: boolean;
  listeners?: {
    name: string;
    type: ListenerType;
    priority: number;
  }[];
}

export function listEvents(
  config: AgentHooksConfig,
  pattern?: string
): ListEventEntry[] {
  const entries: ListEventEntry[] = [];

  // Get all event names from config
  const eventNames = Object.keys(config.events ?? {});

  // Filter by pattern if provided
  let filteredNames = eventNames;
  if (pattern) {
    if (pattern.endsWith(".*")) {
      // Wildcard pattern: agent.workflow.* matches agent.workflow.step_completed
      const prefix = pattern.slice(0, -2); // Remove .* suffix
      filteredNames = eventNames.filter((name) => name.startsWith(prefix + "."));
    } else {
      // Exact match
      filteredNames = eventNames.filter((name) => name === pattern);
    }
  }

  // Build entries for each matching event
  for (const eventName of filteredNames) {
    const listeners = config.events[eventName] ?? [];
    const minPriority =
      listeners.length > 0 ? Math.min(...listeners.map((l) => l.priority)) : null;

    entries.push({
      event: eventName,
      listener_count: listeners.length,
      min_priority: minPriority,
      enabled: config.enabled ?? true,
      listeners: listeners.map((l) => ({
        name: l.name,
        type: l.type,
        priority: l.priority,
      })),
    });
  }

  // Sort by event name alphabetically
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
