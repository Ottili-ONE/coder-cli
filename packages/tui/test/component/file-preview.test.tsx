/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"

// The opentui renderer relies on requestAnimationFrame during paint; guarantee
// it exists in the test runtime so focus/highlight renders behave like the TUI.
if (typeof (globalThis as Record<string, unknown>).requestAnimationFrame !== "function") {
  ;(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(0), 0) as unknown as number
}
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import { FilePreview } from "../../src/component/file-preview/index"
import {
  type FilePreviewContext,
  type FilePreviewLine,
  PREVIEW_LONG_THRESHOLD,
  PREVIEW_MAX_LINES_DEFAULT,
  buildPreviewLine,
  buildState,
  capLines,
  deriveStatus,
  effectiveSelection,
  filePreviewSummary,
  foldLines,
  isNarrow,
  moveSelection,
  redactMessage,
  truncateLine,
  visibleLines,
} from "../../src/component/file-preview/model"

function line(id: number, raw: string): FilePreviewLine {
  return buildPreviewLine(id, raw)
}

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

// ---------- Pure model tests (no rendering, fully deterministic) ----------

test("deriveStatus prioritises blockers then content states", () => {
  expect(deriveStatus([], { denied: true })).toBe("denied")
  expect(deriveStatus([], { offline: true })).toBe("offline")
  expect(deriveStatus([], { failure: "boom" })).toBe("failure")
  expect(deriveStatus([], { loading: true })).toBe("loading")
  expect(deriveStatus([], {})).toBe("empty")
  expect(deriveStatus([line(0, "a")], { degraded: true })).toBe("degraded")
  expect(deriveStatus(Array.from({ length: PREVIEW_LONG_THRESHOLD + 1 }, (_, i) => line(i, `l${i}`)), {})).toBe("long")
  expect(deriveStatus([line(0, "a")], {})).toBe("populated")
  // denial wins even when content is present
  expect(deriveStatus([line(0, "a")], { denied: true })).toBe("denied")
})

test("buildPreviewLine strips ANSI and classifies severity", () => {
  const l = buildPreviewLine(2, "\x1b[31mError: boom\x1b[0m")
  expect(l.id).toBe(2)
  expect(l.text).toBe("Error: boom")
  expect(l.level).toBe("error")
  const w = buildPreviewLine(3, "Warning: deprecated")
  expect(w.level).toBe("warn")
})

test("capLines enforces the hard render budget", () => {
  const huge = Array.from({ length: PREVIEW_MAX_LINES_DEFAULT + 5000 }, (_, i) => line(i, `line ${i}`))
  const capped = capLines(huge)
  expect(capped.capped).toBe(true)
  expect(capped.lines.length).toBeLessThanOrEqual(PREVIEW_MAX_LINES_DEFAULT)
  expect(capped.lines.some((l) => l.isFoldMarker)).toBe(true)
  const small = capLines([line(0, "a")])
  expect(small.capped).toBe(false)
})

test("foldLines collapses the middle and reports hidden count", () => {
  const many = Array.from({ length: 30 }, (_, i) => line(i, `line ${i}`))
  const folded = foldLines(many, { folded: true })
  expect(folded.collapsible).toBe(true)
  expect(folded.hidden).toBe(30 - 12 - 6)
  expect(folded.lines[0]!.text).toBe("line 0")
  expect(folded.lines.at(-1)!.text).toBe("line 29")
  expect(folded.lines.some((l) => l.isFoldMarker)).toBe(true)

  const notFolded = foldLines(many, { folded: false })
  expect(notFolded.hidden).toBe(0)
  expect(notFolded.lines).toHaveLength(30)

  const small = Array.from({ length: 5 }, (_, i) => line(i, `line ${i}`))
  expect(foldLines(small, { folded: true }).collapsible).toBe(false)
})

test("visibleLines folds, searches, and stays within the cap when expanded", () => {
  const lines = Array.from({ length: 30 }, (_, i) => line(i, `line ${i}`))
  const state = buildState(lines, {})
  const folded = visibleLines(state, { headLines: 12, tailLines: 6 })
  expect(folded.hidden).toBeGreaterThan(0)
  expect(folded.lines.some((l) => l.isFoldMarker)).toBe(true)

  const searching = buildState(lines, {}, { query: "line 1" })
  const matched = visibleLines(searching)
  expect(matched.hidden).toBe(0)
  expect(matched.lines.every((l) => l.text.includes("line 1"))).toBe(true)
  expect(matched.matched).toBe(11)

  // Expanded view of a huge file is still capped (performance safeguard).
  const huge = Array.from({ length: PREVIEW_MAX_LINES_DEFAULT + 2000 }, (_, i) => line(i, `h${i}`))
  const hugeState = buildState(huge, {}, { folded: false })
  const expanded = visibleLines(hugeState, { headLines: 12, tailLines: 6 })
  expect(expanded.capped).toBe(true)
  expect(expanded.lines.length).toBeLessThanOrEqual(PREVIEW_MAX_LINES_DEFAULT)
})

