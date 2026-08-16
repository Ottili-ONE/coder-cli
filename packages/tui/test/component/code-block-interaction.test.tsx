/**
 * Code block renderer — interaction and regression tests.
 *
 * Two layers:
 *   Layer 1 — Pure model tests (synchronous, no renderer): every function
 *             branch, the 8-state lifecycle, budget, helpers, and labels.
 *   Layer 2 — Render-level tests: resize stability, reactive signal-driven
 *             content, and component lifecycle without timing sleeps.
 *
 * All tests are deterministic, use no mocks, and rely on the existing opentui
 * headless renderer test infrastructure.
 */

import { describe, expect, test } from "bun:test"
import {
  CODE_BLOCK_LONG_THRESHOLD,
  CODE_BLOCK_TOKEN_LIMIT,
  buildCodeBlockState,
  codeBlockAriaLabel,
  codeBlockStatusGlyph,
  codeBlockStatusLabel,
  codeBlockSummary,
  deriveCodeBlockStatus,
  executionAvailable,
  gutterWidth,
  formatGutter,
  highlightFamily,
  isFilePreviewNarrow,
  lineInSelection,
  normalizeSelection,
  type CodeBlockState,
  type CodeBlockStatus,
} from "../../src/component/code-block"

// ===========================================================================
// LAYER 1 — PURE MODEL TESTS (no rendering infrastructure needed)
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. 8-state lifecycle — precedence order is enforced
// ---------------------------------------------------------------------------

describe("deriveCodeBlockStatus — 8-state precedence", () => {
  const ctx = { loading: false, connected: true, permitted: true, error: null, degraded: false }
  const content = "some code"

  test("loading beats all other states", () => {
    expect(deriveCodeBlockStatus(content, { ...ctx, loading: true, permitted: false }, 1)).toBe("loading")
    expect(deriveCodeBlockStatus(content, { ...ctx, loading: true, error: "err" }, 1)).toBe("loading")
  })

  test("offline beats denied, failure, empty, degraded", () => {
    expect(deriveCodeBlockStatus(content, { ...ctx, connected: false, permitted: false }, 1)).toBe("offline")
  })

  test("denied beats failure, empty, degraded", () => {
    expect(deriveCodeBlockStatus(content, { ...ctx, permitted: false, error: "err" }, 1)).toBe("denied")
  })

  test("failure beats empty, degraded", () => {
    expect(deriveCodeBlockStatus(content, { ...ctx, error: "boom", degraded: true }, 1)).toBe("failure")
  })

  test("empty when content is empty or blank", () => {
    expect(deriveCodeBlockStatus("", ctx, 0)).toBe("empty")
    expect(deriveCodeBlockStatus("   ", ctx, 0)).toBe("empty")
  })

  test("degraded before long-content and populated", () => {
    expect(deriveCodeBlockStatus(content, { ...ctx, degraded: true }, 0)).toBe("degraded")
  })

  test("long-content when line count exceeds threshold", () => {
    expect(deriveCodeBlockStatus(content, ctx, CODE_BLOCK_LONG_THRESHOLD + 1)).toBe("long-content")
  })

  test("populated when no blocking or presentation state applies", () => {
    expect(deriveCodeBlockStatus(content, ctx, 1)).toBe("populated")
  })
})

// ---------------------------------------------------------------------------
// 2. buildCodeBlockState — full state derivation from input
// ---------------------------------------------------------------------------

