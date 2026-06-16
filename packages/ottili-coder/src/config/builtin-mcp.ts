import { mergeDeep } from "remeda"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

export const playwright: ConfigMCPV1.Local = {
  type: "local",
  command: ["npx", "-y", "@playwright/mcp@latest"],
  enabled: true,
}

export function defaults(): NonNullable<ConfigV1.Info["mcp"]> {
  return { playwright }
}

export function merge(mcp: ConfigV1.Info["mcp"] | undefined): ConfigV1.Info["mcp"] {
  if (process.env.OTTILI_CODER_DISABLE_BUILTIN_MCP === "1" || process.env.OTTILI_CODER_DISABLE_PLAYWRIGHT === "1") {
    return mcp
  }
  return mergeDeep(defaults(), mcp ?? {}) as NonNullable<ConfigV1.Info["mcp"]>
}

export * as ConfigBuiltinMcp from "./builtin-mcp"
