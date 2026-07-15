import { describe, expect, test } from "bun:test"
import {
  PREVIEW_HEAD_DEFAULT,
  PREVIEW_LONG_THRESHOLD,
  PREVIEW_MAX_LINES_DEFAULT,
  PREVIEW_TAIL_DEFAULT,
  NARROW_WIDTH_DEFAULT,
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
  redactMessage,
  stripAnsiLine,
  truncateLine,
  visibleIds,
  visibleLines,
  type FilePreviewContext,
  type FilePreviewLine,
} from "../../../src/component/file-preview/model"

function line(id: number, raw: string): FilePreviewLine {
  return buildPreviewLine(id, raw)
}

function ctx(overrides: Partial<FilePreviewContext> = {}): FilePreviewContext {
  return overrides
}

// ---------- Syntax classification (the "syntax-highlighted content" layer) ----------

describe("classifyLine", () => {
  test("maps severity from the ANSI-stripped text", () => {
    expect(classifyLine("everything is fine")).toBe("info")
    expect(classifyLine("Warning: deprecated API")).toBe("warn")
    expect(classifyLine("Error: command failed")).toBe("error")
    expect(classifyLine("attempt 2 of 3")).toBe("warn")
    expect(classifyLine("cannot read property of undefined")).toBe("error")
  })

  test("strips ANSI before classifying so color codes never drive severity", () => {
    expect(classifyLine("\x1b[32mok\x1b[0m")).toBe("info")
    expect(classifyLine("\x1b[31mFatal: panic\x1b[0m")).toBe("error")
  })
})

describe("stripAnsiLine + buildPreviewLine", () => {
  test("stripAnsiLine removes escape sequences", () => {
    expect(stripAnsiLine("\x1b[32mgreen\x1b[0m")).toBe("green")
    expect(stripAnsiLine("plain")).toBe("plain")
    expect(stripAnsiLine("")).toBe("")
  })

  test("buildPreviewLine keeps the line number id and classifies in one step", () => {
    const l = buildPreviewLine(3, "\x1b[31mError: boom\x1b[0m")
    expect(l.id).toBe(3)
    expect(l.text).toBe("Error: boom")
    expect(l.level).toBe("error")
  })

  test("buildPreviewLine preserves info lines without a level bump", () => {
    const l = buildPreviewLine(0, "const x = 1")
    expect(l.id).toBe(0)
    expect(l.text).toBe("const x = 1")
    expect(l.level).toBe("info")
  })
})

// ---------- State transitions (lifecycle) ----------

describe("deriveStatus", () => {
  test("blockers win in priority order: denied -> offline -> failure -> loading", () => {
    expect(deriveStatus([], ctx({ denied: true, offline: true, failure: "x", loading: true }))).toBe("denied")
    expect(deriveStatus([], ctx({ offline: true, failure: "x", loading: true }))).toBe("offline")
    expect(deriveStatus([], ctx({ failure: "x", loading: true }))).toBe("failure")
    expect(deriveStatus([], ctx({ loading: true }))).toBe("loading")
  })

  test("empty beats degraded/long once blockers are clear", () => {
    expect(deriveStatus([], ctx({ degraded: true }))).toBe("empty")
  })

  test("degraded shows when content exists but fidelity is reduced", () => {
    expect(deriveStatus([line(0, "a")], ctx({ degraded: true, degradedReason: "binary" }))).toBe("degraded")
  })

  test("content above the fold threshold is 'long' and folded by default", () => {
    const many = Array.from({ length: PREVIEW_LONG_THRESHOLD + 1 }, (_, i) => line(i, `line ${i}`))
    expect(deriveStatus(many, ctx())).toBe("long")
    const few = Array.from({ length: PREVIEW_LONG_THRESHOLD }, (_, i) => line(i, `line ${i}`))
    expect(deriveStatus(few, ctx())).toBe("populated")
  })

  test("the failure path is reachable from a populated file", () => {
    const populated = [line(0, "boot"), line(1, "ready")]
    expect(deriveStatus(populated, ctx())).toBe("populated")
    expect(deriveStatus(populated, ctx({ failure: "EACCES" }))).toBe("failure")
  })
})

// ---------- References (search / match counting) ----------

describe("matchCount + summary references", () => {
  const lines = [line(0, "info line"), line(1, "Error: boom"), line(2, "another error")]

  test("matchCount is case-insensitive on the display-safe text", () => {
    expect(matchCount(lines, "error")).toBe(2)
    expect(matchCount(lines, "ERROR")).toBe(2)
    expect(matchCount(lines, "")).toBe(0)
  })

  test("the summary reports how many of how many lines match the query", () => {
    const state = buildState(lines, ctx(), { query: "error" })
    expect(filePreviewSummary(state, "app.ts")).toContain("2 of 3 lines match")
    expect(filePreviewSummary(state, "app.ts")).toContain("error")
  })
})

