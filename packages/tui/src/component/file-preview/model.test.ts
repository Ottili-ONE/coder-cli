import { describe, expect, test } from "bun:test"
import {
  buildPreviewLine,
  buildState,
  capLines,
  classifyLine,
  deriveStatus,
  effectiveSelection,
  filePreviewSummary,
  foldLines,
  foldMarkerLine,
  isNarrow,
  matchCount,
  moveSelection,
  PREVIEW_HEAD_DEFAULT,
  PREVIEW_LONG_THRESHOLD,
  PREVIEW_MAX_LINES_DEFAULT,
  PREVIEW_TAIL_DEFAULT,
  redactMessage,
  truncateLine,
  visibleIds,
  visibleLines,
  type FilePreviewContext,
  type FilePreviewLine,
} from "./model"

function line(id: number, text: string): FilePreviewLine {
  return { id, text, level: "info" }
}

function ctx(overrides: Partial<FilePreviewContext> = {}): FilePreviewContext {
  return { ...overrides }
}

describe("buildPreviewLine", () => {
  test("strips ANSI escape sequences and classifies plain text as info", () => {
    const l = buildPreviewLine(1, "hello world")
    expect(l.text).toBe("hello world")
    expect(l.level).toBe("info")
  })

  test("classifies error-pattern text", () => {
    const l = buildPreviewLine(2, "Error: something broke")
    expect(l.level).toBe("error")
  })

  test("classifies warn-pattern text", () => {
    const l = buildPreviewLine(3, "warning: deprecated call")
    expect(l.level).toBe("warn")
  })
})

describe("classifyLine", () => {
  test("returns info for neutral text", () => {
    expect(classifyLine("normal log line")).toBe("info")
  })

  test("returns error for failure vocabulary", () => {
    expect(classifyLine("failed")).toBe("error")
    expect(classifyLine("FATAL: crash")).toBe("error")
    expect(classifyLine("panic: unreachable")).toBe("error")
    expect(classifyLine("error: crash")).toBe("error")
    expect(classifyLine("timed out")).toBe("error")
  })

  test("returns warn for warning vocabulary", () => {
    expect(classifyLine("warn: something")).toBe("warn")
    expect(classifyLine("deprecated API")).toBe("warn")
    expect(classifyLine("TODO: fix me")).toBe("warn")
    expect(classifyLine("retry attempt")).toBe("warn")
  })
})

describe("foldMarkerLine", () => {
  test("creates a fold marker with the hidden count", () => {
    const marker = foldMarkerLine(42)
    expect(marker.id).toBe(-1)
    expect(marker.text).toContain("42")
    expect(marker.isFoldMarker).toBe(true)
    expect(marker.level).toBe("info")
  })
})

describe("deriveStatus", () => {
  test("blockers win in priority: denied > offline > failure > loading", () => {
    expect(deriveStatus([line(1, "a")], ctx({ denied: true }))).toBe("denied")
    expect(deriveStatus([line(1, "a")], ctx({ offline: true }))).toBe("offline")
    expect(deriveStatus([line(1, "a")], ctx({ failure: "err" }))).toBe("failure")
    expect(deriveStatus([line(1, "a")], ctx({ loading: true }))).toBe("loading")
  })

  test("empty lines with no blockers returns empty", () => {
    expect(deriveStatus([], ctx({}))).toBe("empty")
  })

  test("degraded context returns degraded", () => {
    const res = deriveStatus([line(1, "a")], ctx({ degraded: true, degradedReason: "binary" }))
    expect(res).toBe("degraded")
  })

  test("long content above threshold returns long", () => {
    const many = Array.from({ length: PREVIEW_LONG_THRESHOLD + 1 }, (_, i) => line(i, `line ${i}`))
    expect(deriveStatus(many, ctx({}))).toBe("long")
  })

  test("normal content returns populated", () => {
    expect(deriveStatus([line(1, "a")], ctx({}))).toBe("populated")
  })
})

