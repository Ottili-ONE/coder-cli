import { describe, expect, test } from "bun:test"
import {
  capSources,
  compactTokens,
  contextMeterState,
  CONTEXT_METER_MAX_SOURCES,
  detectNoColor,
  focusIndexForKind,
  moveFocus,
  parseContextError,
  redactError,
  renderUsageBar,
  type ContextMeterContext,
  type ContextMeterMessage,
  type ContextMeterProvider,
} from "./model"

const provider = (over: Partial<ContextMeterProvider> = {}): ContextMeterProvider => ({
  id: "openai",
  name: "OpenAI",
  models: {
    "gpt-4.1": { name: "gpt-4.1", limit: { context: 1000 } },
  },
  ...over,
})

const message = (over: Partial<ContextMeterMessage> = {}): ContextMeterMessage => ({
  role: "assistant",
  providerID: "openai",
  modelID: "gpt-4.1",
  cost: 0.03,
  tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 50, write: 10 } },
  ...over,
})

const ctx = (over: Partial<ContextMeterContext> = {}): ContextMeterContext => ({
  isReady: true,
  ...over,
})

describe("contextMeterState — status", () => {
  test("renders empty before data is ready", () => {
    const state = contextMeterState([], [provider()], ctx({ isReady: false }))
    expect(state.status).toBe("empty")
    expect(state.segments).toEqual([])
  })

  test("renders empty when ready but no assistant messages", () => {
    const state = contextMeterState([], [provider()], ctx())
    expect(state.status).toBe("empty")
  })

  test("renders ready with a known limit", () => {
    const state = contextMeterState([message()], [provider()], ctx())
    expect(state.status).toBe("ready")
    expect(state.data?.usagePercent).toBe(36) // 360/1000
  })

  test("renders unknown when the model limit is missing", () => {
    const p = provider({ models: { "gpt-4.1": { name: "gpt-4.1", limit: { context: 0 } } } })
    const state = contextMeterState([message()], [p], ctx())
    expect(state.status).toBe("unknown")
  })

  test("renders error and drops data when the harness reports an error", () => {
    const state = contextMeterState([message()], [provider()], ctx({ error: "session not found" }))
    expect(state.status).toBe("error")
    expect(state.data).toBeNull()
    expect(state.summaryText).toContain("session not available")
  })
})

describe("contextMeterState — narrow terminals", () => {
  test("drops wide-only segments (memory/compaction) below the narrow width", () => {
    const wide = contextMeterState([message()], [provider()], ctx(), { width: 200, expanded: true })
    const narrow = contextMeterState([message()], [provider()], ctx(), { width: 40, expanded: true })
    const wideKinds = wide.segments.map((s) => s.kind)
    const narrowKinds = narrow.segments.map((s) => s.kind)
    expect(wideKinds).toContain("memory")
    expect(wideKinds).toContain("compaction")
    expect(narrowKinds).not.toContain("memory")
    expect(narrowKinds).not.toContain("compaction")
  })

  test("default width is treated as wide", () => {
    const state = contextMeterState([message()], [provider()], ctx(), { expanded: true })
    expect(state.segments.map((s) => s.kind)).toContain("memory")
  })
})

describe("redaction", () => {
  test("redactError masks leaked secrets in diagnostics", () => {
    expect(redactError("Bearer sk-abcd1234efgh5678 leaked")).toBe("Bearer •••• sk-•••• leaked")
    expect(redactError("key=ghp_abcdefghijklmnopqrstuvwxyz012345")).toContain("ghp_••••")
    expect(redactError("AKIAIOSFODNN7EXAMPLE")).toBe("AKIA••••")
  })

  test("redactError bounds the message length", () => {
    const long = "x".repeat(500)
    expect(redactError(long).length).toBeLessThanOrEqual(240)
  })

  test("parseContextError maps known harness failures", () => {
    expect(parseContextError("session not found")).toBe("session not available")
    expect(parseContextError("provider not found")).toBe("provider not available")
    expect(parseContextError("rate limit exceeded")).toBe("usage refresh rate limited")
  })

  test("parseContextError redacts unknown errors rather than throwing", () => {
    const out = parseContextError("oops sk-zzzzzzzz9999 happened")
    expect(out).toContain("sk-••••")
    expect(out).not.toContain("sk-zzzzzzzz9999")
  })
})

describe("focus navigation", () => {
  test("moveFocus clamps at the ends and never wraps", () => {
    const state = contextMeterState([message()], [provider()], ctx(), { expanded: false })
    const last = state.segments.filter((s) => s.focusable).length - 1
    expect(moveFocus(state, 1)).toBe(Math.min(last, 1))
    const atEnd = { ...state, focusIndex: last }
    expect(moveFocus(atEnd, 1)).toBe(last)
    const atStart = { ...state, focusIndex: 0 }
    expect(moveFocus(atStart, -1)).toBe(0)
  })

  test("focusIndexForKind returns the focusable index", () => {
    const state = contextMeterState([message()], [provider()], ctx(), { expanded: false })
    expect(focusIndexForKind(state, "usage")).toBe(0)
    expect(focusIndexForKind(state, "cache")).toBe(1)
  })

  test("focus is preserved across rebuilds when passed back as an override", () => {
    const first = contextMeterState([message()], [provider()], ctx(), { focusIndex: 2 })
    const second = contextMeterState([message()], [provider()], ctx(), { focusIndex: first.focusIndex })
    expect(second.focusIndex).toBe(first.focusIndex)
  })
})

describe("terminal fallbacks", () => {
  test("renderUsageBar uses block glyphs with color", () => {
    const bar = renderUsageBar(50, { width: 10 })
    expect(bar).toContain("█")
    expect(bar).toContain("░")
    expect(bar.length).toBe(10)
  })

  test("renderUsageBar falls back to ASCII without color", () => {
    const bar = renderUsageBar(50, { width: 10, noColor: true })
    expect(bar).toContain("#")
    expect(bar).toContain("_")
    expect(bar).not.toContain("█")
  })

  test("renderUsageBar shows a neutral placeholder for an unknown limit", () => {
    expect(renderUsageBar(null, { noColor: true })).toBe("[?]")
    expect(renderUsageBar(null)).toBe("░".repeat(12))
  })

  test("detectNoColor honors NO_COLOR and dumb terminals", () => {
    const prev = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    expect(detectNoColor()).toBe(true)
    if (prev === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = prev
  })
})

describe("performance safeguards", () => {
  test("capSources leaves small lists untouched", () => {
    const sources = Array.from({ length: 5 }, (_, i) => ({
      key: "user" as const,
      label: `s${i}`,
      glyph: "▤",
      tokens: 10,
      percent: 10,
      focusable: true,
      wideOnly: false,
    }))
    expect(capSources(sources)).toHaveLength(5)
  })

  test("capSources merges the tail into a single other segment", () => {
    const sources = Array.from({ length: CONTEXT_METER_MAX_SOURCES + 5 }, (_, i) => ({
      key: "user" as const,
      label: `s${i}`,
      glyph: "▤",
      tokens: 10,
      percent: 5,
      focusable: true,
      wideOnly: false,
    }))
    const capped = capSources(sources)
    expect(capped.length).toBe(CONTEXT_METER_MAX_SOURCES + 1)
    const other = capped[capped.length - 1]
    expect(other.label).toContain("more")
    expect(other.key).toBe("other")
  })

  test("compactTokens formats large counts for narrow terminals", () => {
    expect(compactTokens(1_250_000)).toBe("1.3M")
    expect(compactTokens(12_500)).toBe("12.5k")
    expect(compactTokens(200)).toBe("200")
  })
})
