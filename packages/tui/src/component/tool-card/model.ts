import type { ToolPart } from "@opencode-ai/sdk/v2"

export type ToolCallCategory = "command" | "file" | "search" | "network" | "mcp" | "agent" | "generic"

export type ToolCallStatus = "pending" | "running" | "completed" | "error" | "denied"

export type ToolCallEvidence =
  | { kind: "none" }
  | { kind: "command"; command: string; output: string; workdir?: string; description?: string }
  | { kind: "diff"; filePath: string; diff: string; diagnostics?: unknown }
  | { kind: "files"; paths: ReadonlyArray<string> }
  | { kind: "todos"; todos: ReadonlyArray<{ status: string; content: string }> }
  | { kind: "questions"; questions: ReadonlyArray<{ question: string; answer?: string }> }
  | { kind: "text"; text: string; filePath?: string }
  | { kind: "subagent"; sessionID?: string; toolcalls: number; durationLabel?: string }

export type ToolCallCard = {
  readonly id: string
  readonly callID: string
  readonly tool: string
  readonly category: ToolCallCategory
  readonly status: ToolCallStatus
  readonly icon: string
  readonly title: string
  readonly summary: string
  readonly evidence: ToolCallEvidence
  readonly expandable: boolean
  readonly defaultExpanded: boolean
  readonly matchCount?: number
  readonly durationMs?: number
  readonly error?: string
  readonly denied: boolean
}

const COMMAND_TOOLS = new Set(["bash"])
const FILE_TOOLS = new Set(["read", "write", "edit", "apply_patch"])
const SEARCH_TOOLS = new Set(["glob", "grep"])
const NETWORK_TOOLS = new Set(["webfetch", "websearch"])
const AGENT_TOOLS = new Set(["task"])

// Namespaced tool names (e.g. `mcp__github__search`) are treated as first-class
// MCP cards instead of being hidden behind the generic-tool-output toggle.
export function categorizeTool(tool: string): ToolCallCategory {
  if (COMMAND_TOOLS.has(tool)) return "command"
  if (FILE_TOOLS.has(tool)) return "file"
  if (SEARCH_TOOLS.has(tool)) return "search"
  if (NETWORK_TOOLS.has(tool)) return "network"
  if (AGENT_TOOLS.has(tool)) return "agent"
  if (tool.startsWith("mcp__") || tool.includes("__")) return "mcp"
  return "generic"
}

const TOOL_ICON: Record<string, string> = {
  bash: "$",
  glob: "✱",
  grep: "✱",
  read: "→",
  write: "←",
  edit: "←",
  apply_patch: "%",
  webfetch: "%",
  websearch: "◈",
  todowrite: "⚙",
  question: "→",
  skill: "→",
}

const CATEGORY_ICON: Record<ToolCallCategory, string> = {
  command: "$",
  file: "←",
  search: "✱",
  network: "%",
  mcp: "⬡",
  agent: "│",
  generic: "⚙",
}

export function toolIcon(tool: string, status: ToolCallStatus): string {
  if (tool === "task") return status === "completed" || status === "denied" ? "✓" : "│"
  return TOOL_ICON[tool] ?? CATEGORY_ICON[categorizeTool(tool)]
}

const DENIED_PATTERNS = ["QuestionRejectedError", "rejected permission", "specified a rule", "user dismissed"]

