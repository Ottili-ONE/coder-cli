import { describe, expect, test } from "bun:test"
import {
  RUNNABLE,
  buildCodeBlockState,
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
    expect(state.lineCount).toBe(2)
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