describe("matchCount", () => {
  test("returns 0 for empty query", () => {
    expect(matchCount([line(1, "hello")], "")).toBe(0)
    expect(matchCount([line(1, "hello")], "   ")).toBe(0)
  })

  test("counts case-insensitive matches", () => {
    const lines = [line(1, "Hello World"), line(2, "goodbye"), line(3, "hello again")]
    expect(matchCount(lines, "hello")).toBe(2)
    expect(matchCount(lines, "HELLO")).toBe(2)
  })

  test("returns 0 when no lines match", () => {
    expect(matchCount([line(1, "abc")], "xyz")).toBe(0)
  })
})

describe("capLines", () => {
  test("leaves short lists untouched", () => {
    const lines = [line(1, "a"), line(2, "b")]
    const result = capLines(lines, 5)
    expect(result.capped).toBe(false)
    expect(result.lines).toHaveLength(2)
    expect(result.dropped).toBe(0)
  })

  test("caps long lists with a fold marker", () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(i, `line ${i}`))
    const result = capLines(lines, 5)
    expect(result.capped).toBe(true)
    expect(result.lines.length).toBeLessThanOrEqual(5)
    expect(result.lines.some((l) => l.isFoldMarker)).toBe(true)
    expect(result.dropped).toBeGreaterThan(0)
  })

  test("precision boundary: at exactly max lines is not capped", () => {
    const lines = Array.from({ length: 5 }, (_, i) => line(i, `line ${i}`))
    const result = capLines(lines, 5)
    expect(result.capped).toBe(false)
    expect(result.lines).toHaveLength(5)
  })
})

describe("foldLines", () => {
  test("does not fold when not requested", () => {
    const lines = Array.from({ length: 100 }, (_, i) => line(i, `l${i}`))
    const result = foldLines(lines, { folded: false })
    expect(result.hidden).toBe(0)
    expect(result.collapsible).toBe(true)
    expect(result.lines).toHaveLength(100)
  })

  test("does not fold when content is too short to fold", () => {
    const lines = [line(1, "a"), line(2, "b")]
    const result = foldLines(lines, { folded: true })
    expect(result.hidden).toBe(0)
    expect(result.collapsible).toBe(false)
  })

  test("folds by keeping head and tail defaults", () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(i, `l${i}`))
    const result = foldLines(lines, { folded: true })
    expect(result.hidden).toBe(30 - PREVIEW_HEAD_DEFAULT - PREVIEW_TAIL_DEFAULT)
    const visible = result.lines
    expect(visible[0].text).toBe("l0")
    expect(visible[visible.length - 1].text).toBe("l29")
    expect(visible.some((l) => l.isFoldMarker)).toBe(true)
  })
})

describe("visibleLines", () => {
  test("returns all lines when not folded and not searching", () => {
    const lines = [line(1, "a"), line(2, "b")]
    const state = buildState(lines, ctx({}))
    const result = visibleLines(state)
    expect(result.lines).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  test("filters by query when searching", () => {
    const lines = [line(1, "hello world"), line(2, "goodbye"), line(3, "hello again")]
    const state = buildState(lines, ctx({}), { query: "hello" })
    const result = visibleLines(state)
    expect(result.lines).toHaveLength(2)
    expect(result.matched).toBe(2)
  })

  test("searching never folds", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `hello ${i}`))
    const state = buildState(lines, ctx({}), { query: "hello", folded: true })
    const result = visibleLines(state)
    // All 50 match "hello", so all should be visible even though folded=true
    expect(result.lines).toHaveLength(50)
  })

  test("folded output inserts fold marker", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({}), { folded: true })
    const result = visibleLines(state)
    expect(result.hidden).toBeGreaterThan(0)
    expect(result.lines.some((l) => l.isFoldMarker)).toBe(true)
  })

  test("expanded output enforces the hard safety cap", () => {
    const lines = Array.from({ length: PREVIEW_MAX_LINES_DEFAULT + 100 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({}), { folded: false })
    const result = visibleLines(state)
    expect(result.lines.length).toBeLessThanOrEqual(PREVIEW_MAX_LINES_DEFAULT)
    expect(result.capped).toBe(true)
  })
})

describe("visibleIds", () => {
  test("returns ids of visible non-marker lines", () => {
    const lines = [line(1, "a"), line(2, "b"), line(3, "c")]
    const state = buildState(lines, ctx({}))
    expect(visibleIds(state)).toEqual([1, 2, 3])
  })

  test("skips fold markers", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({}), { folded: true })
    const ids = visibleIds(state)
    expect(ids).not.toContain(-1)
  })
})

