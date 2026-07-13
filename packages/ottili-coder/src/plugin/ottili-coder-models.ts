import type { Config } from "@opencode-ai/sdk/v2"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

/**
 * Registers the three first-party Ottili models as a real, native provider
 * (`ottili-coder`) in Provider.Service, so they surface in the model picker
 * (TUI) and the `ottili-coder models` command — both of which read
 * Provider.Service, not Catalog.Service.
 *
 *   * ottili-coder/helix-1.2  — fast, everyday developer workflows
 *   * ottili-coder/cairn-1.2  — advanced agentic software engineering
 *   * ottili-coder/auto       — adaptive router (Helix or Cairn per request)
 *
 * The API model ids sent to ai.ottili.one keep the `ottili/` prefix
 * (e.g. `ottili/helix-1.2`) so they match the Ottili AI Platform registry.
 * Auth + paid-model gating for this provider are handled by
 * OttiliCoderAuthPlugin and the `ottili-coder` branch in provider.ts.
 */

const OTTILI_BASE_URL = "https://ai.ottili.one/api/v1"

export async function OttiliCoderModelsPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    async config(cfg: Config) {
      cfg.provider = cfg.provider ?? {}
      cfg.provider["ottili-coder"] = {
        name: "Ottili",
        npm: "@ai-sdk/openai-compatible",
        api: OTTILI_BASE_URL,
        models: {
          "helix-1.2": {
            id: "ottili/helix-1.2",
            name: "Ottili Helix 1.2",
            tool_call: true,
            attachment: true,
            limit: { context: 1_000_000, output: 384_000 },
            cost: { input: 0.2, output: 0.4, cache_read: 0, cache_write: 0 },
          },
          "cairn-1.2": {
            id: "ottili/cairn-1.2",
            name: "Ottili Cairn 1.2",
            tool_call: true,
            attachment: true,
            limit: { context: 1_000_000, output: 384_000 },
            cost: { input: 0.65, output: 1.3, cache_read: 0, cache_write: 0 },
          },
          auto: {
            id: "ottili/auto",
            name: "Ottili Auto",
            tool_call: true,
            attachment: true,
            limit: { context: 1_000_000, output: 384_000 },
            cost: { input: 0.425, output: 0.85, cache_read: 0, cache_write: 0 },
          },
        },
      }
    },
  }
}
