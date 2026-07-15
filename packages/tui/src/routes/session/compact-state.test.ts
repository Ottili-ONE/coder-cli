import { describe, expect, test } from "bun:test"
import {
  classifyCompactState,
  compactViewState,
  accessibleCompactSummary,
  summarizeCompactState,
  isLongContent,
  windowMessages,
  truncateStreamPreview,
  COMPACT_MAX_RENDERED_MESSAGES,
  COMPACT_LONG_CONTENT_CHARS,
  COMPACT_LONG_CONTENT_TOTAL_CHARS,
  type CompactViewContext,
  type CompactViewData,
} from "./compact-state"

const data = (over: Partial<CompactViewData> = {}): CompactViewData => ({
  messageCount: 0,
  hasContent: false,
  longestMessageLength: 0,
  totalChars: 0,
  runningCount: 0,
  ...over,
})

const ctx = (over: Partial<CompactViewContext> = {}): CompactViewContext => ({
  isReady: true,
  ...over,
})

describe("classifyCompactState — harness failures take precedence", () => {
  test("offline wins over everything else", () => {
    expect(classifyCompactState(ctx({ offline: true, denied: true, error: "x" }), data({ hasContent: true }))).toBe("offline")
  })
  test("denied wins over error and content", () => {
    expect(classifyCompactState(ctx({ denied: true, error: "x" }), data({ hasContent: true }))).toBe("denied")
  })
  test("failure wins over loading/content", () => {
    expect(classifyCompactState(ctx({ error: "boom" }), data({ hasContent: true }))).toBe("failure")
  })
  test("loading while not ready is loading, not empty", () => {
    expect(classifyCompactState(ctx({ isReady: false, loading: true }), data())).toBe("loading")
  })
  test("not ready and not loading is empty", () => {
    expect(classifyCompactState(ctx({ isReady: false }), data())).toBe("empty")
  })
  test("ready with no messages is empty", () => {
    expect(classifyCompactState(ctx(), data())).toBe("empty")
  })
  test("degraded with content is degraded", () => {
    expect(classifyCompactState(ctx({ degraded: true }), data({ messageCount: 1, hasContent: true }))).toBe("degraded")
  })
  test("degraded without content falls through to empty", () => {
    expect(classifyCompactState(ctx({ degraded: true }), data())).toBe("empty")
  })
  test("long content is detected by longest message or total volume", () => {
    expect(
      classifyCompactState(ctx(), data({ messageCount: 1, hasContent: true, longestMessageLength: COMPACT_LONG_CONTENT_CHARS })),
    ).toBe("long-content")
    expect(
      classifyCompactState(ctx(), data({ messageCount: 1, hasContent: true, totalChars: COMPACT_LONG_CONTENT_TOTAL_CHARS })),
    ).toBe("long-content")
  })
  test("content without long threshold is populated", () => {
    expect(classifyCompactState(ctx(), data({ hasContent: true, messageCount: 3 }))).toBe("populated")
  })
})

describe("isLongContent — thresholds", () => {
  test("true at exactly the longest-message boundary", () => {
    expect(isLongContent(data({ longestMessageLength: COMPACT_LONG_CONTENT_CHARS }))).toBe(true)
  })
  test("true at exactly the total-volume boundary", () => {
    expect(isLongContent(data({ totalChars: COMPACT_LONG_CONTENT_TOTAL_CHARS }))).toBe(true)
  })
  test("false just below both thresholds", () => {
    expect(isLongContent(data({ longestMessageLength: COMPACT_LONG_CONTENT_CHARS - 1 }))).toBe(false)
  })
})

describe("summarizeCompactState — words carry the meaning, no color dependency", () => {
  test("loading", () => {
    expect(summarizeCompactState("loading", ctx(), data())).toContain("Loading")
  })
  test("empty", () => {
    expect(summarizeCompactState("empty", ctx(), data())).toBe("No messages yet")
  })
  test("populated reports the message count", () => {
    expect(summarizeCompactState("populated", ctx(), data({ messageCount: 4, hasContent: true }))).toContain("4 messages")
  })
  test("long-content is named explicitly", () => {
    expect(summarizeCompactState("long-content", ctx(), data({ messageCount: 9, hasContent: true }))).toContain(
      "long content",
    )
  })
  test("offline and denied are explicit and actionable", () => {
    expect(summarizeCompactState("offline", ctx(), data())).toBe("Session — offline")
    expect(summarizeCompactState("denied", ctx(), data())).toBe("Session — access denied")
  })
  test("noColor flag leaves the string identical (color is secondary)", () => {
    const colored = summarizeCompactState("populated", ctx(), data({ messageCount: 2, hasContent: true }), false)
    const plain = summarizeCompactState("populated", ctx(), data({ messageCount: 2, hasContent: true }), true)
    expect(plain).toBe(colored)
  })
})

