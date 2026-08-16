import { describe, expect, test } from "bun:test"
import {
  CODE_BLOCK_LONG_THRESHOLD,
  CODE_BLOCK_TOKEN_LIMIT,
  RUNNABLE,
  buildCodeBlockState,
  codeBlockAriaLabel,
  codeBlockStatusGlyph,
  codeBlockStatusLabel,
  codeBlockSummary,
  deriveCodeBlockStatus,
  executionAvailable,
  formatGutter,
  gutterWidth,
  highlightFamily,
  isFilePreviewNarrow,
  lineInSelection,
  normalizeSelection,
} from "./state"

describe("buildCodeBlockState", () => {
  test("empty block reports the empty status", () => {
    const state = buildCodeBlockState({ code: "", language: null, wrap: false, selection: null })
    expect(state.status).toBe("empty")
    expect(state.lineCount).toBe(1)
    expect(state.tokens.length).toBe(1)
    expect(state.lineLimited).toBe(false)
    expect(state.hiddenLines).toBe(0)
  })

  test("a plain block is populated with correct line count", () => {
    const code = "line one\nline two\nline three"
    const state = buildCodeBlockState({ code, language: null, wrap: false, selection: null })
    expect(state.status).toBe("populated")
    expect(state.lineCount).toBe(3)
    expect(state.tokens.length).toBe(3)
    expect(state.family).toBe("c")
  })

  test("language drives the highlight family", () => {
    expect(buildCodeBlockState({ code: "x", language: "python", wrap: false, selection: null }).family).toBe("python")
    expect(buildCodeBlockState({ code: "x", language: "rust", wrap: false, selection: null }).family).toBe("rust")
    expect(buildCodeBlockState({ code: "x", language: "bash", wrap: false, selection: null }).family).toBe("shell")
    expect(buildCodeBlockState({ code: "x", language: "unknown-lang", wrap: false, selection: null }).family).toBe("c")
  })

  test("trailing newline keeps the implied final line", () => {
    const state = buildCodeBlockState({ code: "a\n", language: null, wrap: false, selection: null })
    // splitFileLines treats "a\n" as ["a", "", ""] — the trailing newline
    // expands to two empty entries (one for the newline, one implied).
    expect(state.lineCount).toBe(3)
  })

  test("tokens are produced per line for syntax highlighting", () => {
    const state = buildCodeBlockState({ code: "const x = 1", language: "ts", wrap: false, selection: null })
    const kinds = state.tokens[0]!.map((t) => t.kind)
    expect(kinds).toContain("keyword")
    expect(kinds).toContain("number")
  })

  test("selection is normalized and exposed on the state", () => {
    const state = buildCodeBlockState({
      code: "a\nb\nc\nd\ne",
      language: null,
      wrap: false,
      selection: { start: 4, end: 2 },
    })
    expect(state.selection).toEqual({ start: 2, end: 4 })
  })

  test("wrap flag is carried through", () => {
    expect(buildCodeBlockState({ code: "x", language: null, wrap: true, selection: null }).wrap).toBe(true)
    expect(buildCodeBlockState({ code: "x", language: null, wrap: false, selection: null }).wrap).toBe(false)
  })

  test("conceal redacts secret-shaped content before tokenizing", () => {
    const secret = "Bearer sk-live-abcdefghijklmnop leaked"
    const state = buildCodeBlockState({ code: secret, language: null, wrap: false, selection: null, conceal: true })
    expect(state.lines[0]).not.toContain("sk-live-")
    expect(state.lines[0]).toContain("••••")
  })
})

describe("deriveCodeBlockStatus — 8-state lifecycle", () => {
  const defaultCtx = { loading: false, connected: true, permitted: true, error: null, degraded: false }
  const populatedContent = "hello world"

  test("loading state wins over all others", () => {
    expect(deriveCodeBlockStatus(populatedContent, { ...defaultCtx, loading: true, permitted: false }, 0)).toBe("loading")
    expect(deriveCodeBlockStatus(populatedContent, { ...defaultCtx, loading: true, error: "err" }, 0)).toBe("loading")
  })

  test("offline state wins when disconnected", () => {
    expect(deriveCodeBlockStatus(populatedContent, { ...defaultCtx, connected: false }, 0)).toBe("offline")
  })

  test("denied state wins when not permitted", () => {
    expect(deriveCodeBlockStatus(populatedContent, { ...defaultCtx, permitted: false }, 0)).toBe("denied")
  })

  test("failure state surfaces errors", () => {
    expect(deriveCodeBlockStatus(populatedContent, { ...defaultCtx, error: "rendering failed" }, 0)).toBe("failure")
  })

  test("empty state when content is empty or blank", () => {
    expect(deriveCodeBlockStatus("", defaultCtx, 0)).toBe("empty")
    expect(deriveCodeBlockStatus("   ", defaultCtx, 0)).toBe("empty")
  })

  test("degraded state when reduced-fidelity mode", () => {
    expect(deriveCodeBlockStatus(populatedContent, { ...defaultCtx, degraded: true }, 0)).toBe("degraded")
  })

  test("long-content state when content exceeds line threshold", () => {
    const longContent = Array.from({ length: CODE_BLOCK_LONG_THRESHOLD + 1 }, () => "line").join("\n")
    expect(deriveCodeBlockStatus(longContent, defaultCtx, CODE_BLOCK_LONG_THRESHOLD + 1)).toBe("long-content")
  })

  test("populated when none of the blocking/presentation states apply", () => {
    expect(deriveCodeBlockStatus(populatedContent, defaultCtx, 1)).toBe("populated")
  })
})

