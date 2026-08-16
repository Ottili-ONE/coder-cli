import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

/**
 * Browser tooling configuration boundary.
 *
 * The `browser` CLI feature is powered by the built-in Playwright MCP server
 * (see `ConfigBuiltinMcp`). This module exposes the additive, non-schema
 * configuration knobs for browser/Playwright runs so they can be resolved from
 * environment or config without changing the public `ConfigV1.Info` contract.
 */

export interface BrowserSettings {
  readonly enabled: boolean
  readonly browser: "chromium" | "firefox" | "webkit"
  readonly headless: boolean
  readonly defaultTimeoutMs: number
}

export const defaults = (): BrowserSettings => ({
  enabled: process.env.OTTILI_CODER_DISABLE_PLAYWRIGHT !== "1",
  browser: (process.env.OTTILI_CODER_BROWSER as BrowserSettings["browser"]) ?? "chromium",
  headless: process.env.OTTILI_CODER_BROWSER_HEADLESS !== "0",
  defaultTimeoutMs: Number(process.env.OTTILI_CODER_BROWSER_TIMEOUT_MS ?? 300_000),
})

export const mcpServer = (): ConfigMCPV1.Local => ({
  type: "local",
  command: ["npx", "-y", "@playwright/mcp@latest"],
  enabled: defaults().enabled,
})

export * as ConfigBrowser from "./browser"
