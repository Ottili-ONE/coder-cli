import { describe, expect, test } from "bun:test"
import type { Context } from "./session-context-metrics"
import {
  clampPercent,
  deriveContextMeterState,
  formatCompactNumber,
  isLongContent,
  redactSensitive,
  truncateLabel,
  type ContextMeterInput,
} from "./session-context-usage-state"

const ctx = (overrides: Partial<Context> = {}): Context => ({
  message: { id: "a1", role: "assistant" } as Context["message"],
  provider: undefined,
  model: undefined,
  providerLabel: "OpenAI",
  modelLabel: "gpt-4.1",
  limit: 1000,
  input: 100,
  output: 100,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 200,
  usage: 20,
  ...overrides,
})

const input = (overrides: Partial<ContextMeterInput> = {}): ContextMeterInput => ({
  status: "complete",
  providerReady: true,
  messageCount: 1,
  context: ctx(),
  totalCost: 1.25,
  offline: false,
  denied: false,
  error: false,
  ...overrides,
})

describe("deriveContextMeterState", () => {
  test("renders loading before messages arrive", () => {
    const state = deriveContextMeterState(input({ status: "loading", messageCount: 0 }))
    expect(state.kind).toBe("loading")
  })

  test("renders empty once loaded with no messages", () => {
    const state = deriveContextMeterState(input({ messageCount: 0, context: undefined }))
    expect(state.kind).toBe("empty")
  })

  test("renders populated with a known limit", () => {
    const state = deriveContextMeterState(input())
    expect(state.kind).toBe("populated")
    expect(state.usage).toBe(20)
    expect(state.hasLimit).toBe(true)
  })

  test("renders degraded when the limit is unknown", () => {
    const state = deriveContextMeterState(input({ context: ctx({ usage: null, limit: undefined }) }))
    expect(state.kind).toBe("degraded")
    expect(state.hasLimit).toBe(false)
  })

  test("renders degraded when providers are not ready", () => {
    const state = deriveContextMeterState(input({ providerReady: false }))
    expect(state.kind).toBe("degraded")
  })

  test("renders long-content for very large token counts", () => {
    const state = deriveContextMeterState(input({ context: ctx({ total: 250_000, usage: 100 }) }))
    expect(state.kind).toBe("long-content")
    expect(state.isLongContent).toBe(true)
  })

  test("renders long-content for over-long labels", () => {
    const state = deriveContextMeterState(
      input({ context: ctx({ providerLabel: "a-very-long-provider-name-that-exceeds", modelLabel: "m" }) }),
    )
    expect(state.kind).toBe("long-content")
  })

  test("renders failure when metrics cannot be read", () => {
    const state = deriveContextMeterState(input({ error: true }))
    expect(state.kind).toBe("failure")
  })

  test("renders denied when access is blocked", () => {
    const state = deriveContextMeterState(input({ denied: true }))
    expect(state.kind).toBe("denied")
  })

  test("renders offline and still carries last-known metrics", () => {
    const state = deriveContextMeterState(input({ offline: true }))
    expect(state.kind).toBe("offline")
    expect(state.usage).toBe(20)
  })

  test("prioritizes offline over failure over denied over loading", () => {
    const state = deriveContextMeterState(
      input({ offline: true, error: true, denied: true, status: "loading", messageCount: 0 }),
    )
    expect(state.kind).toBe("offline")
  })

  test("prioritizes failure over denied over empty", () => {
    const state = deriveContextMeterState(input({ error: true, denied: true, messageCount: 0, context: undefined }))
    expect(state.kind).toBe("failure")
  })

  test("prioritizes long-content over degraded", () => {
    const state = deriveContextMeterState(
      input({ providerReady: false, context: ctx({ total: 250_000, usage: 100 }) }),
    )
    expect(state.kind).toBe("long-content")
  })
})

describe("redactSensitive", () => {
  test("masks api key shapes", () => {
    expect(redactSensitive("sk-abcd1234efgh5678")).toBe("••••")
    expect(redactSensitive("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe("••••")
    expect(redactSensitive("AKIAIOSFODNN7EXAMPLE")).toBe("••••")
  })

  test("leaves ordinary labels untouched", () => {
    expect(redactSensitive("OpenAI")).toBe("OpenAI")
    expect(redactSensitive("gpt-4.1")).toBe("gpt-4.1")
  })

  test("redacts a leaked key embedded in a label", () => {
    expect(redactSensitive("provider sk-abcd1234efgh5678 name")).toBe("provider •••• name")
  })
})

describe("formatCompactNumber", () => {
  test("compacts millions", () => {
    expect(formatCompactNumber(1_250_000, "en")).toBe("1.3M")
  })

  test("keeps thousands readable", () => {
    expect(formatCompactNumber(12_500, "en")).toBe("12,500")
  })

  test("formats small numbers plainly", () => {
    expect(formatCompactNumber(200, "en")).toBe("200")
  })

  test("guards non-finite input", () => {
    expect(formatCompactNumber(NaN, "en")).toBe("0")
  })
})

describe("truncateLabel", () => {
  test("leaves short labels intact", () => {
    expect(truncateLabel("OpenAI")).toBe("OpenAI")
  })

  test("truncates and appends ellipsis", () => {
    const out = truncateLabel("a-very-long-provider-name-that-exceeds")
    expect(out.endsWith("…")).toBe(true)
    expect(out.length).toBe(24)
  })
})

describe("clampPercent", () => {
  test("clamps out-of-range values", () => {
    expect(clampPercent(140)).toBe(100)
    expect(clampPercent(-20)).toBe(0)
  })

  test("passes through null and non-finite as zero", () => {
    expect(clampPercent(null)).toBe(0)
    expect(clampPercent(NaN)).toBe(0)
  })
})

describe("isLongContent", () => {
  test("flags large token totals", () => {
    expect(isLongContent({ total: 200_000, providerLabel: "x", modelLabel: "y" })).toBe(true)
  })

  test("flags over-long labels", () => {
    expect(isLongContent({ total: 10, providerLabel: "x".repeat(30), modelLabel: "y" })).toBe(true)
  })

  test("is false for normal content", () => {
    expect(isLongContent({ total: 500, providerLabel: "OpenAI", modelLabel: "gpt-4.1" })).toBe(false)
  })
})
