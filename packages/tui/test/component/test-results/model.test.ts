import { describe, expect, test } from "bun:test"
import {
  RENDER_BUDGET_DEFAULT,
  buildState,
  deriveStatus,
  effectiveSelection,
  filterTests,
  fitWidth,
  formatDuration,
  hiddenTestCount,
  isNarrowTerminal,
  moveSelection,
  nextFilter,
  normalizeTest,
  redactFailure,
  sortBySeverity,
  supportsColor,
  testCounts,
  testStatusGlyph,
  testStatusLabel,
  testSummary,
  visibleTests,
  type TestCaseInput,
  type TestCaseView,
  type TestResultsContext,
} from "../../../src/component/test-results/model"

function tc(input: Partial<TestCaseInput> & { id: string; status: TestCaseInput["status"] }): TestCaseInput {
  return { name: input.id, ...input }
}

function view(input: Partial<TestCaseView> & { id: string; status: TestCaseView["status"] }): TestCaseView {
  return { name: input.id, file: "", durationMs: 0, error: "", redacted: false, ...input }
}

function ctx(overrides: Partial<TestResultsContext> = {}): TestResultsContext {
  return { connected: true, permitted: true, running: false, loading: false, partial: false, ...overrides }
}

describe("normalizeTest", () => {
  test("redacts secrets in the error and bounds its length", () => {
    const v = normalizeTest(tc({ id: "a", status: "failed", error: "token = sk-abcdefghijklmnopqrstuvwxyz" }))
    expect(v.redacted).toBe(true)
    expect(v.error).not.toContain("sk-")
    expect(v.error.length).toBeLessThanOrEqual(240)
  })

  test("keeps passing cases clean and applies defaults", () => {
    const v = normalizeTest(tc({ id: "b", status: "passed" }))
    expect(v.redacted).toBe(false)
    expect(v.error).toBe("")
    expect(v.durationMs).toBe(0)
    expect(v.file).toBe("")
  })

  test("truncates very long error messages to the budget", () => {
    const huge = "x".repeat(1000)
    const v = normalizeTest(tc({ id: "c", status: "failed", error: huge }))
    expect(v.error.length).toBe(240)
  })

  test("is total on missing fields", () => {
    const v = normalizeTest(tc({ id: "d", status: "skipped" }))
    expect(v.name).toBe("d")
    expect(v.status).toBe("skipped")
  })
})

describe("deriveStatus classifies every required state", () => {
  const many = Array.from({ length: RENDER_BUDGET_DEFAULT + 1 }, (_, i) => view({ id: `t${i}`, status: "passed" }))

  test("offline wins over everything", () => {
    expect(deriveStatus(ctx({ connected: false }), [view({ id: "a", status: "passed" })], RENDER_BUDGET_DEFAULT, false)).toBe("offline")
  })
  test("denied when permission is missing", () => {
    expect(deriveStatus(ctx({ permitted: false }), [view({ id: "a", status: "passed" })], RENDER_BUDGET_DEFAULT, false)).toBe("denied")
  })
  test("failure when a harness error is present", () => {
    expect(deriveStatus(ctx({ error: "build failed" }), [view({ id: "a", status: "passed" })], RENDER_BUDGET_DEFAULT, false)).toBe("failure")
  })
  test("loading during discovery or an empty running run", () => {
    expect(deriveStatus(ctx({ loading: true }), [], RENDER_BUDGET_DEFAULT, false)).toBe("loading")
    expect(deriveStatus(ctx({ running: true }), [], RENDER_BUDGET_DEFAULT, false)).toBe("loading")
  })
  test("empty when no tests and not loading/running", () => {
    expect(deriveStatus(ctx(), [], RENDER_BUDGET_DEFAULT, false)).toBe("empty")
  })
  test("degraded when the run is partial", () => {
    expect(deriveStatus(ctx({ partial: true }), [view({ id: "a", status: "passed" })], RENDER_BUDGET_DEFAULT, false)).toBe("degraded")
  })
  test("long-content when over budget and collapsed", () => {
    expect(deriveStatus(ctx(), many, RENDER_BUDGET_DEFAULT, false)).toBe("long-content")
  })
  test("populated when within budget", () => {
    expect(deriveStatus(ctx(), [view({ id: "a", status: "passed" })], RENDER_BUDGET_DEFAULT, false)).toBe("populated")
    expect(deriveStatus(ctx(), many, RENDER_BUDGET_DEFAULT, true)).toBe("populated")
  })
})

