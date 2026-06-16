import type { Tool as AITool } from "ai"

const hidden = new Set(["invalid", "StructuredOutput"])

export function sessionToolCatalog(tools: Record<string, AITool>): string | undefined {
  const names = Object.keys(tools)
    .filter((name) => !hidden.has(name))
    .sort()
  if (names.length === 0) return undefined

  const lines = names.map((name) => {
    const first = tools[name]?.description
      ?.split("\n")
      .map((line) => line.trim())
      .find(Boolean)
    const summary = first?.replace(/^-\s*/, "")
    return summary ? `- ${name}: ${summary}` : `- ${name}`
  })

  return [
    "<available_tools>",
    ...lines,
    "</available_tools>",
    "When asked about your abilities, list every tool above plus agent modes, subagents (task), skills, MCP tools, and TUI commands.",
  ].join("\n")
}

export * as Capabilities from "./capabilities"
