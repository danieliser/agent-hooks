import createDebug from "debug";

export const debugConfig = createDebug("agent-hooks:config");
export const debugDispatcher = createDebug("agent-hooks:dispatcher");
export const debugShellListener = createDebug("agent-hooks:shell-listener");
export const debugTemplateListener = createDebug("agent-hooks:template-listener");
export const debugMcpListener = createDebug("agent-hooks:mcp-listener");
