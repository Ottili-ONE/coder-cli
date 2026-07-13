import { DateTime, Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"
import { ModelV2 } from "../../model"

/**
 * Ottili Coder native integration for the Ottili AI Platform (ai.ottili.one).
 *
 * Surfaces the three first-party Ottili models as a real, native provider
 * (id `ottili-coder`), not a generic "auto" meta-provider:
 *
 *   * ottili/helix-1.2  — fast, everyday developer workflows
 *   * ottili/cairn-1.2  — advanced agentic software engineering
 *   * ottili/auto       — adaptive router that picks Helix or Cairn per request
 *                         (reuses Ottili Coder's "auto" model-selection idea, but
 *                         with Ottili's OWN models instead of third-party upstreams)
 *
 * The models are OpenAI-compatible and served from ai.ottili.one, so they are
 * registered as `@ai-sdk/openai-compatible` (the only executable API path in
 * core/session/runner/model.ts). Auth follows the existing provider contract:
 * an `OTTILI_CODER_API_KEY` env var (or a configured api key) enables the paid
 * models; without it the provider falls back to the public key and paid models
 * are disabled, exactly like the previous behaviour.
 */

const OTTILI_BASE_URL = "https://ai.ottili.one/api/v1"

interface OtiliModelSpec {
  id: string
  apiID: string
  displayName: string
  family: string
  input: number
  output: number
}

const OTTILI_MODELS: OtiliModelSpec[] = [
  { id: "helix-1.2", apiID: "ottili/helix-1.2", displayName: "Ottili Helix 1.2", family: "helix", input: 0.2, output: 0.4 },
  { id: "cairn-1.2", apiID: "ottili/cairn-1.2", displayName: "Ottili Cairn 1.2", family: "cairn", input: 0.65, output: 1.3 },
  {
    id: "auto",
    apiID: "ottili/auto",
    displayName: "Ottili Auto",
    family: "auto",
    input: 0.425,
    output: 0.85,
  },
]

export const OttiliCoderPlugin = PluginV2.define({
  id: PluginV2.ID.make("ottili-coder"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        let item = evt.provider.get(ProviderV2.ID.ottiliCoder)

        // Ensure the provider exists and points at the Ottili AI Platform.
        if (!item) {
          evt.provider.update(ProviderV2.ID.ottiliCoder, (provider) => {
            provider.name = "Ottili"
            provider.env = ["OTTILI_CODER_API_KEY"]
            provider.enabled = { via: "env", name: "OTTILI_CODER_API_KEY" }
            provider.api = {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: OTTILI_BASE_URL,
            }
          })
          item = evt.provider.get(ProviderV2.ID.ottiliCoder)!
        }

        const hasKey = Boolean(
          process.env.OTTILI_CODER_API_KEY ||
            item.provider.env.some((env) => process.env[env]) ||
            item.provider.request.body.apiKey ||
            (item.provider.enabled && item.provider.enabled.via === "credential"),
        )

        // Keep the provider pinned to the Ottili AI Platform and apply the
        // public-key fallback when no credential is configured.
        evt.provider.update(ProviderV2.ID.ottiliCoder, (provider) => {
          provider.env = ["OTTILI_CODER_API_KEY"]
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: OTTILI_BASE_URL,
          }
          if (!hasKey) provider.request.body.apiKey = "public"
        })

        // Register the three Ottili models as native, OpenAI-compatible models.
        for (const spec of OTTILI_MODELS) {
          evt.model.update(ProviderV2.ID.ottiliCoder, ModelV2.ID.make(spec.id), (draft) => {
            draft.name = spec.displayName
            draft.family = ModelV2.Family.make(spec.family)
            draft.api = {
              id: ModelV2.ID.make(spec.apiID),
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: OTTILI_BASE_URL,
            }
            draft.capabilities = {
              tools: true,
              input: ["text/plain"],
              output: ["text/plain"],
            }
            draft.variants = []
            draft.time.released = DateTime.makeUnsafe(Date.parse("2026-01-15").valueOf())
            draft.cost = [{ input: spec.input, output: spec.output, cache: { read: 0, write: 0 } }]
            draft.status = "active"
            draft.enabled = hasKey
            draft.limit = {
              context: 1_000_000,
              input: 1_000_000,
              output: 384_000,
            }
          })
        }

        // Preserve the previous behaviour: without a key, disable any other
        // paid models already registered for the provider (e.g. from the
        // models.dev catalog). Our seeded models are already gated on `hasKey`.
        if (!hasKey) {
          for (const m of item.models.values()) {
            if (!m.cost.some((cost) => cost.input > 0)) continue
            evt.model.update(item.provider.id, m.id, (draft) => {
              draft.enabled = false
            })
          }
        }
      }),
    }
  }),
})
