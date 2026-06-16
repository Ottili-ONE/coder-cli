import type { Config } from "@opencode-ai/sdk/v2"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { defaultEnvFileCandidates, loadOptionalEnvFiles } from "@/provider/ottili-auto/env"

export async function OttiliAutoPlugin(input: PluginInput): Promise<Hooks> {
  loadOptionalEnvFiles(defaultEnvFileCandidates(input))

  return {
    async config(cfg: Config) {
      cfg.provider = cfg.provider ?? {}
      cfg.provider["ottili-auto"] = {
        name: "Ottili Auto",
        npm: "@ai-sdk/openai-compatible",
        models: {
          auto: {
            name: "Auto",
            tool_call: true,
            reasoning: false,
            attachment: true,
            limit: { context: 131072, output: 65536 },
            cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          },
        },
      }

      if (!cfg.model && process.env.OTTILI_AUTO_DEFAULT !== "0") {
        cfg.model = "ottili-auto/auto"
      }
    },
  }
}
