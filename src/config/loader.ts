import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentHooksConfig, ListenerConfig } from "../types.js";
import { PRIORITY_DEFAULT } from "./schema.js";

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

function mergeListeners(
  globalListeners: ListenerConfig[],
  projectListeners: ListenerConfig[]
): ListenerConfig[] {
  // Name-based dedup: build map from global, overlay project
  const byName = new Map<string, ListenerConfig>();

  for (const listener of globalListeners) {
    const name = listener.name || autoGenerateName(listener);
    byName.set(name, { ...listener, name });
  }

  for (const listener of projectListeners) {
    const name = listener.name || autoGenerateName(listener);
    // Project overwrites global if same name
    byName.set(name, { ...listener, name });
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
  const projectConfig = loadYamlFile(pPath);

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

  return merged;
}

function normalizeConfig(config: AgentHooksConfig): AgentHooksConfig {
  // Ensure all listeners have names and normalize priorities
  const events: Record<string, ListenerConfig[]> = {};

  for (const [eventName, listeners] of Object.entries(config.events ?? {})) {
    events[eventName] = (listeners ?? [])
      .map((l) => ({
        ...l,
        name: l.name || autoGenerateName(l),
        priority: l.priority ?? PRIORITY_DEFAULT,
      }))
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