describe("buildCodeBlockState — context overrides", () => {
  test("context.loading produces loading state", () => {
    const state = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { loading: true } })
    expect(state.status).toBe("loading")
    expect(state.context.loading).toBe(true)
  })

  test("context.connected false produces offline state", () => {
    const state = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { connected: false } })
    expect(state.status).toBe("offline")
  })

  test("context.permitted false produces denied state", () => {
    const state = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { permitted: false } })
    expect(state.status).toBe("denied")
  })

  test("context.error produces failure state", () => {
    const state = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { error: "loading failed" } })
    expect(state.status).toBe("failure")
    expect(state.context.error).toBe("loading failed")
  })

  test("context.degraded produces degraded state", () => {
    const state = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { degraded: true } })
    expect(state.status).toBe("degraded")
  })

  test("default context yields populated for non-empty content", () => {
    const state = buildCodeBlockState({ code: "const x = 1", language: "ts", wrap: false, selection: null })
    expect(state.status).toBe("populated")
    expect(state.context.loading).toBe(false)
    expect(state.context.connected).toBe(true)
    expect(state.context.permitted).toBe(true)
    expect(state.context.error).toBeNull()
    expect(state.context.degraded).toBe(false)
  })
})

describe("buildCodeBlockState — render budget", () => {
  test("lines below the token limit are fully tokenized", () => {
    const fewLines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n")
    const state = buildCodeBlockState({ code: fewLines, language: null, wrap: false, selection: null })
    expect(state.lineLimited).toBe(false)
    expect(state.hiddenLines).toBe(0)
    expect(state.tokens.length).toBe(10)
  })

  test("lines above the token limit are capped with a notification", () => {
    const manyLines = Array.from({ length: CODE_BLOCK_TOKEN_LIMIT + 50 }, (_, i) => `line ${i}`).join("\n")
    const state = buildCodeBlockState({ code: manyLines, language: null, wrap: false, selection: null })
    expect(state.lineLimited).toBe(true)
    expect(state.hiddenLines).toBeGreaterThan(0)
    expect(state.tokens.length).toBe(CODE_BLOCK_TOKEN_LIMIT)
    // The last line in the lines array should be the budget notification
    expect(state.lines[state.lines.length - 1]).toContain("hidden by render budget")
  })

  test("exact limit is not capped", () => {
    const exactLines = Array.from({ length: CODE_BLOCK_TOKEN_LIMIT }, (_, i) => `line ${i}`).join("\n")
    const state = buildCodeBlockState({ code: exactLines, language: null, wrap: false, selection: null })
    expect(state.lineLimited).toBe(false)
    expect(state.hiddenLines).toBe(0)
  })
})

describe("executionAvailable", () => {
  test("null/unknown languages are never runnable", () => {
    expect(executionAvailable(null)).toBe(false)
    expect(executionAvailable(undefined)).toBe(false)
    expect(executionAvailable("ts")).toBe(false)
    expect(executionAvailable("python")).toBe(false)
  })

  test("shell-family languages are runnable", () => {
    expect(executionAvailable("bash")).toBe(true)
    expect(executionAvailable("shell")).toBe(true)
    expect(executionAvailable("sh")).toBe(true)
    expect(executionAvailable("shellscript")).toBe(true)
    expect(executionAvailable("zsh")).toBe(true)
  })

  test("RUNNABLE matches the allowed families", () => {
    expect([...RUNNABLE].sort()).toEqual(["bash", "sh", "shell", "shellscript", "zsh"].sort())
  })
})

describe("highlightFamily reuse", () => {
  test("maps languages to highlighter families", () => {
    expect(highlightFamily("python")).toBe("python")
    expect(highlightFamily("rust")).toBe("rust")
    expect(highlightFamily("go")).toBe("go")
    expect(highlightFamily("shellscript")).toBe("shell")
    expect(highlightFamily("yaml")).toBe("yaml")
    expect(highlightFamily("json")).toBe("json")
    expect(highlightFamily("typescript")).toBe("c")
    expect(highlightFamily(undefined)).toBe("c")
  })
})

