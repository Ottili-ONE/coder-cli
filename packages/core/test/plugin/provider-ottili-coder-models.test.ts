import { describe, expect } from "bun:test"
import { Effect, Option } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OttiliCoderPlugin } from "@opencode-ai/core/plugin/provider/ottili-coder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it, provider, withEnv } from "./provider-helper"

const BASE_URL = "https://ai.ottili.one/api/v1"

describe("OttiliCoderPlugin models", () => {
  it.effect("registers helix, cairn and auto as native openai-compatible models", () =>
    withEnv({ OTTILI_CODER_API_KEY: "sk-test" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder")
          catalog.provider.update(item.id, () => {})
        })

        const ids = (yield* catalog.model.all())
          .filter((m) => m.providerID === ProviderV2.ID.ottiliCoder)
          .map((m) => String(m.id))

        expect(ids).toContain("helix-1.2")
        expect(ids).toContain("cairn-1.2")
        expect(ids).toContain("auto")

        const auto = yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("auto"))
        expect(auto.enabled).toBe(true)
        if (auto.api.type === "aisdk") {
          expect(auto.api.url).toBe(BASE_URL)
          expect(auto.api.package).toBe("@ai-sdk/openai-compatible")
          // API model id keeps the ottili/ prefix for the backend registry.
          expect(auto.api.id).toBe(ModelV2.ID.make("ottili/auto"))
        } else {
          throw new Error("ottili/auto must be registered as an aisdk openai-compatible model")
        }

        const helix = yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("helix-1.2"))
        expect(helix.enabled).toBe(true)
        if (helix.api.type === "aisdk") {
          expect(helix.api.id).toBe(ModelV2.ID.make("ottili/helix-1.2"))
        }
      }),
    ),
  )

  it.effect("prefers otili/auto as the small model for the ottili provider", () =>
    withEnv({ OTTILI_CODER_API_KEY: "sk-test" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder")
          catalog.provider.update(item.id, () => {})
        })

        const selected = yield* catalog.model.small(ProviderV2.ID.ottiliCoder)
        expect(Option.isSome(selected)).toBe(true)
        expect(Option.getOrUndefined(selected)?.id).toBe(ModelV2.ID.make("auto"))
      }),
    ),
  )

  it.effect("disables the otili models without a credential", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder")
          catalog.provider.update(item.id, () => {})
        })

        const auto = yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("auto"))
        expect(auto.enabled).toBe(false)
      }),
    ),
  )
})
