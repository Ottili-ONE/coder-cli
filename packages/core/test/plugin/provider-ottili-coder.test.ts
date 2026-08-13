import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { OttiliCoderPlugin } from "@opencode-ai/core/plugin/provider/ottili-coder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const events = yield* EventV2.Service
  const integration = yield* Integration.Service
  yield* OpencodePlugin.effect(host).pipe(
    Effect.provideService(EventV2.Service, events),
    Effect.provideService(Integration.Service, integration),
  )
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

const cost = (input: number, output = 0) => [{ input, output, cache: { read: 0, write: 0 } }]

describe("OttiliCoderPlugin", () => {
  it.effect("uses a public key and disables paid models without credentials", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder")
          catalog.provider.update(item.id, () => {})
          const paid = model("ottili-coder", "paid", { cost: cost(1) })
          catalog.model.update(item.id, paid.id, (draft) => {
            draft.cost = [...paid.cost]
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)).request.body.apiKey).toBe("public")
        expect((yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("paid"))).enabled).toBe(false)
      }),
    ),
  )

  it.effect("keeps free models without credentials", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder")
          catalog.provider.update(item.id, () => {})
          const free = model("ottili-coder", "free", { cost: cost(0) })
          catalog.model.update(item.id, free.id, (draft) => {
            draft.cost = [...free.cost]
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)).request.body.apiKey).toBe("public")
        expect((yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("free"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("treats output-only cost as free without credentials", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder")
          catalog.provider.update(item.id, () => {})
          const outputOnly = model("ottili-coder", "output-only", { cost: cost(0, 1) })
          catalog.model.update(item.id, outputOnly.id, (draft) => {
            draft.cost = [...outputOnly.cost]
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)).request.body.apiKey).toBe("public")
        expect((yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("output-only"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses OTTILI_CODER_API_KEY as credentials", () =>
    withEnv({ OTTILI_CODER_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder")
          catalog.provider.update(item.id, () => {})
          const paid = model("ottili-coder", "paid", { cost: cost(1) })
          catalog.model.update(item.id, paid.id, (draft) => {
            draft.cost = [...paid.cost]
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)).request.body.apiKey).toBeUndefined()
        expect((yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses configured provider env vars as credentials", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined, CUSTOM_OTTILI_CODER_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder", { env: ["CUSTOM_OTTILI_CODER_API_KEY"] })
          catalog.provider.update(item.id, (draft) => {
            draft.env = [...item.env]
          })
          const paid = model("ottili-coder", "paid", { cost: cost(1) })
          catalog.model.update(item.id, paid.id, (draft) => {
            draft.cost = [...paid.cost]
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)).request.body.apiKey).toBeUndefined()
        expect((yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses configured apiKey as credentials", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder", {
            request: {
              headers: {},
              body: { apiKey: "configured" },
            },
          })
          const model = ModelV2.Info.make({
            ...ModelV2.Info.empty(provider.id, ModelV2.ID.make("paid")),
            api: { id: ModelV2.ID.make("paid"), type: "aisdk", package: "test-provider" },
            cost: cost(1),
          })
          const paid = model("ottili-coder", "paid", { cost: cost(1) })
          catalog.model.update(item.id, paid.id, (draft) => {
            draft.cost = [...paid.cost]
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)).request.body.apiKey).toBe("configured")
        expect((yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("uses auth-enabled providers as credentials", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("ottili-coder", {
            enabled: { via: "credential", credentialID: Credential.ID.make("credential") },
          })
          catalog.provider.update(item.id, (draft) => {
            draft.enabled = item.enabled
          })
          const paid = model("ottili-coder", "paid", { cost: cost(1) })
          catalog.model.update(item.id, paid.id, (draft) => {
            draft.cost = [...paid.cost]
          })
        })
        expect((yield* catalog.provider.get(ProviderV2.ID.ottiliCoder)).request.body.apiKey).toBeUndefined()
        expect((yield* catalog.model.get(ProviderV2.ID.ottiliCoder, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("ignores non-ottili-coder providers and models", () =>
    withEnv({ OTTILI_CODER_API_KEY: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* plugin.add(OttiliCoderPlugin)
        const transform = yield* catalog.transform()
        yield* transform((catalog) => {
          const item = provider("openai")
          catalog.provider.update(item.id, () => {})
          const paid = model("openai", "paid", { cost: cost(1) })
          catalog.model.update(item.id, paid.id, (draft) => {
            draft.cost = [...paid.cost]
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(ProviderV2.ID.openai)).request.body.apiKey).toBeUndefined()
        expect(required(yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("paid"))).enabled).toBe(true)
      }),
    ),
  )

  it.effect("prefers gpt-5-nano as the ottili-coder small model", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.ottiliCoder

      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("cheap-mini"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [...cost(1, 1)]
          model.time.released = Date.now()
        })
        catalog.model.update(providerID, ModelV2.ID.make("gpt-5-nano"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [...cost(10, 10)]
          model.time.released = Date.now()
        })
      })

      const selected = yield* catalog.model.small(providerID)

      expect(selected?.id).toBe(ModelV2.ID.make("gpt-5-nano"))
    }),
  )
})