// ---------- Selection (keyboard navigation model) ----------

describe("effectiveSelection", () => {
  const lines = [line(0, "a"), line(1, "b"), line(2, "c")]

  test("defaults to the first visible line", () => {
    expect(effectiveSelection(buildState(lines, ctx()))).toBe(0)
  })

  test("keeps a still-visible selected id", () => {
    expect(effectiveSelection(buildState(lines, ctx(), { selectedId: 1 }))).toBe(1)
  })

  test("falls back to the first visible row when the selection is gone", () => {
    const shrunk = buildState([line(0, "a"), line(1, "b")], ctx(), { selectedId: 2 })
    expect(effectiveSelection(shrunk)).toBe(0)
  })

  test("is null for an empty file (never trapped on a ghost)", () => {
    expect(effectiveSelection(buildState([], ctx()))).toBeNull()
  })
})

describe("moveSelection", () => {
  const lines = [line(0, "a"), line(1, "b"), line(2, "c")]

  test("clamps at both ends", () => {
    expect(moveSelection(buildState(lines, ctx(), { selectedId: 0 }), -1)).toBe(0)
    expect(moveSelection(buildState(lines, ctx(), { selectedId: 2 }), 1)).toBe(2)
  })

  test("walks down and up within visible bounds", () => {
    expect(moveSelection(buildState(lines, ctx(), { selectedId: 0 }), 1)).toBe(1)
    expect(moveSelection(buildState(lines, ctx(), { selectedId: 1 }), 1)).toBe(2)
    expect(moveSelection(buildState(lines, ctx(), { selectedId: 2 }), -1)).toBe(1)
  })

  test("returns null for an empty file", () => {
    expect(moveSelection(buildState([], ctx()), 1)).toBeNull()
  })
})

describe("visibleIds", () => {
  test("returns ids in display order and excludes fold markers", () => {
    const many = Array.from({ length: 30 }, (_, i) => line(i, `line ${i}`))
    const state = buildState(many, ctx())
    const ids = visibleIds(state)
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29])
    expect(ids).not.toContain(-1)
  })
})

// ---------- Large-file behavior (render budget) ----------

describe("capLines", () => {
  test("does not cap under the safety budget", () => {
    const few = Array.from({ length: 100 }, (_, i) => line(i, `l${i}`))
    expect(capLines(few).capped).toBe(false)
    expect(capLines(few).dropped).toBe(0)
  })

  test("caps oversized content to head + tail + marker and reports dropped count", () => {
    const huge = Array.from({ length: 6000 }, (_, i) => line(i, `l${i}`))
    const capped = capLines(huge)
    expect(capped.capped).toBe(true)
    expect(capped.dropped).toBe(1000)
    expect(capped.lines.length).toBe(PREVIEW_MAX_LINES_DEFAULT + 1)
    expect(capped.lines[0]!.id).toBe(0)
    expect(capped.lines.at(-1)!.id).toBe(5999)
    expect(capped.lines.some((l) => l.isFoldMarker)).toBe(true)
  })
})

describe("foldLines + visibleLines", () => {
  test("foldLines collapses the middle and reports hidden count", () => {
    const many = Array.from({ length: 25 }, (_, i) => line(i, `line ${i}`))
    const folded = foldLines(many, { folded: true })
    expect(folded.collapsible).toBe(true)
    expect(folded.hidden).toBe(25 - PREVIEW_HEAD_DEFAULT - PREVIEW_TAIL_DEFAULT)
    expect(folded.lines[0]!.text).toBe("line 0")
    expect(folded.lines.at(-1)!.text).toBe("line 24")
    expect(folded.lines.some((l) => l.isFoldMarker)).toBe(true)

    expect(foldLines(many, { folded: false }).hidden).toBe(0)
    const small = Array.from({ length: 5 }, (_, i) => line(i, `line ${i}`))
    expect(foldLines(small, { folded: true }).collapsible).toBe(false)
  })

  test("visibleLines narrows by search and folds otherwise", () => {
    const many = Array.from({ length: 20 }, (_, i) => line(i, `line ${i}`))
    const state = buildState(many, ctx())
    const folded = visibleLines(state, { headLines: 8, tailLines: 4 })
    expect(folded.hidden).toBeGreaterThan(0)
    expect(folded.lines.some((l) => l.isFoldMarker)).toBe(true)

    const searching = buildState(many, ctx(), { query: "line 1" })
    const matched = visibleLines(searching)
    expect(matched.hidden).toBe(0)
    expect(matched.matched).toBe(11)
    expect(matched.lines.every((l) => l.text.includes("line 1"))).toBe(true)
  })

  test("expanding a large file still enforces the hard safety cap", () => {
    const huge = Array.from({ length: 6000 }, (_, i) => line(i, `l${i}`))
    const state = buildState(huge, ctx(), { folded: false })
    const shown = visibleLines(state)
    expect(shown.capped).toBe(true)
    expect(shown.lines.length).toBeLessThanOrEqual(PREVIEW_MAX_LINES_DEFAULT + 1)
  })
})

