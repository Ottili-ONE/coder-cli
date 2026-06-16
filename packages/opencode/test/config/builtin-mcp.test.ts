import { describe, expect, test } from "bun:test"
import { ConfigBuiltinMcp } from "../../src/config/builtin-mcp"

describe("ConfigBuiltinMcp", () => {
  test("merges playwright by default", () => {
    const merged = ConfigBuiltinMcp.merge({})
    expect(merged?.playwright?.type).toBe("local")
    expect(merged?.playwright?.enabled).toBe(true)
    expect(merged?.playwright?.command?.join(" ")).toContain("@playwright/mcp")
  })

  test("user config overrides builtin fields", () => {
    const merged = ConfigBuiltinMcp.merge({
      playwright: { type: "local", command: ["custom"], enabled: false },
    })
    expect(merged?.playwright?.enabled).toBe(false)
    expect(merged?.playwright?.command).toEqual(["custom"])
  })

  test("preserves other mcp servers", () => {
    const merged = ConfigBuiltinMcp.merge({
      jira: { type: "remote", url: "https://jira.example.com/mcp", enabled: true },
    })
    expect(merged?.playwright?.enabled).toBe(true)
    expect(merged?.jira?.url).toBe("https://jira.example.com/mcp")
  })

  test("can disable via env", () => {
    const prev = process.env.OTTILI_CODER_DISABLE_BUILTIN_MCP
    process.env.OTTILI_CODER_DISABLE_BUILTIN_MCP = "1"
    try {
      expect(ConfigBuiltinMcp.merge(undefined)).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.OTTILI_CODER_DISABLE_BUILTIN_MCP
      else process.env.OTTILI_CODER_DISABLE_BUILTIN_MCP = prev
    }
  })
})