describe("gutter + selection helpers", () => {
  test("gutterWidth scales with line count", () => {
    expect(gutterWidth(1)).toBe(1)
    expect(gutterWidth(9)).toBe(1)
    expect(gutterWidth(10)).toBe(2)
    expect(gutterWidth(100)).toBe(3)
  })

  test("formatGutter right-aligns", () => {
    expect(formatGutter(3, 3)).toBe("  3")
    expect(formatGutter(12, 3)).toBe(" 12")
  })

  test("normalizeSelection rejects out-of-range", () => {
    expect(normalizeSelection(null)).toBeNull()
    expect(normalizeSelection({ start: 0, end: 2 })).toBeNull()
    expect(normalizeSelection({ start: 5, end: 2 })).toEqual({ start: 2, end: 5 })
  })

  test("lineInSelection reflects the normalized range", () => {
    const sel = { start: 2, end: 4 }
    expect(lineInSelection(sel, 1)).toBe(false)
    expect(lineInSelection(sel, 2)).toBe(true)
    expect(lineInSelection(sel, 4)).toBe(true)
    expect(lineInSelection(sel, 5)).toBe(false)
    expect(lineInSelection(null, 3)).toBe(false)
  })
})

describe("narrow terminal behavior", () => {
  test("gutter collapses below 60 columns", () => {
    expect(isFilePreviewNarrow(50)).toBe(true)
    expect(isFilePreviewNarrow(60)).toBe(false)
    expect(isFilePreviewNarrow(120)).toBe(false)
  })
})

describe("codeBlockStatusLabel", () => {
  test("returns a human-readable label for every status", () => {
    expect(codeBlockStatusLabel("loading")).toBe("Loading")
    expect(codeBlockStatusLabel("empty")).toBe("Empty")
    expect(codeBlockStatusLabel("populated")).toBe("Ready")
    expect(codeBlockStatusLabel("long-content")).toBe("Long content")
    expect(codeBlockStatusLabel("failure")).toBe("Error")
    expect(codeBlockStatusLabel("denied")).toBe("Permission denied")
    expect(codeBlockStatusLabel("offline")).toBe("Offline")
    expect(codeBlockStatusLabel("degraded")).toBe("Degraded")
  })
})

describe("codeBlockStatusGlyph", () => {
  test("returns colored glyphs when color is available", () => {
    expect(codeBlockStatusGlyph("loading", true)).toBe("◐")
    expect(codeBlockStatusGlyph("empty", true)).toBe("∅")
    expect(codeBlockStatusGlyph("populated", true)).toBe("●")
    expect(codeBlockStatusGlyph("long-content", true)).toBe("▤")
    expect(codeBlockStatusGlyph("failure", true)).toBe("✕")
    expect(codeBlockStatusGlyph("denied", true)).toBe("⊘")
    expect(codeBlockStatusGlyph("offline", true)).toBe("○")
    expect(codeBlockStatusGlyph("degraded", true)).toBe("△")
  })

  test("returns bracketed text fallback when color is off", () => {
    expect(codeBlockStatusGlyph("loading", false)).toBe("[loading]")
    expect(codeBlockStatusGlyph("empty", false)).toBe("[empty]")
    expect(codeBlockStatusGlyph("populated", false)).toBe("[ready]")
    expect(codeBlockStatusGlyph("long-content", false)).toBe("[long]")
    expect(codeBlockStatusGlyph("failure", false)).toBe("[error]")
    expect(codeBlockStatusGlyph("denied", false)).toBe("[denied]")
    expect(codeBlockStatusGlyph("offline", false)).toBe("[offline]")
    expect(codeBlockStatusGlyph("degraded", false)).toBe("[degraded]")
  })
})

describe("codeBlockSummary", () => {
  const baseState = buildCodeBlockState({ code: "hello\nworld", language: "ts", wrap: false, selection: null })

  test("describes loading state", () => {
    expect(codeBlockSummary({ ...baseState, status: "loading" })).toContain("loading")
    expect(codeBlockSummary({ ...baseState, status: "loading" })).toContain("ts")
  })

  test("describes offline state", () => {
    expect(codeBlockSummary({ ...baseState, status: "offline" })).toContain("offline")
  })

  test("describes denied state", () => {
    expect(codeBlockSummary({ ...baseState, status: "denied" })).toContain("denied")
  })

  test("describes failure state with redacted error", () => {
    const failing = { ...baseState, status: "failure" as const, context: { ...baseState.context, error: "Bearer sk-live-abcdefgh leaked" } }
    expect(codeBlockSummary(failing)).toContain("failed")
    expect(codeBlockSummary(failing)).not.toContain("sk-live")
  })

  test("describes empty state", () => {
    const empty = buildCodeBlockState({ code: "", language: null, wrap: false, selection: null })
    expect(codeBlockSummary(empty)).toContain("no content")
  })

  test("describes degraded state", () => {
    expect(codeBlockSummary({ ...baseState, status: "degraded" })).toContain("degraded")
  })

  test("describes long-content state", () => {
    expect(codeBlockSummary({ ...baseState, status: "long-content" })).toContain("lines")
  })

  test("describes populated state with line count", () => {
    expect(codeBlockSummary(baseState)).toContain("2 lines")
  })
})

describe("codeBlockAriaLabel", () => {
  test("produces redacted self-describing label", () => {
    const state = buildCodeBlockState({ code: "hello", language: "ts", wrap: false, selection: null })
    const label = codeBlockAriaLabel(state)
    expect(label).toContain("ts")
    expect(label).toContain("lines")
    expect(label).not.toContain("undefined")
  })
})