export type ListenerType = "shell" | "template" | "mcp";
export type ListenerStatus = "success" | "error" | "timeout" | "pending_execution";

export interface ListenerConfig {
  name: string;
  type: ListenerType;
  priority: number;
  description?: string;
  timeout?: number;
  env?: Record<string, string>;
  // Shell-specific
  command?: string;
  // Template-specific
  path?: string;
  // MCP-specific
  server?: string;
  tool?: string;
  args_mapping?: Record<string, string>;
}

export interface AgentHooksConfig {
  version?: string;
  default_timeout?: number;
  events: Record<string, ListenerConfig[]>;
  errors?: {
    isolate_failures?: boolean;
    include_in_response?: boolean;
  };
  enabled?: boolean;
  global_env?: Record<string, string>;
}

export interface McpCall {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ListenerResponse {
  listener_id: string;
  name: string;
  type: ListenerType;
  priority: number;
  status: ListenerStatus;
  result: unknown;
  duration_ms: number;
  error?: ListenerError;
}

export interface ListenerError {
  listener_id: string;
  type: string;
  message: string;
  details?: unknown;
}

export type EmitMode = "sync" | "async";

export interface EmitResponse {
  event: string;
  invocation_id: string;
  executed_at: string;
  listeners_executed: number;
  responses: ListenerResponse[];
  errors: ListenerError[];
  duration_ms: number;
  timed_out: boolean;
}

export interface EmitAsyncResponse {
  event: string;
  mode: "async";
  invocation_id: string;
  status: "enqueued";
  listeners_registered: number;
  message: string;
}

export interface HasListenersResponse {
  event: string;
  has_listeners: boolean;
  listener_count: number;
  priorities: number[];
}

export interface ShellPayload {
  event: string;
  invocation_id: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface ValidationError {
  file: string;
  line?: number;
  message: string;
}