describe("buildState", () => {
  test("indexes tests by id and derives status", () => {
    const state = buildState(
      [tc({ id: "a", status: "passed" }), tc({ id: "b", status: "failed" })],
      ctx(),
    )
    expect(Object.keys(state.byId).sort()).toEqual(["a", "b"])
    expect(state.status).toBe("populated")
    expect(state.filter).toBe("all")
    expect(state.showAll).toBe(false)
  })

  test("applies overrides on top of defaults", () => {
    const state = buildState([tc({ id: "a", status: "passed" })], ctx(), {
      selectedId: "a",
      filter: "failed",
      showAll: true,
      renderBudget: 5,
    })
    expect(state.selectedId).toBe("a")
    expect(state.filter).toBe("failed")
    expect(state.showAll).toBe(true)
    expect(state.renderBudget).toBe(5)
  })

  test("is safe on null/undefined input", () => {
    const state = buildState(undefined as unknown as TestCaseInput[], ctx())
    expect(state.tests).toEqual([])
    expect(state.status).toBe("empty")
  })
})

describe("testCounts", () => {
  test("aggregates per-status totals and durations", () => {
    const tests = [
      view({ id: "a", status: "passed", durationMs: 10 }),
      view({ id: "b", status: "failed", durationMs: 20, redacted: true }),
      view({ id: "c", status: "skipped", durationMs: 0 }),
      view({ id: "d", status: "todo", durationMs: 5 }),
    ]
    const c = testCounts(tests)
    expect(c).toMatchObject({ total: 4, passed: 1, failed: 1, skipped: 1, todo: 1, durationMs: 35, redacted: true })
  })

  test("handles an empty set", () => {
    expect(testCounts([])).toMatchObject({ total: 0, passed: 0, failed: 0, durationMs: 0, redacted: false })
  })
})

describe("filtering + budget", () => {
  const tests = [
    view({ id: "p1", status: "passed" }),
    view({ id: "p2", status: "passed" }),
    view({ id: "f1", status: "failed" }),
    view({ id: "s1", status: "skipped" }),
  ]

  test("filterTests narrows by status", () => {
    expect(filterTests(tests, "all").map((t) => t.id)).toEqual(["p1", "p2", "f1", "s1"])
    expect(filterTests(tests, "failed").map((t) => t.id)).toEqual(["f1"])
    expect(filterTests(tests, "passed").map((t) => t.id)).toEqual(["p1", "p2"])
  })

  test("nextFilter cycles all → failed → passed → skipped → todo → all", () => {
    expect(nextFilter("all")).toBe("failed")
    expect(nextFilter("failed")).toBe("passed")
    expect(nextFilter("passed")).toBe("skipped")
    expect(nextFilter("skipped")).toBe("todo")
    expect(nextFilter("todo")).toBe("all")
  })

  test("visibleTests applies the render budget unless expanded", () => {
    const big = Array.from({ length: 250 }, (_, i) => view({ id: `t${i}`, status: "passed" }))
    const collapsed = buildState(big, ctx(), { renderBudget: 200 })
    expect(visibleTests(collapsed)).toHaveLength(200)
    expect(hiddenTestCount(collapsed)).toBe(50)
    const expanded = buildState(big, ctx(), { renderBudget: 200, showAll: true })
    expect(visibleTests(expanded)).toHaveLength(250)
    expect(hiddenTestCount(expanded)).toBe(0)
  })

  test("hiddenTestCount respects the active filter", () => {
    const big = Array.from({ length: 250 }, (_, i) => view({ id: `t${i}`, status: "passed" }))
    const state = buildState(big, ctx(), { renderBudget: 200, filter: "failed" })
    expect(visibleTests(state)).toHaveLength(0)
    expect(hiddenTestCount(state)).toBe(0)
  })
})