function isDenied(error: string | undefined): boolean {
  return error ? DENIED_PATTERNS.some((pattern) => error.includes(pattern)) : false
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function inputSummary(input: Record<string, unknown>, omit: ReadonlyArray<string> = []): string {
  const primitives = Object.entries(input)
    .filter(([key, value]) => !omit.includes(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
    .map(([key, value]) => `${key}=${value}`)
  return primitives.length ? `[${primitives.join(", ")}]` : ""
}

function metadataOf(part: ToolPart): Record<string, unknown> | undefined {
  const state = part.state
  if (state.status === "pending") return undefined
  return rec(state.metadata)
}

function completedOutput(part: ToolPart): string | undefined {
  const state = part.state
  if (state.status !== "completed") return undefined
  // The bash renderer historically sourced output from metadata.output; fall back
  // to it so both storage shapes project identically.
  const fromState = str(state.output)
  if (fromState !== undefined) return fromState
  return str(rec(state.metadata)?.output)
}

function parseTodos(value: unknown): ReadonlyArray<{ status: string; content: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const todo = rec(item)
    const status = str(todo?.status)
    const content = str(todo?.content)
    return status && content ? [{ status, content }] : []
  })
}

function parseQuestions(value: unknown, answers: ReadonlyArray<ReadonlyArray<string>> | undefined): ReadonlyArray<{ question: string; answer?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    const question = str(rec(item)?.question)
    if (!question) return []
    const answer = answers?.[index]
    return [{ question, answer: answer?.length ? answer.join(", ") : undefined }]
  })
}

function applyPatchPrimary(metadata: Record<string, unknown> | undefined): { filePath: string; diff: string } | undefined {
  const files = Array.isArray(metadata?.files) ? metadata?.files : undefined
  const first = rec(files?.[0])
  if (!first) return undefined
  const relativePath = str(first.relativePath)
  const filePath = str(first.filePath)
  const patch = str(first.patch)
  if (!relativePath || !filePath || patch === undefined) return undefined
  return { filePath: relativePath, diff: patch }
}

