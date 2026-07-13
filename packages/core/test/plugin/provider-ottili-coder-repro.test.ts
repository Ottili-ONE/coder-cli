import { describe, expect } from "bun:test"
import { Effect, Option } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OttiliCoderPlugin } from "@opencode-ai/core/plugin/provider/ottili-coder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it, withEnv } from "./provider-helper"

describe("OttiliCoderPlugin repro (no pre-seeded provider)", () => {
  it.effect("creates the provider and seeds models when not present in models.dev", () =>
    withEnv({ OTTILI_CODER_API_KEY: "sk-test" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        // Simulate real CLI: otili-coder is NOT pre-seeded by models.dev.
        yield* transform((catalog) => {})

        const provider = yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)
        expect(provider).toBeDefined()
        expect(provider.name).toBe("Ottili")

        const ids = (yield* catalog.model.all())
          .filter((m) => m.providerID === ProviderV2.ID.ottiliCoder)
          .map((m) => String(m.id))
        expect(ids).toContain("helix-1.2")
        expect(ids).toContain("cairn-1.2")
        expect(ids).toContain("auto")

        const selected = yield* catalog.model.small(ProviderV2.ID.ottiliCoder)
        expect(Option.isSome(selected)).toBe(true)
      }),
    ),
  )
})