describe("selection", () => {
  const list = [
    view({ id: "a", status: "passed" }),
    view({ id: "b", status: "passed" }),
    view({ id: "c", status: "failed" }),
  ]

  test("effectiveSelection defaults to the first visible test", () => {
    expect(effectiveSelection(buildState(list, ctx()))).toBe("a")
  })

  test("effectiveSelection keeps a still-visible selected id", () => {
    expect(effectiveSelection(buildState(list, ctx(), { selectedId: "b" }))).toBe("b")
  })

  test("effectiveSelection falls back to first visible when filtered out", () => {
    const state = buildState(list, ctx(), { selectedId: "a", filter: "failed" })
    expect(effectiveSelection(state)).toBe("c")
  })

  test("effectiveSelection is null for an empty run", () => {
    expect(effectiveSelection(buildState([], ctx()))).toBeNull()
  })

  test("moveSelection walks and clamps within visible bounds", () => {
    const state = buildState(list, ctx())
    expect(moveSelection(state, 1)).toBe("b")
    expect(moveSelection({ ...state, selectedId: "b" }, 1)).toBe("c")
    expect(moveSelection({ ...state, selectedId: "c" }, 1)).toBe("c")
    expect(moveSelection({ ...state, selectedId: "c" }, -1)).toBe("b")
    expect(moveSelection({ ...state, selectedId: "a" }, -1)).toBe("a")
  })

  test("moveSelection honors the active filter", () => {
    const list2 = [
      view({ id: "a", status: "passed" }),
      view({ id: "b", status: "failed" }),
      view({ id: "c", status: "failed" }),
    ]
    const state = buildState(list2, ctx(), { filter: "failed" })
    expect(moveSelection(state, 1)).toBe("c")
    expect(moveSelection({ ...state, selectedId: "c" }, -1)).toBe("b")
  })

  test("moveSelection returns null for an empty run", () => {
    expect(moveSelection(buildState([], ctx()), 1)).toBeNull()
  })
})

describe("sortBySeverity", () => {
  test("orders failures first, then todo, skipped, passed", () => {
    const sorted = sortBySeverity([
      view({ id: "p", status: "passed" }),
      view({ id: "s", status: "skipped" }),
      view({ id: "f", status: "failed" }),
      view({ id: "t", status: "todo" }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(["f", "t", "s", "p"])
  })
})

describe("terminal fallbacks", () => {
  test("isNarrowTerminal detects narrow widths", () => {
    expect(isNarrowTerminal(40)).toBe(true)
    expect(isNarrowTerminal(60)).toBe(false)
    expect(isNarrowTerminal(59, 60)).toBe(true)
  })

  test("fitWidth truncates without breaking on tiny widths", () => {
    expect(fitWidth("hello world", 20)).toBe("hello world")
    expect(fitWidth("hello world", 5)).toBe("hell…")
    expect(fitWidth("hi", 1)).toBe("h…")
  })

  test("supportsColor reflects the color level", () => {
    expect(supportsColor(0)).toBe(false)
    expect(supportsColor(3)).toBe(true)
  })

  test("status glyphs differ for color vs no-color terminals", () => {
    expect(testStatusGlyph("passed", true)).toBe("✓")
    expect(testStatusGlyph("passed", false)).toBe("P")
    expect(testStatusGlyph("failed", true)).toBe("✗")
    expect(testStatusGlyph("failed", false)).toBe("X")
    expect(testStatusLabel("skipped")).toBe("skipped")
  })
})

describe("formatDuration", () => {
  test("renders compact durations", () => {
    expect(formatDuration(0)).toBe("0ms")
    expect(formatDuration(250)).toBe("250ms")
    expect(formatDuration(1500)).toBe("1.5s")
    expect(formatDuration(65_000)).toBe("1m5s")
    expect(formatDuration(-5)).toBe("0ms")
  })
})

describe("testSummary", () => {
  test("describes every status and redacts failure context", () => {
    expect(testSummary(buildState([], ctx({ loading: true })))).toContain("loading")
    expect(testSummary(buildState([], ctx({ connected: false })))).toContain("offline")
    expect(testSummary(buildState([], ctx({ permitted: false })))).toContain("permission")
    expect(testSummary(buildState([], ctx({ error: "Bearer secret-token-1234567890" })))).toContain("••••")
    expect(testSummary(buildState([], ctx()))).toContain("no tests")
    const populated = buildState(
      [view({ id: "a", status: "passed" }), view({ id: "b", status: "failed" }), view({ id: "c", status: "skipped" })],
      ctx(),
    )
    expect(testSummary(populated)).toContain("1 passed")
    expect(testSummary(populated)).toContain("1 failed")
    expect(testSummary(populated)).toContain("1 skipped")
  })
})

describe("redactFailure", () => {
  test("masks secrets in harness failure messages", () => {
    expect(redactFailure("api_key = supersecretvalue123")).toContain("••••")
    expect(redactFailure("clean message")).toBe("clean message")
  })
})