describe("summarizeCompactState — failure redacts secrets in diagnostics", () => {
  test("a raw error with a bearer token is redacted", () => {
    const out = summarizeCompactState("failure", ctx({ error: "request failed: Bearer sk_live_abc123def456" }), data())
    expect(out).not.toContain("sk_live_abc123def456")
    expect(out).toContain("••••")
  })
  test("a raw error with an api key assignment is redacted", () => {
    const out = summarizeCompactState("failure", ctx({ error: "auth error api_key=AKIA1234567890SECRET" }), data())
    expect(out).not.toContain("AKIA1234567890SECRET")
  })
  test("a known error class is mapped to a friendly message", () => {
    expect(summarizeCompactState("failure", ctx({ error: "session not found: abc" }), data())).toContain(
      "session not available",
    )
    expect(summarizeCompactState("failure", ctx({ error: "403 forbidden" }), data())).toContain("access denied")
  })
})

describe("accessibleCompactSummary — spoken form for screen readers", () => {
  test("populated includes count and streaming detail", () => {
    const out = accessibleCompactSummary(
      "populated",
      ctx(),
      data({ messageCount: 3, hasContent: true, runningCount: 1 }),
    )
    expect(out).toContain("3 messages")
    expect(out).toContain("1 streaming")
  })
  test("long-content flags the long content", () => {
    const out = accessibleCompactSummary(
      "long-content",
      ctx(),
      data({ messageCount: 5, hasContent: true, longestMessageLength: COMPACT_LONG_CONTENT_CHARS }),
    )
    expect(out).toContain("long content")
  })
  test("terminal states carry only the base sentence (no false detail)", () => {
    expect(accessibleCompactSummary("offline", ctx(), data())).toBe("Session — offline")
    expect(accessibleCompactSummary("loading", ctx(), data())).toBe("Loading session…")
  })
})

describe("compactViewState — derived view state", () => {
  test("reports narrow + noColor from terminal dimensions", () => {
    const prev = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    try {
      const state = compactViewState({
        ctx: ctx(),
        data: data({ messageCount: 2, hasContent: true }),
        opts: { width: 60, noColor: true },
      })
      expect(state.narrow).toBe(true)
      expect(state.noColor).toBe(true)
      expect(state.status).toBe("populated")
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = prev
    }
  })
  test("wide terminal is not narrow and honors an explicit noColor=false", () => {
    const state = compactViewState({
      ctx: ctx(),
      data: data({ messageCount: 2, hasContent: true }),
      opts: { width: 200, noColor: false },
    })
    expect(state.narrow).toBe(false)
    expect(state.noColor).toBe(false)
  })
  test("stale is true only when loading over a live view", () => {
    const live = compactViewState({
      ctx: ctx({ loading: true }),
      data: data({ messageCount: 2, hasContent: true }),
    })
    expect(live.stale).toBe(true)
    const settled = compactViewState({
      ctx: ctx({ loading: false }),
      data: data({ messageCount: 2, hasContent: true }),
    })
    expect(settled.stale).toBe(false)
  })
  test("render budget defaults are sane and overridable", () => {
    const state = compactViewState({ ctx: ctx(), data: data() })
    expect(state.renderBudget.maxMessages).toBe(COMPACT_MAX_RENDERED_MESSAGES)
    expect(state.renderBudget.resampleMs).toBeGreaterThan(0)
    const overridden = compactViewState({
      ctx: ctx(),
      data: data(),
      opts: { maxRenderedMessages: 10, streamPreviewChars: 50, resampleMs: 100 },
    })
    expect(overridden.renderBudget.maxMessages).toBe(10)
    expect(overridden.renderBudget.streamPreviewChars).toBe(50)
    expect(overridden.renderBudget.resampleMs).toBe(100)
  })
  test("meterText is a short word for narrow terminals", () => {
    const state = compactViewState({ ctx: ctx(), data: data({ messageCount: 2, hasContent: true }) })
    expect(state.meterText).toBe("live")
    const offline = compactViewState({ ctx: ctx({ offline: true }), data: data() })
    expect(offline.meterText).toBe("offline")
  })
  test("function is pure and deterministic for identical inputs", () => {
    const input = { ctx: ctx(), data: data({ messageCount: 2, hasContent: true }) }
    expect(compactViewState(input)).toEqual(compactViewState(input))
  })
})

describe("windowMessages — performance budget for large transcripts", () => {
  const list = Array.from({ length: 1000 }, (_, i) => ({ id: i }))
  test("returns the full list when disabled", () => {
    expect(windowMessages(list, 600, false)).toBe(list)
  })
  test("returns the full list when under budget", () => {
    expect(windowMessages(list, 2000, true).length).toBe(1000)
  })
  test("keeps only the most recent tail when over budget", () => {
    const windowed = windowMessages(list, 600, true)
    expect(windowed.length).toBe(600)
    expect(windowed[0].id).toBe(400)
    expect(windowed[599].id).toBe(999)
  })
  test("tail window keeps stable item references so DOM nodes are reused", () => {
    const windowed = windowMessages(list, 600, true)
    expect(windowed[599]).toBe(list[999])
  })
})

describe("truncateStreamPreview — bounds a single streaming message", () => {
  test("returns short text unchanged", () => {
    expect(truncateStreamPreview("hello", 2000)).toBe("hello")
  })
  test("truncates long text with an ellipsis", () => {
    const out = truncateStreamPreview("x".repeat(5000), 2000)
    expect(out.length).toBe(2000)
    expect(out.endsWith("…")).toBe(true)
  })
})
