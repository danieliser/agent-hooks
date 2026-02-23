import { describe, it, expect } from "vitest";
import { listEvents, formatAsTable, formatAsJson } from "../../src/commands/list.js";
import type { AgentHooksConfig } from "../../src/types.js";

describe("listEvents", () => {
  const baseConfig: AgentHooksConfig = {
    events: {
      "agent.workflow.step_completed": [
        { name: "notify", type: "shell", command: "notify.sh", priority: 5 },
        { name: "log", type: "template", path: "log.md", priority: 10 },
      ],
      "strategize.spec.drafted": [
        { name: "create-adr", type: "mcp", server: "server-a", tool: "tool-a", priority: 15 },
      ],
      "paop.panel.voting_started": [],
    },
    enabled: true,
  };

  it("lists all events from config with correct counts", () => {
    const entries = listEvents(baseConfig);
    expect(entries).toHaveLength(3);
    expect(entries[0].event).toBe("agent.workflow.step_completed");
    expect(entries[0].listener_count).toBe(2);
    expect(entries[1].event).toBe("paop.panel.voting_started");
    expect(entries[1].listener_count).toBe(0);
    expect(entries[2].event).toBe("strategize.spec.drafted");
    expect(entries[2].listener_count).toBe(1);
  });

  it("filters by exact event name", () => {
    const entries = listEvents(baseConfig, "agent.workflow.step_completed");
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("agent.workflow.step_completed");
  });

  it("filters by wildcard pattern", () => {
    const entries = listEvents(baseConfig, "agent.workflow.*");
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe("agent.workflow.step_completed");
  });

  it("filters by wildcard pattern with multiple matches", () => {
    const config: AgentHooksConfig = {
      events: {
        "agent.workflow.start": [{ name: "a", type: "shell", command: "a.sh", priority: 1 }],
        "agent.workflow.end": [{ name: "b", type: "shell", command: "b.sh", priority: 2 }],
        "agent.task.start": [{ name: "c", type: "shell", command: "c.sh", priority: 3 }],
      },
      enabled: true,
    };
    const entries = listEvents(config, "agent.workflow.*");
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.event)).toContain("agent.workflow.start");
    expect(entries.map((e) => e.event)).toContain("agent.workflow.end");
  });

  it("returns empty array for no matches", () => {
    const entries = listEvents(baseConfig, "nonexistent.event");
    expect(entries).toHaveLength(0);
  });

  it("sorts events alphabetically", () => {
    const entries = listEvents(baseConfig);
    const eventNames = entries.map((e) => e.event);
    expect(eventNames).toEqual([...eventNames].sort());
  });

  it("calculates min priority correctly", () => {
    const entries = listEvents(baseConfig);
    const agentWorkflow = entries.find((e) => e.event === "agent.workflow.step_completed");
    expect(agentWorkflow?.min_priority).toBe(5); // lowest priority
    const voting = entries.find((e) => e.event === "paop.panel.voting_started");
    expect(voting?.min_priority).toBeNull(); // no listeners
  });

  it("includes enabled status from config", () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [{ name: "listener", type: "shell", command: "test.sh", priority: 10 }],
      },
      enabled: false,
    };
    const entries = listEvents(config);
    expect(entries[0].enabled).toBe(false);
  });

  it("defaults enabled to true when not specified", () => {
    const config: AgentHooksConfig = {
      events: {
        "test.event": [{ name: "listener", type: "shell", command: "test.sh", priority: 10 }],
      },
    };
    const entries = listEvents(config);
    expect(entries[0].enabled).toBe(true);
  });

  it("includes listeners array with name, type, priority", () => {
    const entries = listEvents(baseConfig);
    const agentWorkflow = entries.find((e) => e.event === "agent.workflow.step_completed");
    expect(agentWorkflow?.listeners).toHaveLength(2);
    expect(agentWorkflow?.listeners?.[0]).toEqual({
      name: "notify",
      type: "shell",
      priority: 5,
    });
    expect(agentWorkflow?.listeners?.[1]).toEqual({
      name: "log",
      type: "template",
      priority: 10,
    });
  });
});

describe("formatAsTable", () => {
  it("generates ASCII table with header and separator", () => {
    const entries = [
      {
        event: "test.event",
        listener_count: 2,
        min_priority: 5,
        enabled: true,
      },
    ];
    const table = formatAsTable(entries);
    expect(table).toContain("Event");
    expect(table).toContain("Listeners");
    expect(table).toContain("Min Priority");
    expect(table).toContain("Enabled");
    expect(table).toContain("test.event");
    expect(table).toContain("2");
    expect(table).toContain("5");
    expect(table).toContain("true");
    // Check for separator line (dashes separated by + and -)
    expect(table).toMatch(/-+-/m);
  });

  it("pads columns for alignment", () => {
    const entries = [
      {
        event: "a.b.c.d.e.f",
        listener_count: 1,
        min_priority: 10,
        enabled: true,
      },
      {
        event: "x",
        listener_count: 99,
        min_priority: 0,
        enabled: false,
      },
    ];
    const table = formatAsTable(entries);
    const lines = table.split("\n");
    // All lines should have similar alignment
    expect(lines.length).toBeGreaterThan(2);
  });

  it("handles empty entries list", () => {
    const table = formatAsTable([]);
    expect(table).toContain("Event");
    expect(table).toContain("No events");
  });
});

describe("formatAsJson", () => {
  it("returns valid JSON", () => {
    const entries = [
      {
        event: "test.event",
        listener_count: 2,
        min_priority: 5,
        enabled: true,
      },
    ];
    const json = formatAsJson(entries);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(entries);
  });

  it("has proper indentation", () => {
    const entries = [
      {
        event: "test.event",
        listener_count: 1,
        min_priority: 10,
        enabled: true,
      },
    ];
    const json = formatAsJson(entries);
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });
});