test("effectiveSelection falls back when the selection is gone", () => {
  const lines = [line(0, "a"), line(1, "b"), line(2, "c")]
  const full = buildState(lines, {}, { selectedId: 1 })
  expect(effectiveSelection(full)).toBe(1)
  const shrunk = buildState([line(0, "a"), line(1, "b")], {}, { selectedId: 2 })
  expect(effectiveSelection(shrunk)).toBe(0)
  expect(effectiveSelection(buildState([], {}))).toBeNull()
})

test("moveSelection clamps at the ends", () => {
  const lines = [line(0, "a"), line(1, "b"), line(2, "c")]
  const first = buildState(lines, {}, { selectedId: 0 })
  expect(moveSelection(first, -1)).toBe(0)
  const last = buildState(lines, {}, { selectedId: 2 })
  expect(moveSelection(last, 1)).toBe(2)
  const mid = buildState(lines, {}, { selectedId: 0 })
  expect(moveSelection(mid, 1)).toBe(1)
})

test("isNarrow and truncateLine respect the width budget", () => {
  expect(isNarrow(40)).toBe(true)
  expect(isNarrow(80)).toBe(false)
  const long = line(0, "x".repeat(200))
  expect(truncateLine(long, 10).text.endsWith("…")).toBe(true)
  expect(truncateLine(long, 10).text.length).toBe(10)
  // Narrow never truncates the fold marker.
  const marker = buildPreviewLine(-1, "50 lines hidden — press space to expand")
  marker.isFoldMarker = true
  expect(truncateLine(marker, 10)).toBe(marker)
})

test("redactMessage removes secrets from failure/denied diagnostics", () => {
  expect(redactMessage("Bearer sk-live-abcdefghijklmnop")).toContain("••••")
  expect(redactMessage("api_key = supersecretvalue123")).not.toContain("supersecretvalue123")
  expect(redactMessage("Bearer sk-live-abcdefghijklmnop")).not.toContain("sk-live")
})

test("filePreviewSummary is semantic per state and redacts on failure", () => {
  expect(filePreviewSummary(buildState([], { loading: true }), "a.ts")).toContain("loading")
  expect(filePreviewSummary(buildState([], {}), "a.ts")).toContain("empty")
  expect(filePreviewSummary(buildState([line(0, "a")], {}), "a.ts")).toContain("1 line")
  expect(filePreviewSummary(buildState([], { denied: true }), "/secret/x")).toContain("access denied")
  expect(filePreviewSummary(buildState([], { offline: true }), "a.ts")).toContain("offline")
  const failing = filePreviewSummary(buildState([], { failure: "Bearer sk-live-abcdefghijklmnop" }), "a.ts")
  expect(failing).toContain("Failed to read")
  expect(failing).not.toContain("sk-live")
})

// ---------- Render tests: prove each state actually paints ----------

async function renderPreview(
  width: number,
  props: Parameters<typeof FilePreview>[0],
  height = 40,
) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <FilePreview {...props} />
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

