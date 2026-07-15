import { describe, expect, test } from "bun:test"
import {
  MARKDOWN_MAX_LEN,
  MARKDOWN_RENDER_BUDGET,
  buildMarkdownState,
  createMarkdownThrottle,
  deriveMarkdownStatus,
  isMarkdownNarrow,
  markdownAriaLabel,
  markdownStatusGlyph,
  markdownStatusLabel,
  markdownSummary,
  truncateToBudget,
  withinBudget,
  type MarkdownStatus,
} from "./state"

const SECRET = "Bearer sk-live-abcdefghijklmnop leaked"

describe("deriveMarkdownStatus precedence", () => {
  test("loading wins over every other state", () => {
    expect(deriveMarkdownStatus("", { loading: true, connected: false, permitted: false, error: "x", degraded: true })).toBe("loading")
  })

  test("offline beats denied/failure/empty/degraded", () => {
    expect(deriveMarkdownStatus("", { connected: false, permitted: false })).toBe("offline")
  })

  test("denied beats failure/empty/degraded", () => {
    expect(deriveMarkdownStatus("", { permitted: false, error: "x", degraded: true })).toBe("denied")
  })

  test("failure beats empty/degraded", () => {
    expect(deriveMarkdownStatus("", { error: "boom", degraded: true })).toBe("failure")
  })

  test("empty when there is no content", () => {
    expect(deriveMarkdownStatus("", {})).toBe("empty")
    expect(deriveMarkdownStatus("   \n  ", {})).toBe("empty")
  })

  test("degraded before long-content/populated", () => {
    expect(deriveMarkdownStatus("# hi", { degraded: true })).toBe("degraded")
  })

  test("long-content when content exceeds the render budget", () => {
    expect(deriveMarkdownStatus("a".repeat(MARKDOWN_RENDER_BUDGET + 1), {})).toBe("long-content")
  })

  test("populated for normal content", () => {
    expect(deriveMarkdownStatus("# Hello\n\nworld", {})).toBe("populated")
  })
})

describe("truncateToBudget", () => {
  test("passes through content under the cap", () => {
    const out = truncateToBudget("short", 100)
    expect(out).toEqual({ text: "short", truncated: false, dropped: 0 })
  })

  test("truncates runaway content and reports dropped chars", () => {
    const big = "x".repeat(MARKDOWN_MAX_LEN + 1000)
    const out = truncateToBudget(big)
    expect(out.truncated).toBe(true)
    expect(out.dropped).toBe(1000)
    expect(out.text.length).toBeLessThanOrEqual(MARKDOWN_MAX_LEN + 64)
  })
})

describe("buildMarkdownState", () => {
  test("normal content is populated and not truncated", () => {
    const state = buildMarkdownState("# Title\n\nbody")
    expect(state.status).toBe("populated")
    expect(state.truncated).toBe(false)
    expect(state.droppedChars).toBe(0)
    expect(state.redacted).toBe(false)
  })

  test("huge content truncates and reports dropped chars", () => {
    const big = "x".repeat(MARKDOWN_MAX_LEN + 1000)
    const state = buildMarkdownState(big)
    expect(state.truncated).toBe(true)
    expect(state.droppedChars).toBe(1000)
    expect(state.status).toBe("long-content")
  })

  test("flags redacted content without mutating the input", () => {
    const input = `note: ${SECRET}`
    const state = buildMarkdownState(input)
    expect(state.redacted).toBe(true)
    expect(input).toContain("sk-live-abcdefghijklmnop")
  })

  test("honors an explicit render budget", () => {
    const state = buildMarkdownState("y".repeat(5000), {}, { renderBudget: 100 })
    expect(state.status).toBe("long-content")
    expect(state.renderBudget).toBe(100)
  })
})

describe("markdown status labels and glyphs", () => {
  const STATUSES: MarkdownStatus[] = [
    "loading",
    "empty",
    "populated",
    "long-content",
    "failure",
    "denied",
    "offline",
    "degraded",
  ]

  test("labels are explicit words (never color-only)", () => {
    expect(markdownStatusLabel("loading")).toBe("Loading")
    expect(markdownStatusLabel("denied")).toBe("Permission denied")
    expect(markdownStatusLabel("offline")).toBe("Offline")
  })

  test("glyphs are colored when color is on, bracket tags when off", () => {
    for (const status of STATUSES) {
      expect(markdownStatusGlyph(status, true).length).toBeGreaterThan(0)
      expect(markdownStatusGlyph(status, false)).toMatch(/^\[.+\]$/)
    }
  })
})

describe("markdownSummary + aria", () => {
  test("summarizes normal content by length", () => {
    expect(markdownSummary(buildMarkdownState("hello world"))).toBe("Markdown: 11 characters")
  })

  test("reports a failure with the error message redacted", () => {
    const state = buildMarkdownState("", { error: `failed: ${SECRET}` })
    const summary = markdownSummary(state)
    expect(summary).toContain("failed to render")
    expect(summary).not.toContain("sk-live-abcdefghijklmnop")
  })

  test("aria label is self-contained and never leaks secrets", () => {
    const state = buildMarkdownState("", { error: `failed: ${SECRET}` })
    const label = markdownAriaLabel(state)
    expect(label).toContain("failed to render")
    expect(label).not.toContain("sk-live-abcdefghijklmnop")
  })

  test("long-content summary reports dropped chars", () => {
    const big = "x".repeat(MARKDOWN_MAX_LEN + 1000)
    expect(markdownSummary(buildMarkdownState(big))).toContain("truncated")
  })
})

describe("narrow terminal fallback", () => {
  test("collapses at the narrow width", () => {
    expect(isMarkdownNarrow(40)).toBe(true)
    expect(isMarkdownNarrow(80)).toBe(false)
  })
})

describe("withinBudget", () => {
  test("truncates over-budget content with a marker", () => {
    const out = withinBudget("a".repeat(100), 10)
    expect(out.length).toBe(10)
    expect(out.endsWith("…")).toBe(true)
  })

  test("passes through under-budget content", () => {
    expect(withinBudget("short", 100)).toBe("short")
  })
})

describe("createMarkdownThrottle", () => {
  test("commits the first push immediately and coalesces a burst", () => {
    const commits: string[][] = []
    const throttle = createMarkdownThrottle((value: string) => commits.push([value]))

    throttle.push("a")
    expect(commits).toHaveLength(1)
    expect(commits[0]).toEqual(["a"])

    throttle.push("b")
    throttle.push("c")
    expect(commits).toHaveLength(1) // trailing not committed yet
    expect(throttle.pending()).toBe(1)

    throttle.flush()
    expect(commits).toHaveLength(2)
    expect(commits[1]).toEqual(["c"]) // latest value wins
  })

  test("flushes nothing when empty", () => {
    const commits: string[][] = []
    const throttle = createMarkdownThrottle((value: string) => commits.push([value]))
    throttle.flush()
    expect(commits).toHaveLength(0)
  })
})
