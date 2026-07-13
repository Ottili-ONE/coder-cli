import { describe, expect } from "bun:test"
import { Effect, Layer, Option, Ref, Stream } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenRouter from "../../src/providers/openrouter"
import { it } from "../lib/effect"
import { runtimeLayer } from "../lib/http"

describe("OpenRouter", () => {
  it.effect("prepares OpenRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "openrouter",
        route: { id: "openrouter" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://openrouter.ai/api/v1")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("openrouter")
      expect(prepared.body).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: {
              openrouter: {
                usage: true,
                reasoning: { effort: "high" },
                promptCacheKey: "session_123",
              },
            },
          }).model("anthropic/claude-3.7-sonnet:thinking"),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
      })
    }),
  )

  it.effect("sends OpenRouter attribution headers on every request", () =>
    Effect.gen(function* () {
      const captured = yield* Ref.make<Record<string, string>>({})
      const clientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const read = (key: string) =>
              Headers.get(request.headers, key).pipe(Option.getOrElse(() => ""))
            yield* Ref.set(captured, {
              "HTTP-Referer": read("http-referer"),
              "X-Title": read("x-title"),
              "X-OpenRouter-Title": read("x-openrouter-title"),
              "X-OpenRouter-Categories": read("x-openrouter-categories"),
            })
            return HttpClientResponse.fromWeb(
              request,
              new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
            )
          }),
        ),
      )

      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")
      yield* LLMClient.stream(LLM.request({ model, prompt: "Say hello." })).pipe(
        Stream.runCollect,
        Effect.provide(runtimeLayer(clientLayer)),
        Effect.orElseSucceed(() => undefined),
      )

      const headers = yield* Ref.get(captured)
      expect(headers["HTTP-Referer"]).toBe("https://ottili.one/coder")
      expect(headers["X-Title"]).toBe("Ottili Coder")
      expect(headers["X-OpenRouter-Title"]).toBe("Ottili Coder")
      expect(headers["X-OpenRouter-Categories"]).toBe("cli-agent,cloud-agent,programming-app")
    }),
  )
})
