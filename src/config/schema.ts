import type { ListenerType } from "../types.js";

export const VALID_LISTENER_TYPES: ListenerType[] = ["shell", "template", "mcp"];
export const MAX_TEMPLATE_SIZE_BYTES = 100 * 1024; // 100KB — CTO Condition #3
export const MAX_PAYLOAD_SIZE_BYTES = 10 * 1024; // 10KB
export const DEFAULT_TIMEOUT_MS = 5000;
export const MIN_TIMEOUT_MS = 100;
export const MAX_TIMEOUT_MS = 30000;
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 100;
export const PRIORITY_DEFAULT = 10;

// Event naming: dot-notation snake_case — domain.entity.action
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(\.\*)?$/;

// Wildcard pattern for listener registration
export const WILDCARD_EVENT_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.\*$/;

export const REQUIRED_FIELDS_BY_TYPE: Record<ListenerType, string[]> = {
  shell: ["command"],
  template: ["path"],
  mcp: ["server", "tool"],
};
