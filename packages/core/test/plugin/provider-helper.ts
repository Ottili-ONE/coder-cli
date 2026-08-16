import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OttiliCoderPlugin } from "@opencode-ai/core/plugin/provider/ottili-coder"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

export const it = testEffect(PluginTestLayer)

export function withEnv<A, E, R>(
  vars: Record<string, string | undefined>,
  fx: () => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    fx,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

type ProviderInput = Partial<Omit<ProviderV2.Info, "api" | "request">> & {
  api?: ProviderV2.Api
  request?: ProviderV2.Request
}

export function provider(providerID: string, options?: ProviderInput) {
  return ProviderV2.Info.make({
    ...ProviderV2.Info.empty(ProviderV2.ID.make(providerID)),
    api: options?.api ?? {
      type: "aisdk",
      package: "test-provider",
    },
    ...options,
    request: {
      headers: {},
      body: {},
      ...options?.request,
    },
  })
}

type ModelInput = Partial<Omit<ModelV2.Info, "api" | "request">> & {
  api?: (ProviderV2.Api & { id?: ModelV2.ID }) | { id: ModelV2.ID }
  request?: ModelV2.Info["request"]
}

export function model(providerID: string, modelID: string, options?: ModelInput) {
  return ModelV2.Info.make({
    ...ModelV2.Info.empty(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
    ...options,
    api:
      options?.api && "type" in options.api
        ? { id: ModelV2.ID.make(modelID), ...options.api }
        : { id: ModelV2.ID.make(modelID), ...options?.api, type: "aisdk", package: "test-provider" },
    request: {
      headers: {},
      body: {},
      ...options?.request,
    },
  })
}

export const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* OttiliCoderPlugin.effect(host)
})
