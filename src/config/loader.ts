import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentHooksConfig, ListenerConfig, EventEntry, ChainConfig } from "../types.js";
import { isChainConfig } from "../types.js";
import { PRIORITY_DEFAULT } from "./schema.js";
import { debugConfig } from "../utils/debug.js";

const GLOBAL_CONFIG_PATH = path.join(
  process.env.HOME ?? "~",
  ".claude",
  "agent-hooks.yml"
);
const PROJECT_CONFIG_PATH = path.join(".claude", "agent-hooks.yml");

function resolveHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(process.env.HOME ?? "", p.slice(1));
  }
  return p;
}

function loadYamlFile(filePath: string): AgentHooksConfig | null {
  const resolved = resolveHome(filePath);
  if (!fs.existsSync(resolved)) return null;
  const content = fs.readFileSync(resolved, "utf-8");
  if (!content.trim()) return null;
  return parseYaml(content) as AgentHooksConfig;
}

function autoGenerateName(listener: Partial<ListenerConfig>): string {
  if (listener.type === "shell" && listener.command) {
    return `shell-${path.basename(listener.command)}`;
  }
  if (listener.type === "template" && listener.path) {
    return `template-${path.basename(listener.path)}`;
  }
  if (listener.type === "mcp" && listener.server && listener.tool) {
    return `${listener.server}/${listener.tool}`;
  }
  return "unknown";
}

function getEntryName(entry: EventEntry): string {
  if (isChainConfig(entry)) {
    // Use first chain member's name as key, or generate one
    const first = entry.chain[0];
    return first ? `chain:${first.name || autoGenerateName(first)}` : "chain:unknown";
  }
  return entry.name || autoGenerateName(entry);
}

function mergeListeners(
  globalListeners: EventEntry[],
  projectListeners: EventEntry[]
): EventEntry[] {
  // Name-based dedup: build map from global, overlay project
  const byName = new Map<string, EventEntry>();

  for (const entry of globalListeners) {
    const name = getEntryName(entry);
    if (isChainConfig(entry)) {
      byName.set(name, { ...entry, priority: entry.priority ?? PRIORITY_DEFAULT });
    } else {
      byName.set(name, { ...entry, name, priority: entry.priority ?? PRIORITY_DEFAULT });
    }
  }

  for (const entry of projectListeners) {
    const name = getEntryName(entry);
    if (isChainConfig(entry)) {
      byName.set(name, { ...entry, priority: entry.priority ?? PRIORITY_DEFAULT });
    } else {
      byName.set(name, { ...entry, name, priority: entry.priority ?? PRIORITY_DEFAULT });
    }
  }

  // Sort by priority ascending (lower = runs first)
  return Array.from(byName.values()).sort(
    (a, b) => (a.priority ?? PRIORITY_DEFAULT) - (b.priority ?? PRIORITY_DEFAULT)
  );
}

export function loadAndMergeConfig(
  globalPath?: string,
  projectPath?: string
): AgentHooksConfig {
  const gPath = globalPath ?? GLOBAL_CONFIG_PATH;
  const pPath = projectPath ?? PROJECT_CONFIG_PATH;

  const globalConfig = loadYamlFile(gPath);
  if (globalConfig) debugConfig("loaded config from %s", gPath);
  const projectConfig = loadYamlFile(pPath);
  if (projectConfig) debugConfig("loaded config from %s", pPath);

  // No config at all — return empty but valid
  if (!globalConfig && !projectConfig) {
    return { events: {} };
  }

  // Only one exists
  if (!globalConfig) return normalizeConfig(projectConfig!);
  if (!projectConfig) return normalizeConfig(globalConfig);

  // Deep merge
  const merged: AgentHooksConfig = {
    version: projectConfig.version ?? globalConfig.version,
    default_timeout: projectConfig.default_timeout ?? globalConfig.default_timeout,
    events: {},
    errors: {
      isolate_failures:
        projectConfig.errors?.isolate_failures ??
        globalConfig.errors?.isolate_failures ??
        true,
      include_in_response:
        projectConfig.errors?.include_in_response ??
        globalConfig.errors?.include_in_response ??
        true,
    },
    enabled: projectConfig.enabled ?? globalConfig.enabled ?? true,
    global_env: {
      ...(globalConfig.global_env ?? {}),
      ...(projectConfig.global_env ?? {}),
    },
  };

  // Merge events with name-based dedup
  const allEventNames = new Set([
    ...Object.keys(globalConfig.events ?? {}),
    ...Object.keys(projectConfig.events ?? {}),
  ]);

  for (const eventName of allEventNames) {
    const globalListeners = globalConfig.events?.[eventName] ?? [];
    const projectListeners = projectConfig.events?.[eventName] ?? [];
    merged.events[eventName] = mergeListeners(globalListeners, projectListeners);
  }

  const eventCount = Object.keys(merged.events).length;
  const listenerCount = Object.values(merged.events).reduce((sum, l) => sum + l.length, 0);
  debugConfig("merged config: %d events, %d total listeners", eventCount, listenerCount);
  return merged;
}

function normalizeEntry(entry: EventEntry): EventEntry {
  if (isChainConfig(entry)) {
    return {
      ...entry,
      priority: entry.priority ?? PRIORITY_DEFAULT,
      chain: entry.chain.map((l) => ({
        ...l,
        name: l.name || autoGenerateName(l),
        priority: l.priority ?? PRIORITY_DEFAULT,
      })),
    };
  }
  return {
    ...entry,
    name: entry.name || autoGenerateName(entry),
    priority: entry.priority ?? PRIORITY_DEFAULT,
  };
}

function normalizeConfig(config: AgentHooksConfig): AgentHooksConfig {
  const events: Record<string, EventEntry[]> = {};

  for (const [eventName, entries] of Object.entries(config.events ?? {})) {
    events[eventName] = (entries ?? [])
      .map(normalizeEntry)
      .sort((a, b) => a.priority - b.priority);
  }

  return {
    ...config,
    events,
    errors: {
      isolate_failures: config.errors?.isolate_failures ?? true,
      include_in_response: config.errors?.include_in_response ?? true,
    },
    enabled: config.enabled ?? true,
  };
}

// Exported for testing
export { autoGenerateName, resolveHome, loadYamlFile };
