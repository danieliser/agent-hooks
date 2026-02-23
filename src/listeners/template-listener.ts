import * as fs from "node:fs";
import * as path from "node:path";
import type { ListenerConfig, ListenerResponse } from "../types.js";
import { MAX_TEMPLATE_SIZE_BYTES } from "../config/schema.js";
import { debugTemplateListener } from "../utils/debug.js";

function resolveHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(process.env.HOME ?? "", p.slice(1));
  }
  return p;
}

export async function executeTemplateListener(
  listener: ListenerConfig,
  event: string,
  data: Record<string, unknown>
): Promise<ListenerResponse> {
  const startTime = Date.now();

  if (!listener.path) {
    return {
      listener_id: listener.name,
      name: listener.name,
      type: "template",
      priority: listener.priority,
      status: "error",
      result: null,
      duration_ms: 0,
      error: {
        listener_id: listener.name,
        type: "invalid_config",
        message: "Template listener missing 'path'",
      },
    };
  }

  const templatePath = resolveHome(listener.path);
  debugTemplateListener("reading template path=%s", listener.path);

  if (!fs.existsSync(templatePath)) {
    return {
      listener_id: listener.name,
      name: listener.name,
      type: "template",
      priority: listener.priority,
      status: "error",
      result: null,
      duration_ms: Date.now() - startTime,
      error: {
        listener_id: listener.name,
        type: "file_not_found",
        message: `Template file not found: ${listener.path}`,
      },
    };
  }

  const stat = fs.statSync(templatePath);
  if (stat.size > MAX_TEMPLATE_SIZE_BYTES) {
    return {
      listener_id: listener.name,
      name: listener.name,
      type: "template",
      priority: listener.priority,
      status: "error",
      result: null,
      duration_ms: Date.now() - startTime,
      error: {
        listener_id: listener.name,
        type: "size_limit",
        message: `Template file exceeds ${MAX_TEMPLATE_SIZE_BYTES / 1024}KB limit (${Math.round(stat.size / 1024)}KB)`,
      },
    };
  }

  let content = fs.readFileSync(templatePath, "utf-8");

  // Basic substitution: ${data.X} and ${env.Y}
  content = content.replace(/\$\{data\.([^}]+)\}/g, (_, key) => {
    return String(data[key] ?? "");
  });
  content = content.replace(/\$\{env\.([^}]+)\}/g, (_, key) => {
    return process.env[key] ?? "";
  });

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  debugTemplateListener("template rendered length=%d", content.length);

  return {
    listener_id: listener.name,
    name: listener.name,
    type: "template",
    priority: listener.priority,
    status: "success",
    result: {
      template_path: listener.path,
      template_content: content,
      word_count: wordCount,
    },
    duration_ms: Date.now() - startTime,
  };
}
