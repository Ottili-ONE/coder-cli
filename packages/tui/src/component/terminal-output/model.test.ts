import { describe, expect, test } from "bun:test"
import {
  buildState,
  buildTerminalLine,
  classifyLine,
  deriveStatus,
  effectiveSelection,
  foldLines,
  foldMarkerLine,
  isNarrow,
  matchCount,
  moveSelection,
  NARROW_WIDTH_DEFAULT,
  terminalSummary,
  truncateLine,
  visibleIds,
  visibleLines,
  type TerminalOutputContext,
  type TerminalLine,
} from "./model"

function line(id: number, raw: string): TerminalLine {
  return { id, raw, text: raw, level: "info" }
}

function ctx(overrides: Partial<TerminalOutputContext> = {}): TerminalOutputContext {
  return { complete: false, ...overrides }
}

describe("buildTerminalLine", () => {
  test("strips ANSI and classifies", () => {
    const l = buildTerminalLine(1, "\x1b[31mhello\x1b[0m")
    expect(l.text).toBe("hello")
    expect(l.raw).toBe("\x1b[31mhello\x1b[0m")
    expect(l.level).toBe("info")
  })

  test("classifies error text", () => {
    const l = buildTerminalLine(2, "Error: crash")
    expect(l.level).toBe("error")
  })

  test("classifies warning text", () => {
    const l = buildTerminalLine(3, "warning: deprecated")
    expect(l.level).toBe("warn")
  })
})

describe("classifyLine", () => {
  test("returns info for safe text", () => {
    expect(classifyLine("normal log")).toBe("info")
  })

  test("detects error patterns", () => {
    expect(classifyLine("failed")).toBe("error")
    expect(classifyLine("exception thrown")).toBe("error")
    expect(classifyLine("timed out")).toBe("error")
    expect(classifyLine("traceback: something")).toBe("error")
  })

  test("detects warning patterns", () => {
    expect(classifyLine("Deprecated: old api")).toBe("warn")
    expect(classifyLine("caution: slow")).toBe("warn")
    expect(classifyLine("attempt 3")).toBe("warn")
  })
})

describe("deriveStatus", () => {
  test("failure wins over everything", () => {
    expect(deriveStatus([line(1, "a")], ctx({ failure: "err", complete: true }))).toBe("failure")
    expect(deriveStatus([], ctx({ failure: "err" }))).toBe("failure")
  })

  test("empty lines returns empty", () => {
    expect(deriveStatus([], ctx({ complete: false }))).toBe("empty")
  })

  test("lines with complete returns complete", () => {
    expect(deriveStatus([line(1, "a")], ctx({ complete: true }))).toBe("complete")
  })

  test("lines without complete returns streaming", () => {
    expect(deriveStatus([line(1, "a")], ctx({ complete: false }))).toBe("streaming")
  })
})

describe("matchCount", () => {
  test("returns 0 for empty query", () => {
    expect(matchCount([line(1, "a")], "")).toBe(0)
  })

  test("case-insensitive match", () => {
    const lines = [line(1, "Hello World"), line(2, "goodbye"), line(3, "hello again")]
    expect(matchCount(lines, "hello")).toBe(2)
    expect(matchCount(lines, "HELLO")).toBe(2)
  })
})

describe("foldLines", () => {
  test("does not fold when not requested", () => {
    const lines = Array.from({ length: 100 }, (_, i) => line(i, `l${i}`))
    const result = foldLines(lines, { folded: false })
    expect(result.hidden).toBe(0)
    expect(result.lines).toHaveLength(100)
  })

  test("does not fold when too short", () => {
    const result = foldLines([line(1, "a"), line(2, "b")], { folded: true })
    expect(result.hidden).toBe(0)
    expect(result.collapsible).toBe(false)
  })

  test("folds long output keeping head and tail", () => {
    const lines = Array.from({ length: 20 }, (_, i) => line(i, `l${i}`))
    const result = foldLines(lines, { folded: true })
    expect(result.hidden).toBeGreaterThan(0)
    const visible = result.lines
    expect(visible[0].text).toBe("l0")
    expect(visible[visible.length - 1].text).toBe("l19")
    expect(visible.some((l) => l.isFoldMarker)).toBe(true)
  })
})