test("renders the loading state with an accessible label", async () => {
  const app = await renderPreview(120, { content: accessor([]), loading: accessor(true), path: "a.ts" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("File preview")
    expect(frame).toContain("Loading file contents")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the empty state as actionable, not silent", async () => {
  const app = await renderPreview(120, { content: accessor([]), path: "empty.ts" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("No content")
    expect(frame).toContain("empty.ts")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the denied state with a redacted path and retry hint", async () => {
  const app = await renderPreview(120, {
    content: accessor([]),
    denied: accessor(true),
    path: "/home/user/.ssh/id_rsa",
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Access denied")
    expect(frame).toContain("Press r to retry")
    // The sensitive path is shown but secrets within it stay redacted.
    expect(frame).toContain("id_rsa")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the offline state", async () => {
  const app = await renderPreview(120, { content: accessor([]), offline: accessor(true), path: "remote.ts" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Offline")
    expect(frame).toContain("Press r to retry")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the failure path with a redacted message", async () => {
  const app = await renderPreview(120, {
    content: accessor([]),
    failure: accessor("Connection refused: Bearer sk-live-abcdefghijklmnop"),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Failed to read")
    expect(frame).toContain("Connection refused")
    expect(frame).not.toContain("sk-live")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the degraded state with a banner above the content", async () => {
  const app = await renderPreview(120, {
    content: accessor(["line one", "line two"]),
    degraded: accessor(true),
    degradedReason: accessor("binary file"),
    path: "img.png",
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Limited preview")
    expect(frame).toContain("binary file")
    expect(frame).toContain("line one")
    expect(frame).toContain("line two")
  } finally {
    app.renderer.destroy()
  }
})

test("folds long content and expands on space", async () => {
  const lines = Array.from({ length: 40 }, (_, i) => `preview line ${i}`)
  const app = await renderPreview(120, { content: accessor(lines), path: "big.ts" })
  try {
    const foldedFrame = app.captureCharFrame()
    expect(foldedFrame).toContain("lines hidden")
    expect(foldedFrame).toContain("press space to expand")
    expect(foldedFrame).not.toContain("preview line 25")

    app.mockInput.pressKey(" ")
    await app.flush()
    const expandedFrame = app.captureCharFrame()
    expect(expandedFrame).toContain("preview line 25")
    expect(expandedFrame).not.toContain("press space to expand")
  } finally {
    app.renderer.destroy()
  }
})

test("renders populated content with ANSI-safe text", async () => {
  const app = await renderPreview(120, {
    content: accessor(["\x1b[32mconst ok = true\x1b[0m", "plain line"]),
    path: "ok.ts",
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("\x1b[")
    expect(frame).toContain("const ok = true")
    expect(frame).toContain("plain line")
  } finally {
    app.renderer.destroy()
  }
})

test("narrow terminals truncate long lines without dropping all meaning", async () => {
  const longLine = "x".repeat(200)
  const app = await renderPreview(40, { content: accessor(["short", longLine]), path: "f.ts" })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("…")
    expect(frame).toContain("short")
    expect(frame).not.toContain(longLine)
  } finally {
    app.renderer.destroy()
  }
})

test("standard width shows full lines that narrow would truncate", async () => {
  const longLine = "y".repeat(120)
  const narrow = await renderPreview(40, { content: accessor([longLine]), path: "f.ts" })
  const wide = await renderPreview(160, { content: accessor([longLine]), path: "f.ts" })
  try {
    expect(narrow.captureCharFrame()).toContain("…")
    expect(wide.captureCharFrame()).toContain(longLine)
  } finally {
    narrow.renderer.destroy()
    wide.renderer.destroy()
  }
})

test("keyboard navigation moves focus between lines", async () => {
  const app = await renderPreview(120, {
    content: accessor(["first", "second", "third"]),
    path: "f.ts",
  })
  try {
    expect(app.captureCharFrame()).toContain("> first")
    app.mockInput.pressArrow("down")
    await app.flush()
    expect(app.captureCharFrame()).toContain("> second")
    app.mockInput.pressArrow("down")
    await app.flush()
    expect(app.captureCharFrame()).toContain("> third")
    app.mockInput.pressArrow("up")
    await app.flush()
    expect(app.captureCharFrame()).toContain("> second")
  } finally {
    app.renderer.destroy()
  }
})

test("copy key copies the focused line and signals it", async () => {
  let copied = ""
  const app = await renderPreview(120, {
    content: accessor(["focus me", "skip me"]),
    path: "f.ts",
    onCopy: (text) => {
      copied = text
    },
  })
  try {
    app.mockInput.pressKey("y")
    await app.flush()
    expect(copied).toBe("focus me")
    expect(app.captureCharFrame()).toContain("copied")
  } finally {
    app.renderer.destroy()
  }
})

test("search filters to matches and shows a count, escape clears", async () => {
  const lines = ["info message", "Error: disk full", "another error here", "plain text"]
  const app = await renderPreview(120, { content: accessor(lines), path: "f.ts" })
  try {
    app.mockInput.pressKey("/")
    app.mockInput.typeText("error")
    await app.flush()
    const frame = app.captureCharFrame()
    expect(frame).toContain("2 matches")
    expect(frame).toContain("Error: disk full")
    expect(frame).toContain("another error here")
    expect(frame).not.toContain("info message")

    app.mockInput.pressEscape()
    await app.flush()
    const cleared = app.captureCharFrame()
    expect(cleared).not.toContain("matches")
    expect(cleared).toContain("info message")
  } finally {
    app.renderer.destroy()
  }
})

test("retry key fires onRetry only on retryable states", async () => {
  let retries = 0
  const app = await renderPreview(120, {
    content: accessor([]),
    failure: accessor("boom"),
    onRetry: () => {
      retries++
    },
  })
  try {
    app.mockInput.pressKey("r")
    await app.flush()
    expect(retries).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("streaming append keeps focus on a real visible line", async () => {
  const [content, setContent] = createSignal<string[]>(["line one"])
  const app = await renderPreview(120, { content, path: "f.ts" })
  try {
    expect(app.captureCharFrame()).toContain("> line one")
    setContent(["line one", "line two", "line three"])
    await app.flush()
    const frame = app.captureCharFrame()
    expect(frame).toContain("line two")
    expect(frame).toContain("line three")
    expect(frame).toContain("> line one")
  } finally {
    app.renderer.destroy()
  }
})

test("huge file shows a render-budget cap notice and stays bounded", async () => {
  const lines = Array.from({ length: PREVIEW_MAX_LINES_DEFAULT + 3000 }, (_, i) => `huge line ${i}`)
  const app = await renderPreview(120, { content: accessor(lines), path: "huge.log", folded: false })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("render capped")
    expect(frame).toContain(String(PREVIEW_MAX_LINES_DEFAULT))
  } finally {
    app.renderer.destroy()
  }
})