export function projectToolCall(part: ToolPart): ToolCallCard {
  const category = categorizeTool(part.tool)
  const state = part.state
  const input = "input" in state ? state.input : {}
  const metadata = metadataOf(part)

  const error = state.status === "error" ? state.error : undefined
  const denied = isDenied(error)
  const status: ToolCallStatus =
    denied ? "denied"
    : state.status === "pending" ? "pending"
    : state.status === "running" ? "running"
    : state.status === "completed" ? "completed"
    : "error"

  const icon = toolIcon(part.tool, status)
  const durationMs =
    state.status === "completed" || state.status === "error"
      ? state.time.end - state.time.start
      : undefined

  const tool = part.tool
  const base = {
    id: part.id,
    callID: part.callID,
    tool,
    category,
    status,
    icon,
    denied,
    error,
    durationMs,
  }

  switch (category) {
    case "command": {
      const command = str(input.command) ?? ""
      const description = str(input.description)
      const workdir = str(input.workdir)
      const output = completedOutput(part) ?? ""
      const summary = `$ ${command}`
      const title = `# ${description ?? "Shell"}${workdir && workdir !== "." ? ` in ${workdir}` : ""}`
      return {
        ...base,
        title,
        summary,
        evidence: { kind: "command", command, output, workdir: workdir !== "." ? workdir : undefined, description },
        expandable: output.length > 0,
        defaultExpanded: false,
      }
    }
    case "file": {
      if (tool === "read") {
        const filePath = str(input.filePath) ?? ""
        const loaded = Array.isArray(metadata?.loaded) ? (metadata!.loaded.filter((p): p is string => typeof p === "string")) : []
        const opts = inputSummary(input, ["filePath"])
        return {
          ...base,
          title: `Read ${filePath}`,
          summary: `Read ${filePath}${opts ? ` ${opts}` : ""}`,
          evidence: { kind: "files", paths: loaded },
          expandable: loaded.length > 0,
          defaultExpanded: false,
        }
      }
      if (tool === "write") {
        const filePath = str(input.filePath) ?? ""
        const content = str(input.content) ?? ""
        return {
          ...base,
          title: `Wrote ${filePath}`,
          summary: `Write ${filePath}`,
          evidence: { kind: "text", text: content, filePath },
          expandable: content.length > 0,
          defaultExpanded: true,
        }
      }
      if (tool === "edit") {
        const filePath = str(input.filePath) ?? ""
        const diff = str(metadata?.diff) ?? ""
        return {
          ...base,
          title: `Edit ${filePath}`,
          summary: `Edit ${filePath}${inputSummary(input, ["filePath"])}`,
          evidence: { kind: "diff", filePath, diff, diagnostics: metadata?.diagnostics },
          expandable: diff.length > 0,
          defaultExpanded: true,
        }
      }
      // apply_patch
      const primary = applyPatchPrimary(metadata)
      return {
        ...base,
        title: primary ? `Patched ${primary.filePath}` : "Patch",
        summary: "Patch",
        evidence: primary ? { kind: "diff", filePath: primary.filePath, diff: primary.diff, diagnostics: metadata?.diagnostics } : { kind: "none" },
        expandable: primary !== undefined,
        defaultExpanded: primary !== undefined,
      }
    }
    case "search": {
      const pattern = str(input.pattern) ?? ""
      const path = str(input.path)
      const matchCount = num(metadata?.count) ?? num(metadata?.matches)
      const scope = path ? ` in ${path}` : ""
      const summary =
        tool === "glob"
          ? `Glob "${pattern}"${scope}${matchCount !== undefined ? ` (${matchCount} ${matchCount === 1 ? "match" : "matches"})` : ""}`
          : `Grep "${pattern}"${scope}${matchCount !== undefined ? ` (${matchCount} ${matchCount === 1 ? "match" : "matches"})` : ""}`
      return {
        ...base,
        title: summary,
        summary,
        evidence: { kind: "none" },
        expandable: false,
        defaultExpanded: false,
        matchCount,
      }
    }
    case "network": {
      if (tool === "websearch") {
        const query = str(input.query) ?? ""
        const results = num(metadata?.numResults)
        const summary = `WebSearch "${query}"${results !== undefined ? ` (${results} results)` : ""}`
        return { ...base, title: summary, summary, evidence: { kind: "none" }, expandable: false, defaultExpanded: false }
      }
      const url = str(input.url) ?? ""
      return { ...base, title: `WebFetch ${url}`, summary: `WebFetch ${url}`, evidence: { kind: "none" }, expandable: false, defaultExpanded: false }
    }
    case "agent": {
      const sessionID = str(metadata?.sessionId)
      const toolcalls = Array.isArray(metadata?.tools) ? metadata!.tools.length : 0
      const description = str(input.description) ?? ""
      const summary = `Task${str(input.background) === "true" ? " (background)" : ""} — ${description}`
      return {
        ...base,
        title: summary,
        summary,
        evidence: { kind: "subagent", sessionID, toolcalls, durationLabel: durationMs !== undefined ? formatDuration(durationMs) : undefined },
        expandable: false,
        defaultExpanded: false,
      }
    }
    case "mcp":
    case "generic": {
      if (tool === "todowrite") {
        const todos = parseTodos(input.todos)
        return {
          ...base,
          title: "# Todos",
          summary: `Updating todos (${todos.length})`,
          evidence: { kind: "todos", todos },
          expandable: todos.length > 0,
          defaultExpanded: todos.length > 0,
        }
      }
      if (tool === "question") {
        const answers = Array.isArray(metadata?.answers)
          ? (metadata!.answers as ReadonlyArray<ReadonlyArray<string>>)
          : undefined
        const questions = parseQuestions(input.questions, answers)
        return {
          ...base,
          title: "# Questions",
          summary: `Asked ${questions.length} question${questions.length !== 1 ? "s" : ""}`,
          evidence: { kind: "questions", questions },
          expandable: questions.length > 0,
          defaultExpanded: questions.length > 0,
        }
      }
      if (tool === "skill") {
        const name = str(input.name) ?? ""
        return { ...base, title: `Skill "${name}"`, summary: `Skill "${name}"`, evidence: { kind: "none" }, expandable: false, defaultExpanded: false }
      }
      const output = completedOutput(part) ?? ""
      const opts = inputSummary(input)
      const summary = `${tool} ${opts}`.trim()
      return {
        ...base,
        title: `# ${tool} ${opts}`.trim(),
        summary,
        evidence: output ? { kind: "text", text: output } : { kind: "none" },
        expandable: output.length > 0,
        defaultExpanded: false,
      }
    }
  }
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s"
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