describe("visibleLines", () => {
  test("returns all lines when not folded", () => {
    const lines = [line(1, "a"), line(2, "b")]
    const state = buildState(lines, ctx({ complete: true }))
    const result = visibleLines(state)
    expect(result.lines).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  test("filters by query while searching", () => {
    const lines = [line(1, "hello"), line(2, "nope"), line(3, "hello again")]
    const state = buildState(lines, ctx({ complete: true }), { query: "hello" })
    const result = visibleLines(state)
    expect(result.lines).toHaveLength(2)
    expect(result.matched).toBe(2)
  })

  test("searching never folds", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `hello ${i}`))
    const state = buildState(lines, ctx({ complete: true }), { query: "hello", folded: true })
    const result = visibleLines(state)
    expect(result.lines).toHaveLength(50)
  })

  test("folded output reduces visible lines with fold marker", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({ complete: true }), { folded: true })
    const result = visibleLines(state)
    expect(result.hidden).toBeGreaterThan(0)
    expect(result.lines.some((l) => l.isFoldMarker)).toBe(true)
  })
})

describe("visibleIds", () => {
  test("returns visible non-marker line ids", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }))
    expect(visibleIds(state)).toEqual([1, 2])
  })

  test("skips fold markers", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({ complete: true }), { folded: true })
    expect(visibleIds(state)).not.toContain(-1)
  })
})

describe("effectiveSelection", () => {
  test("returns null when no visible lines", () => {
    const state = buildState([], ctx({}))
    expect(effectiveSelection(state)).toBeNull()
  })

  test("returns stored selection when visible", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }), { selectedId: 2 })
    expect(effectiveSelection(state)).toBe(2)
  })

  test("falls back to first visible when hidden", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({ complete: true }), { folded: true, selectedId: 30 })
    expect(effectiveSelection(state)).toBe(0)
  })
})

describe("moveSelection", () => {
  test("moves down", () => {
    const state = buildState([line(1, "a"), line(2, "b"), line(3, "c")], ctx({ complete: true }), { selectedId: 1 })
    expect(moveSelection(state, 1)).toBe(2)
  })

  test("moves up", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }), { selectedId: 2 })
    expect(moveSelection(state, -1)).toBe(1)
  })

  test("clamps at boundaries", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }), { selectedId: 1 })
    expect(moveSelection(state, -1)).toBe(1)
    const atEnd = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }), { selectedId: 2 })
    expect(moveSelection(atEnd, 1)).toBe(2)
  })

  test("returns null when empty", () => {
    const state = buildState([], ctx({}))
    expect(moveSelection(state, 1)).toBeNull()
  })

  test("jumps to second when no current selection and direction is down (selection falls back to first)", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }))
    // effectiveSelection falls back to ids[0] which is id 1, index 0, then +1 => ids[1] = 2
    expect(moveSelection(state, 1)).toBe(2)
  })

  test("stays at first when no current selection and direction is up", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }))
    // effectiveSelection falls back to ids[0] which is id 1, index 0, then -1 => ids[0] = 1
    expect(moveSelection(state, -1)).toBe(1)
  })
})

describe("truncateLine", () => {
  test("passes through short lines", () => {
    const l = line(1, "short")
    expect(truncateLine(l, 10).text).toBe("short")
  })

  test("truncates with ellipsis", () => {
    const l = line(1, "a very long line for testing")
    const result = truncateLine(l, 10)
    expect(result.text).toHaveLength(10)
    expect(result.text).toMatch(/…$/)
  })

  test("passes through fold markers", () => {
    const marker = foldMarkerLine(10)
    expect(truncateLine(marker, 5)).toBe(marker)
  })
})