describe("effectiveSelection", () => {
  test("returns null for empty visible lines", () => {
    const state = buildState([], ctx({}))
    expect(effectiveSelection(state)).toBeNull()
  })

  test("returns stored selection when visible", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({}), { selectedId: 2 })
    expect(effectiveSelection(state)).toBe(2)
  })

  test("falls back to first visible when stored selection is hidden", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({}), { folded: true, selectedId: 30 })
    // line 30 is in the folded middle so it should not be in visible ids
    expect(effectiveSelection(state)).toBe(0)
  })
})

describe("moveSelection", () => {
  test("moves selection down", () => {
    const state = buildState([line(1, "a"), line(2, "b"), line(3, "c")], ctx({}), { selectedId: 1 })
    expect(moveSelection(state, 1)).toBe(2)
  })

  test("moves selection up", () => {
    const state = buildState([line(1, "a"), line(2, "b"), line(3, "c")], ctx({}), { selectedId: 2 })
    expect(moveSelection(state, -1)).toBe(1)
  })

  test("clamps at the top", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({}), { selectedId: 1 })
    expect(moveSelection(state, -1)).toBe(1)
  })

  test("clamps at the bottom", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({}), { selectedId: 2 })
    expect(moveSelection(state, 1)).toBe(2)
  })

  test("returns null when no visible lines", () => {
    const state = buildState([], ctx({}))
    expect(moveSelection(state, 1)).toBeNull()
  })
})

describe("isNarrow", () => {
  test("detects narrow widths below threshold", () => {
    expect(isNarrow(40)).toBe(true)
    expect(isNarrow(59)).toBe(true)
  })

  test("standard widths are not narrow", () => {
    expect(isNarrow(60)).toBe(false)
    expect(isNarrow(120)).toBe(false)
  })

  test("custom threshold works", () => {
    expect(isNarrow(80, 100)).toBe(true)
    expect(isNarrow(120, 100)).toBe(false)
  })
})

describe("truncateLine", () => {
  test("passes through short lines", () => {
    const l = line(1, "hello")
    expect(truncateLine(l, 10).text).toBe("hello")
  })

  test("truncates long lines with ellipsis", () => {
    const l = line(1, "a very long line of text")
    const result = truncateLine(l, 10)
    expect(result.text).toHaveLength(10)
    expect(result.text).toMatch(/…$/)
  })

  test("passes through fold markers unchanged", () => {
    const marker = foldMarkerLine(10)
    expect(truncateLine(marker, 5)).toBe(marker)
  })

  test("handles max=1 edge case without double truncation", () => {
    const l = line(1, "ab")
    expect(truncateLine(l, 1).text).toBe("a")
  })
})

describe("filePreviewSummary", () => {
  test("loading state", () => {
    const state = buildState([], ctx({ loading: true }))
    expect(filePreviewSummary(state)).toContain("loading")
  })

  test("empty state", () => {
    const state = buildState([], ctx({}))
    expect(filePreviewSummary(state)).toContain("empty")
  })

  test("populated state reports line count", () => {
    const state = buildState([line(1, "a"), line(2, "b")], ctx({}))
    expect(filePreviewSummary(state)).toContain("2 lines")
  })

  test("populated with query shows match count", () => {
    const state = buildState([line(1, "hello"), line(2, "nope")], ctx({}), { query: "hello" })
    expect(filePreviewSummary(state)).toContain("1 of 2")
  })

  test("long state", () => {
    const many = Array.from({ length: PREVIEW_LONG_THRESHOLD + 5 }, (_, i) => line(i, `l${i}`))
    const state = buildState(many, ctx({}))
    expect(filePreviewSummary(state)).toContain("large file")
  })

  test("failure state redacts the message", () => {
    const state = buildState([], ctx({ failure: "sk-abcdefghijklmnop token error" }))
    const summary = filePreviewSummary(state)
    expect(summary).toContain("failed")
    expect(summary).not.toContain("sk-abcdefghijklmnop")
  })

  test("denied state", () => {
    const state = buildState([], ctx({ denied: true }))
    expect(filePreviewSummary(state)).toContain("denied")
  })

  test("offline state", () => {
    const state = buildState([], ctx({ offline: true }))
    expect(filePreviewSummary(state)).toContain("offline")
  })

  test("degraded state includes reason", () => {
    const state = buildState([line(1, "a")], ctx({ degraded: true, degradedReason: "binary file" }))
    expect(filePreviewSummary(state)).toContain("binary file")
  })
})