// ---------- Resize fallbacks (narrow terminal) ----------

describe("isNarrow + truncateLine", () => {
  test("isNarrow respects the width threshold", () => {
    expect(isNarrow(NARROW_WIDTH_DEFAULT - 1)).toBe(true)
    expect(isNarrow(NARROW_WIDTH_DEFAULT)).toBe(false)
    expect(isNarrow(120)).toBe(false)
  })

  test("truncateLine adds an ellipsis and honors the width budget", () => {
    const long = line(0, "x".repeat(200))
    const trimmed = truncateLine(long, 10)
    expect(trimmed.text.endsWith("…")).toBe(true)
    expect(trimmed.text.length).toBe(10)
  })

  test("truncateLine never truncates the fold marker", () => {
    const marker = foldMarkerLine(99)
    expect(truncateLine(marker, 5)).toBe(marker)
  })

  test("truncateLine leaves short lines and empty terminal widths untouched safely", () => {
    expect(truncateLine(line(0, "short"), 10).text).toBe("short")
    expect(truncateLine(line(0, "ab"), 1).text).toBe("a")
  })
})

// ---------- Redaction (failure-path safety) ----------

describe("redactMessage", () => {
  test("masks bearer tokens and key=value secrets", () => {
    expect(redactMessage("Bearer abcdefghijklmnopqrstuvwxyz").text).toContain("••••")
    expect(redactMessage("api_key = supersecretvalue123").text).toContain("••••")
    expect(redactMessage("just a path")).toBe("just a path")
  })
})

// ---------- Semantic summaries ----------

describe("filePreviewSummary", () => {
  test("describes every lifecycle state with a human-readable label", () => {
    expect(filePreviewSummary(buildState([], ctx({ loading: true })), "a.ts")).toContain("loading")
    expect(filePreviewSummary(buildState([], ctx()), "a.ts")).toContain("empty")
    expect(filePreviewSummary(buildState([line(0, "x")], ctx()), "a.ts")).toContain("1 line")
    const long = Array.from({ length: PREVIEW_LONG_THRESHOLD + 1 }, (_, i) => line(i, `l${i}`))
    expect(filePreviewSummary(buildState(long, ctx()), "a.ts")).toContain("large file")
    expect(filePreviewSummary(buildState([line(0, "x")], ctx({ degraded: true, degradedReason: "binary" })), "a.ts")).toContain("limited preview")
    expect(filePreviewSummary(buildState([line(0, "x")], ctx({ denied: true })), "a.ts")).toContain("access denied")
    expect(filePreviewSummary(buildState([line(0, "x")], ctx({ offline: true })), "a.ts")).toContain("offline")
  })

  test("redacts the failure reason before surfacing it in the summary", () => {
    const failing = filePreviewSummary(
      buildState([line(0, "x")], ctx({ failure: "Bearer sk-live-abcdefghijklmnop" })),
      "a.ts",
    )
    expect(failing).toContain("failed to read")
    expect(failing).not.toContain("sk-live")
  })
})

// ---------- buildState defaults / overrides ----------

describe("buildState", () => {
  test("records the raw line count and defaults to folded + no selection", () => {
    const lines = [line(0, "a"), line(1, "b")]
    const state = buildState(lines, ctx())
    expect(state.totalRaw).toBe(2)
    expect(state.lines).toHaveLength(2)
    expect(state.folded).toBe(true)
    expect(state.selectedId).toBeNull()
    expect(state.query).toBe("")
  })

  test("applies overrides on top of defaults", () => {
    const state = buildState([line(0, "a")], ctx(), { folded: false, selectedId: 0, query: "a" })
    expect(state.folded).toBe(false)
    expect(state.selectedId).toBe(0)
    expect(state.query).toBe("a")
  })
})