describe("isNarrow", () => {
  test("detects narrow widths", () => {
    expect(isNarrow(40)).toBe(true)
    expect(isNarrow(NARROW_WIDTH_DEFAULT - 1)).toBe(true)
  })

  test("standard widths are not narrow", () => {
    expect(isNarrow(NARROW_WIDTH_DEFAULT)).toBe(false)
    expect(isNarrow(120)).toBe(false)
  })
})

describe("terminalSummary", () => {
  test("empty state", () => {
    const state = buildState([], ctx({}))
    expect(terminalSummary(state)).toContain("no output yet")
  })

  test("streaming state reports line count", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: false }))
    expect(terminalSummary(state)).toContain("streaming")
    expect(terminalSummary(state)).toContain("2")
  })

  test("complete state", () => {
    const state = buildState([line(1, "a")], ctx({ complete: true }))
    expect(terminalSummary(state)).toContain("1 line")
  })

  test("complete with plural", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({ complete: true }))
    expect(terminalSummary(state)).toContain("2 lines")
  })

  test("complete with query match count", () => {
    const state = buildState([line(1, "hello"), line(2, "nope")], ctx({ complete: true }), { query: "hello" })
    expect(terminalSummary(state)).toContain("1 of 2")
  })

  test("failure state redacts message", () => {
    const state = buildState([line(1, "a")], ctx({ failure: "sk-abcdefghijklmnop secret error" }))
    const summary = terminalSummary(state)
    expect(summary).toContain("failed")
    expect(summary).not.toContain("sk-abcdefghijklmnop")
  })
})

describe("buildState", () => {
  test("builds default state from inputs", () => {
    const state = buildState([line(1, "a")], ctx({ complete: true }))
    expect(state.lines).toHaveLength(1)
    expect(state.status).toBe("complete")
    expect(state.query).toBe("")
    expect(state.folded).toBe(true)
    expect(state.selectedId).toBeNull()
  })

  test("applies overrides", () => {
    const state = buildState([], ctx({ complete: true }), { query: "err", folded: false })
    expect(state.query).toBe("err")
    expect(state.folded).toBe(false)
  })
})

describe("pane interaction: streaming and selection stability", () => {
  test("selection stays valid as output streams in", () => {
    let lines = [line(1, "first"), line(2, "second"), line(3, "third")]
    let state = buildState(lines, ctx({}), { selectedId: 2 })
    expect(effectiveSelection(state)).toBe(2)

    lines = [...lines, line(4, "fourth"), line(5, "fifth")]
    state = buildState(lines, ctx({}), { selectedId: 2 })
    expect(effectiveSelection(state)).toBe(2)
  })

  test("search-then-clear restores all lines", () => {
    const lines = [line(1, "error: crash"), line(2, "info: ok"), line(3, "error: oops")]
    const searching = buildState(lines, ctx({ complete: true }), { query: "error" })
    expect(visibleLines(searching).lines).toHaveLength(2)

    const cleared = buildState(lines, ctx({ complete: true }), { query: "" })
    expect(visibleLines(cleared).lines).toHaveLength(3)
  })

  test("fold-then-expand roundtrip preserves all lines", () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(i, `l${i}`))
    const folded = buildState(lines, ctx({ complete: true }), { folded: true })
    expect(visibleLines(folded).hidden).toBeGreaterThan(0)

    const expanded = buildState(lines, ctx({ complete: true }), { folded: false })
    expect(visibleLines(expanded).lines).toHaveLength(30)
  })
})

describe("pane failure paths", () => {
  test("failure status overrides complete", () => {
    const res = deriveStatus([line(1, "something")], ctx({ complete: true, failure: "process crashed" }))
    expect(res).toBe("failure")
  })

  test("failure with empty lines still shows as failure", () => {
    const res = deriveStatus([], ctx({ failure: "connection refused" }))
    expect(res).toBe("failure")
  })
})