import { describe, expect, it } from "bun:test"
import { OTTILI_AUTO_DEFAULT_TARGET, OTTILI_AUTO_TARGETS } from "../../src/provider/ottili-auto/constants"
import {
  buildRouterPrompt,
  estimateRouterCost,
  formatRouteAnnouncement,
  isOttiliAutoModel,
  normalizeRouterModelKey,
  parseRouterJson,
  resolveExecutionTargetSync,
  ruleBasedRoute,
} from "../../src/provider/ottili-auto"
import { targetToDecision, routeWithLlama } from "../../src/provider/ottili-auto/router"

describe("ottili-auto router", () => {
  it("detects auto model selection", () => {
    expect(isOttiliAutoModel("ottili-auto", "auto")).toBe(true)
    expect(isOttiliAutoModel("ottili-coder", "gpt-5.5")).toBe(false)
  })

  it("parses router JSON output", () => {
    const decision = parseRouterJson(
      '```json\n{"model":"claude-sonnet-4-6","reason":"UI work","confidence":0.91}\n```',
    )
    expect(decision?.modelID).toBe("claude-sonnet-4-6")
    expect(decision?.providerID).toBe("ottili-coder")
    expect(decision?.confidence).toBe(0.91)
  })

  it("normalizes aliases from router output", () => {
    expect(normalizeRouterModelKey("kimi-k2.7-code")).toBe("kimi-k2.6")
    expect(normalizeRouterModelKey("gemini-3.5-high")).toBe("gemini-3.1-pro")
  })

  it("routes ask agent to gemini", () => {
    const decision = ruleBasedRoute({
      agent: "ask",
      userText: "Explain this repo",
      assistantText: "",
    })
    expect(decision.model).toBe("gemini-3.1-pro")
  })

  it("routes frontend tasks to claude sonnet", () => {
    const decision = ruleBasedRoute({
      agent: "build",
      userText: "Polish the React dashboard UI and fix CSS layout",
      assistantText: "",
    })
    expect(decision.model).toBe("claude-sonnet-4-6")
  })

  it("routes backend tasks to gpt 5.5", () => {
    const decision = ruleBasedRoute({
      agent: "build",
      userText: "Refactor the backend migration and API worker architecture",
      assistantText: "",
    })
    expect(decision.model).toBe("gpt-5.5")
  })

  it("defaults to gpt-5.4-mini for general coding", () => {
    const decision = ruleBasedRoute({
      agent: "build",
      userText: "Implement this helper",
      assistantText: "",
    })
    expect(decision.model).toBe("gpt-5.4-mini")
    expect(decision.modelID).toBe("gpt-5.4-mini")
  })

  it("routes debug tasks to deepseek", () => {
    const decision = ruleBasedRoute({
      agent: "build",
      userText: "Fix this bug and debug the crash",
      assistantText: "",
    })
    expect(decision.model).toBe("deepseek-v4-pro")
  })

  it("includes catalog in router prompt", () => {
    const prompt = buildRouterPrompt({
      agent: "build",
      userText: "Fix auth middleware",
      assistantText: "Sure",
    })
    expect(prompt).toContain("gpt-5.5")
    expect(prompt).toContain("claude-sonnet-4-6")
    expect(prompt).toContain("gemini-3.1-pro")
  })

  it("estimates router cost from token usage", () => {
    const cost = estimateRouterCost(1_000_000, 500_000)
    expect(cost).toBeCloseTo(0.035, 6)
  })

  it("formats route announcement with confidence and router cost", () => {
    const decision = targetToDecision(
      OTTILI_AUTO_TARGETS["claude-sonnet-4-6"],
      "Frontend/UI task detected",
      0.88,
      { routerCost: 0.0003, routerUsage: { input: 1200, output: 80 } },
    )
    expect(formatRouteAnnouncement(decision)).toBe(
      "Ottili Auto → Claude Sonnet 4.6 (88%) — Frontend/UI task detected · router ~$0.0003",
    )
  })

  it("resolves execution target synchronously for auto model", () => {
    const resolved = resolveExecutionTargetSync({
      agent: "ask",
      userText: "Explain this repo",
      assistantText: "",
    })
    expect(resolved.providerID).toBe("ottili-coder")
    expect(resolved.modelID).toBe("gemini-3.1-pro")
  })

  it("maps opus and deepseek router keys to zen model ids", () => {
    expect(OTTILI_AUTO_TARGETS["claude-opus-4-8"].modelID).toBe("claude-opus-4-8")
    expect(OTTILI_AUTO_TARGETS["deepseek-v4-pro"].modelID).toBe("deepseek-v4-pro")
    expect(OTTILI_AUTO_DEFAULT_TARGET.modelID).toBe("gpt-5.4-mini")
  })

  it("sends OpenRouter attribution headers on router requests", async () => {
    const calls: Array<{ headers: Record<string, string> }> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (_url: string, init: any) => {
      calls.push({ headers: init.headers })
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"model":"gpt-5.4-mini","providerID":"openai","confidence":0.9,"reason":"x"}',
              },
            },
          ],
        }),
        { status: 200 },
      )
    }) as any
    try {
      const decision = await routeWithLlama(
        { agent: "build", userText: "Add a button", assistantText: "" },
        "test-key",
      )
      expect(decision.model).toBe("gpt-5.4-mini")
    } finally {
      globalThis.fetch = original
    }
    expect(calls).toHaveLength(1)
    const headers = calls[0].headers
    expect(headers["HTTP-Referer"]).toBe("https://ottili.one/coder")
    expect(headers["X-Title"]).toBe("Ottili Coder")
    expect(headers["X-OpenRouter-Title"]).toBe("Ottili Coder")
    expect(headers["X-OpenRouter-Categories"]).toBe("cli-agent,cloud-agent,programming-app")
  })
})