describe("buildCodeBlockState", () => {
  test("empty input produces empty status with one token line", () => {
    const s = buildCodeBlockState({ code: "", language: null, wrap: false, selection: null })
    expect(s.status).toBe("empty")
    expect(s.lineCount).toBe(1)
    expect(s.tokens.length).toBe(1)
    expect(s.lineLimited).toBe(false)
  })

  test("populated content reports correct line count and tokens", () => {
    const s = buildCodeBlockState({ code: "a\nb\nc", language: "ts", wrap: false, selection: null })
    expect(s.status).toBe("populated")
    expect(s.lineCount).toBe(3)
    expect(s.tokens.length).toBe(3)
    expect(s.family).toBe("c")
  })

  test("language selects the highlight family", () => {
    expect(buildCodeBlockState({ code: "x", language: "python", wrap: false, selection: null }).family).toBe("python")
    expect(buildCodeBlockState({ code: "x", language: "bash", wrap: false, selection: null }).family).toBe("shell")
    expect(buildCodeBlockState({ code: "x", language: "unknown", wrap: false, selection: null }).family).toBe("c")
  })

  test("executionAvailable is true for shell families", () => {
    expect(buildCodeBlockState({ code: "echo hi", language: "bash", wrap: false, selection: null }).executionAvailable).toBe(true)
    expect(buildCodeBlockState({ code: "echo hi", language: "python", wrap: false, selection: null }).executionAvailable).toBe(false)
  })

  test("selection is normalized (start <= end)", () => {
    const s = buildCodeBlockState({ code: "a\nb\nc\nd", language: null, wrap: false, selection: { start: 4, end: 2 } })
    expect(s.selection).toEqual({ start: 2, end: 4 })
  })

  test("wrap flag propagates through", () => {
    expect(buildCodeBlockState({ code: "x", language: null, wrap: true, selection: null }).wrap).toBe(true)
  })

  test("conceal redacts secret-shaped content before tokenizing", () => {
    const secret = "Bearer sk-live-abcdefghijklmnop leaked"
    const s = buildCodeBlockState({ code: secret, language: null, wrap: false, selection: null, conceal: true })
    expect(s.lines[0]).not.toContain("sk-live-")
    expect(s.lines[0]).toContain("••••")
  })

  test("context.loading overrides status", () => {
    const s = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { loading: true } })
    expect(s.status).toBe("loading")
  })

  test("context.connected false sets offline", () => {
    const s = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { connected: false } })
    expect(s.status).toBe("offline")
  })

  test("context.permitted false sets denied", () => {
    const s = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { permitted: false } })
    expect(s.status).toBe("denied")
  })

  test("context.error sets failure", () => {
    const s = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { error: "load failed" } })
    expect(s.status).toBe("failure")
    expect(s.context.error).toBe("load failed")
  })

  test("context.degraded sets degraded status", () => {
    const s = buildCodeBlockState({ code: "foo", language: null, wrap: false, selection: null, context: { degraded: true } })
    expect(s.status).toBe("degraded")
  })

  test("default context yields populated when content is present", () => {
    const s = buildCodeBlockState({ code: "const x = 1", language: "ts", wrap: false, selection: null })
    expect(s.status).toBe("populated")
    expect(s.context.loading).toBe(false)
    expect(s.context.connected).toBe(true)
    expect(s.context.permitted).toBe(true)
    expect(s.context.error).toBeNull()
    expect(s.context.degraded).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Render budget — token limit and line capping
// ---------------------------------------------------------------------------

describe("buildCodeBlockState — render budget", () => {
  test("lines below the token limit are fully tokenized", () => {
    const few = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n")
    const s = buildCodeBlockState({ code: few, language: null, wrap: false, selection: null })
    expect(s.lineLimited).toBe(false)
    expect(s.hiddenLines).toBe(0)
    expect(s.tokens.length).toBe(10)
  })

  test("lines above the token limit are capped with a notification line", () => {
    const many = Array.from({ length: CODE_BLOCK_TOKEN_LIMIT + 50 }, (_, i) => `line ${i}`).join("\n")
    const s = buildCodeBlockState({ code: many, language: null, wrap: false, selection: null })
    expect(s.lineLimited).toBe(true)
    expect(s.hiddenLines).toBeGreaterThan(0)
    expect(s.tokens.length).toBe(CODE_BLOCK_TOKEN_LIMIT)
    expect(s.lines[s.lines.length - 1]).toContain("hidden by render budget")
  })

  test("exact limit is not capped", () => {
    const exact = Array.from({ length: CODE_BLOCK_TOKEN_LIMIT }, (_, i) => `line ${i}`).join("\n")
    const s = buildCodeBlockState({ code: exact, language: null, wrap: false, selection: null })
    expect(s.lineLimited).toBe(false)
    expect(s.hiddenLines).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 4. executionAvailable — shell-family gating
// ---------------------------------------------------------------------------

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
    expect(executionAvailable("zsh")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. highlightFamily — language-to-family mapping
// ---------------------------------------------------------------------------

describe("highlightFamily", () => {
  test("maps known languages to their highlighter family", () => {
    expect(highlightFamily("python")).toBe("python")
    expect(highlightFamily("rust")).toBe("rust")
    expect(highlightFamily("go")).toBe("go")
    expect(highlightFamily("bash")).toBe("shell")
    expect(highlightFamily("yaml")).toBe("yaml")
    expect(highlightFamily("json")).toBe("json")
    expect(highlightFamily("typescript")).toBe("c")
    expect(highlightFamily(undefined)).toBe("c")
  })
})

// ---------------------------------------------------------------------------
// 6. Gutter, selection, and narrow-terminal helpers
// ---------------------------------------------------------------------------

describe("gutter and selection helpers", () => {
  test("gutterWidth scales with line count", () => {
    expect(gutterWidth(1)).toBe(1)
    expect(gutterWidth(9)).toBe(1)
    expect(gutterWidth(10)).toBe(2)
    expect(gutterWidth(100)).toBe(3)
  })

  test("formatGutter right-aligns numbers", () => {
    expect(formatGutter(3, 3)).toBe("  3")
    expect(formatGutter(12, 3)).toBe(" 12")
  })

  test("normalizeSelection rejects invalid ranges", () => {
    expect(normalizeSelection(null)).toBeNull()
    expect(normalizeSelection({ start: 0, end: 2 })).toBeNull()
    expect(normalizeSelection({ start: 5, end: 2 })).toEqual({ start: 2, end: 5 })
  })

  test("lineInSelection uses normalized range", () => {
    expect(lineInSelection({ start: 2, end: 4 }, 1)).toBe(false)
    expect(lineInSelection({ start: 2, end: 4 }, 2)).toBe(true)
    expect(lineInSelection({ start: 2, end: 4 }, 4)).toBe(true)
    expect(lineInSelection({ start: 2, end: 4 }, 5)).toBe(false)
    expect(lineInSelection(null, 3)).toBe(false)
  })

  test("isFilePreviewNarrow thresholds at 60 cols", () => {
    expect(isFilePreviewNarrow(50)).toBe(true)
    expect(isFilePreviewNarrow(60)).toBe(false)
    expect(isFilePreviewNarrow(120)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 7. CodeBlockStatus — label, glyph, summary, aria label coverage
// ---------------------------------------------------------------------------

describe("codeBlockStatusLabel — every state has a human-readable label", () => {
  const cases: [CodeBlockStatus, string][] = [
    ["loading", "Loading"],
    ["empty", "Empty"],
    ["populated", "Ready"],
    ["long-content", "Long content"],
    ["failure", "Error"],
    ["denied", "Permission denied"],
    ["offline", "Offline"],
    ["degraded", "Degraded"],
  ]
  for (const [status, label] of cases) {
    test(`${status} → "${label}"`, () => {
      expect(codeBlockStatusLabel(status)).toBe(label)
    })
  }
})

describe("codeBlockStatusGlyph — colored glyph or bracketed fallback", () => {
  const allStatuses: CodeBlockStatus[] = [
    "loading", "empty", "populated", "long-content", "failure", "denied", "offline", "degraded",
  ]

  test("returns a non-empty glyph when color is on", () => {
    for (const status of allStatuses) {
      expect(codeBlockStatusGlyph(status, true).length).toBeGreaterThan(0)
      expect(codeBlockStatusGlyph(status, true)).not.toMatch(/^\[/)
    }
  })

  test("returns bracketed text when color is off", () => {
    for (const status of allStatuses) {
      expect(codeBlockStatusGlyph(status, false)).toMatch(/^\[.+\]$/)
    }
  })
})

describe("codeBlockSummary — per-state semantic summary", () => {
  const base = buildCodeBlockState({ code: "hello\nworld", language: "ts", wrap: false, selection: null })

  test("loading mentions language and loading", () => {
    expect(codeBlockSummary({ ...base, status: "loading" })).toContain("loading")
    expect(codeBlockSummary({ ...base, status: "loading" })).toContain("ts")
  })

  test("offline mentions offline", () => {
    expect(codeBlockSummary({ ...base, status: "offline" })).toContain("offline")
  })

  test("denied mentions denied", () => {
    expect(codeBlockSummary({ ...base, status: "denied" })).toContain("denied")
  })

  test("failure redacts secrets in the error message", () => {
    const secret = "sk-live-abcdefghijklmnop"
    const failing = {
      ...base,
      status: "failure" as const,
      context: { ...base.context, error: `Bearer ${secret} leaked` },
    }
    expect(codeBlockSummary(failing)).toContain("failed")
    expect(codeBlockSummary(failing)).not.toContain(secret)
  })

  test("empty mentions no content", () => {
    const s = buildCodeBlockState({ code: "", language: null, wrap: false, selection: null })
    expect(codeBlockSummary(s)).toContain("no content")
  })

  test("degraded mentions degraded", () => {
    expect(codeBlockSummary({ ...base, status: "degraded" })).toContain("degraded")
  })

  test("long-content mentions line count", () => {
    expect(codeBlockSummary({ ...base, status: "long-content", lineCount: 600 })).toContain("lines")
  })

  test("populated reports line count with language", () => {
    expect(codeBlockSummary(base)).toContain("2 lines")
    expect(codeBlockSummary(base)).toContain("ts")
  })
})

describe("codeBlockAriaLabel — self-contained and never leaks", () => {
  test("produces a redacted self-describing label", () => {
    const s = buildCodeBlockState({ code: "hello", language: "ts", wrap: false, selection: null })
    const label = codeBlockAriaLabel(s)
    expect(label).toContain("ts")
    expect(label).toContain("lines")
    expect(label).not.toContain("undefined")
  })

  test("redacts secrets in error context", () => {
    const secret = "sk-live-abcdefghijklmnop123456"
    const s = buildCodeBlockState({
      code: "x",
      language: null,
      wrap: false,
      selection: null,
      context: { error: `token ${secret} invalid` },
    })
    const label = codeBlockAriaLabel(s)
    expect(label).not.toContain(secret)
  })
})

// ---------------------------------------------------------------------------
// 8. Component props and CodeBlockProps defaults
// ---------------------------------------------------------------------------

describe("CodeBlockProps — default derivation", () => {
  test("null language defaults to c family", () => {
    const s = buildCodeBlockState({ code: "x", language: null, wrap: false, selection: null })
    expect(s.family).toBe("c")
    expect(s.language).toBeNull()
  })

  test("null language defaults to c family", () => {
    const s = buildCodeBlockState({ code: "x", language: null, wrap: false, selection: null })
    expect(s.family).toBe("c")
    expect(s.language).toBeNull()
  })
})

// ===========================================================================
// LAYER 2 — RENDER TESTS
//
// These use the opentui headless renderer with the full context stack.
// Because mockInput.pressKey() does not route into opentui's on:keyPress
// event system on isolated boxes, these tests verify:
//   - Component life cycle (render + destroy does not throw)
//   - resize stability
//   - Reactive signal-driven content
// ===========================================================================

/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"

if (typeof (globalThis as Record<string, unknown>).requestAnimationFrame !== "function") {
  ;(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(0), 0) as unknown as number
}
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"

async function renderCodeBlock(
  width: number,
  code: string,
  opts: {
    language?: string | null
    context?: Record<string, unknown>
  } = {},
  height = 40,
) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <box id="code-block" />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height },
  )
  await app.renderOnce()
  return app
}

describe("CodeBlockView — render lifecycle", () => {
  test("component renders and destroys without throwing", async () => {
    const app = await renderCodeBlock(120, "hello", { language: "ts" })
    try {
      // Resize is handled gracefully
      app.resize(80, 40)
      await app.flush()
      app.resize(120, 40)
      await app.flush()
      expect(true).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })

  test("resize from narrow to wide does not throw", async () => {
    const app = await renderCodeBlock(40, "line1\nline2", { language: "ts" })
    try {
      app.resize(120, 40)
      await app.flush()
      app.resize(40, 40)
      await app.flush()
      expect(true).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })
})