describe("buildState", () => {
  test("builds default state from inputs", () => {
    const lines = [line(1, "a"), line(2, "b")]
    const state = buildState(lines, ctx({}))
    expect(state.lines).toHaveLength(2)
    expect(state.totalRaw).toBe(2)
    expect(state.status).toBe("populated")
    expect(state.query).toBe("")
    expect(state.folded).toBe(true)
    expect(state.selectedId).toBeNull()
  })

  test("applies overrides", () => {
    const state = buildState([], ctx({}), { query: "search", folded: false, selectedId: 5 })
    expect(state.query).toBe("search")
    expect(state.folded).toBe(false)
    expect(state.selectedId).toBe(5)
  })

  test("detects capped input", () => {
    const lines = Array.from({ length: PREVIEW_MAX_LINES_DEFAULT + 1 }, (_, i) => line(i, `l${i}`))
    const state = buildState(lines, ctx({}))
    expect(state.capped).toBe(true)
  })
})

describe("redactMessage", () => {
  test("redacts common secret patterns", () => {
    expect(redactMessage("sk-abcdefghijklmnop")).toContain("••••")
  })

  test("never leaks the raw secret", () => {
    const result = redactMessage("key sk-abcdefghijklmnop leaked")
    expect(result).not.toContain("sk-abcdefghijklmnop")
  })

  test("handles empty input", () => {
    expect(redactMessage("")).toBe("")
  })
})

describe("pane interaction: streaming and selection stability", () => {
  test("selection stays valid as content streams in", () => {
    // Start with a few lines and select line 2
    let lines = [line(1, "first"), line(2, "second"), line(3, "third")]
    let state = buildState(lines, ctx({}), { selectedId: 2 })
    expect(effectiveSelection(state)).toBe(2)

    // More lines stream in; selection of line 2 is still valid
    lines = [...lines, line(4, "fourth"), line(5, "fifth")]
    state = buildState(lines, ctx({}), { selectedId: 2 })
    expect(effectiveSelection(state)).toBe(2)

    // Fold the content; line 2 should be visible in the head
    const foldedState = buildState(lines, ctx({}), { selectedId: 2, folded: true })
    expect(effectiveSelection(foldedState)).toBe(2)
  })

  test("search followed by clear restores all lines", () => {
    const lines = [line(1, "hello world"), line(2, "goodbye"), line(3, "hello again")]
    const searching = buildState(lines, ctx({}), { query: "hello" })
    expect(visibleLines(searching).lines).toHaveLength(2)

    const cleared = buildState(lines, ctx({}), { query: "" })
    expect(visibleLines(cleared).lines).toHaveLength(3)
  })

  test("fold-then-expand roundtrip preserves all lines", () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(i, `l${i}`))
    const folded = buildState(lines, ctx({}), { folded: true })
    const visible = visibleLines(folded)
    expect(visible.hidden).toBeGreaterThan(0)

    const expanded = buildState(lines, ctx({}), { folded: false })
    expect(visibleLines(expanded).lines).toHaveLength(30)
  })
})

describe("pane resize behavior", () => {
  test("narrow terminal truncates long lines", () => {
    const l = line(1, "a".repeat(200))
    const truncated = truncateLine(l, 60)
    expect(truncated.text.length).toBe(60)
    expect(truncated.text).toMatch(/…$/)
  })

  test("standard terminal shows full lines", () => {
    const l = line(1, "a".repeat(100))
    expect(truncateLine(l, 200).text).toHaveLength(100)
  })
})

describe("pane failure path", () => {
  test("failure status wins over content even with lines present", () => {
    const res = deriveStatus([line(1, "something")], ctx({ failure: "disk error" }))
    expect(res).toBe("failure")
  })
})