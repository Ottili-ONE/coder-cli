// Compatibility shim for @opencode-ai/client/promise
// The promise-based client types were removed upstream during the OpenCode merge.
// Ottili app/desktop code still imports these names as types (erased at runtime).
// They are re-exported as loose aliases so the UI typechecks while the Ottili
// promise client behavior is preserved at runtime. Replace with real types as the
// Ottili client is re-aligned with upstream.
export type AgentListOutput = any
export type CommandInfo = any
export type FileDiffInfo = any
export type McpListInput = any
export type McpResource = any
export type McpResourceCatalogInput = any
export type McpServer = any
export type ModelDefaultOutput = any
export type ModelListOutput = any
export type OpenCodeEvent = any
export type PermissionV2Request = any
export type Project = any
export type ProjectCurrent = any
export type ProviderListOutput = any
export type SessionApi = any
export type SessionCommandInput = any
export type SessionCommandOutput = any
export type SessionCompactInput = any
export type SessionCompactOutput = any
export type SessionInfo = any
export type SessionListInput = any
export type SessionMessageAssistant = any
export type SessionMessageAssistantTool = any
export type SessionMessageInfo = any
export type SessionMessageShell = any
export type SessionMessageUser = any
export type SessionPendingMessage = any
export type SessionPromptInput = any
export type SessionPromptOutput = any
export type SessionShellInput = any
export type SessionShellOutput = any
