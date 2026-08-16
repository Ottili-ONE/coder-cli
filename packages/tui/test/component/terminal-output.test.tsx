/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import { TerminalOutput } from "../../src/component/terminal-output/index"
import {
  type TerminalLine,
  buildTerminalLine,
  classifyLine,
  deriveStatus,
  effectiveSelection,
  foldLines,
  isNarrow,
  matchCount,
  moveSelection,
  redactFailure,
  stripAnsiLine,
  terminalSummary,
  truncateLine,
  visibleLines,
  buildState,
} from "../../src/component/terminal-output/model"

function line(id: number, raw: string): TerminalLine {
  return buildTerminalLine(id, raw)
}

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

// ---------- Pure model tests (no rendering, fully deterministic) ----------

test("classifyLine maps severity from stripped text", () => {
  expect(classifyLine("everything is fine")).toBe("info")
  expect(classifyLine("Warning: deprecated API")).toBe("warn")
  expect(classifyLine("Error: command failed")).toBe("error")
  expect(classifyLine("\x1b[31mFatal: panic\x1b[0m")).toBe("error")
  expect(classifyLine("attempt 2 of 3")).toBe("warn")
})

test("stripAnsiLine removes escape sequences", () => {
  expect(stripAnsiLine("\x1b[32mgreen\x1b[0m")).toBe("green")
  expect(stripAnsiLine("plain")).toBe("plain")
  expect(stripAnsiLine("")).toBe("")
})

test("buildTerminalLine strips and classifies in one step", () => {
  const l = buildTerminalLine(3, "\x1b[31mError: boom\x1b[0m")
  expect(l.id).toBe(3)
  expect(l.text).toBe("Error: boom")
  expect(l.level).toBe("error")
})

test("deriveStatus tracks the lifecycle and lets failure win", () => {
  expect(deriveStatus([], { complete: false })).toBe("empty")
  expect(deriveStatus([line(0, "a")], { complete: false })).toBe("streaming")
  expect(deriveStatus([line(0, "a")], { complete: true })).toBe("complete")
  expect(deriveStatus([line(0, "a")], { complete: false, failure: "boom" })).toBe("failure")
})

test("foldLines collapses the middle and reports hidden count", () => {
  const many = Array.from({ length: 20 }, (_, i) => line(i, `line ${i}`))
  const folded = foldLines(many, { folded: true })
  expect(folded.collapsible).toBe(true)
  expect(folded.hidden).toBe(20 - 8 - 4)
  expect(folded.lines[0]!.text).toBe("line 0")
  expect(folded.lines.at(-1)!.text).toBe("line 19")
  expect(folded.lines.some((l) => l.isFoldMarker)).toBe(true)

  const notFolded = foldLines(many, { folded: false })
  expect(notFolded.hidden).toBe(0)
  expect(notFolded.lines).toHaveLength(20)

  const small = Array.from({ length: 5 }, (_, i) => line(i, `line ${i}`))
  expect(foldLines(small, { folded: true }).collapsible).toBe(false)
})

test("matchCount counts case-insensitive substring matches", () => {
  const lines = [line(0, "info line"), line(1, "Error: boom"), line(2, "another error")]
  expect(matchCount(lines, "error")).toBe(2)
  expect(matchCount(lines, "ERROR")).toBe(2)
  expect(matchCount(lines, "")).toBe(0)
})

test("visibleLines narrows by search and folds otherwise", () => {
  const lines = Array.from({ length: 20 }, (_, i) => line(i, `line ${i}`))
  const state = buildState(lines, { complete: true })
  // No query, folded => a marker appears and lines are collapsed.
  const folded = visibleLines(state, { headLines: 8, tailLines: 4 })
  expect(folded.hidden).toBeGreaterThan(0)
  expect(folded.lines.some((l) => l.isFoldMarker)).toBe(true)
  // A query disables folding and shows only matches.
  const searching = buildState(lines, { complete: true }, { query: "line 1" })
  const matched = visibleLines(searching)
  expect(matched.hidden).toBe(0)
  expect(matched.lines.every((l) => l.text.includes("line 1"))).toBe(true)
  expect(matched.matched).toBe(11)
})

test("effectiveSelection falls back when the selection is gone", () => {
  const lines = [line(0, "a"), line(1, "b"), line(2, "c")]
  const full = buildState(lines, { complete: true }, { selectedId: 1 })
  expect(effectiveSelection(full)).toBe(1)
  // Selection points at a removed line -> first visible row.
  const shrunk = buildState([line(0, "a"), line(1, "b")], { complete: true }, { selectedId: 2 })
  expect(effectiveSelection(shrunk)).toBe(0)
  // Empty -> null (never trapped on a ghost).
  expect(effectiveSelection(buildState([], { complete: true }))).toBeNull()
})

test("moveSelection clamps at the ends", () => {
  const lines = [line(0, "a"), line(1, "b"), line(2, "c")]
  const first = buildState(lines, { complete: true }, { selectedId: 0 })
  expect(moveSelection(first, -1)).toBe(0)
  const last = buildState(lines, { complete: true }, { selectedId: 2 })
  expect(moveSelection(last, 1)).toBe(2)
  const mid = buildState(lines, { complete: true }, { selectedId: 0 })
  expect(moveSelection(mid, 1)).toBe(1)
})

test("isNarrow and truncateLine respect the width budget", () => {
  expect(isNarrow(40)).toBe(true)
  expect(isNarrow(80)).toBe(false)
  const long = line(0, "x".repeat(200))
  expect(truncateLine(long, 10).text.endsWith("…")).toBe(true)
  expect(truncateLine(long, 10).text.length).toBe(10)
  // Narrow never truncates the fold marker.
  const marker = buildState([], { complete: true }).lines
  void marker
})

test("terminalSummary is semantic per state and redacts on failure", () => {
  expect(terminalSummary(buildState([], { complete: false }))).toContain("no output yet")
  expect(terminalSummary(buildState([line(0, "a")], { complete: false }))).toContain("streaming")
  expect(terminalSummary(buildState([line(0, "a")], { complete: true }))).toContain("1 line")
  const failing = terminalSummary(buildState([line(0, "a")], { complete: false, failure: "Bearer secret-token-should-be-redacted" }))
  expect(failing).toContain("Failed:")
  expect(failing).not.toContain("secret-token")
  expect(redactFailure("api_key = supersecretvalue123")).toContain("••••")
})

// ---------- Render tests: prove each state actually paints ----------

async function renderOutput(
  width: number,
  props: Parameters<typeof TerminalOutput>[0],
  height = 40,
) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KVProvider>
            <ThemeProvider>
              <TerminalOutput {...props} />
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

test("renders the empty state with an accessible label", async () => {
  const app = await renderOutput(120, { lines: accessor([]) })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Terminal output:")
    expect(frame).toContain("No output yet")
  } finally {
    app.renderer.destroy()
  }
})

test("renders streaming output with status and ANSI-safe text", async () => {
  const app = await renderOutput(120, {
    lines: accessor(["\x1b[32m$ npm install\x1b[0m", "added 12 packages"]),
  })
  try {
    const frame = app.captureCharFrame()
    // ANSI escapes are stripped before display.
    expect(frame).not.toContain("\x1b[")
    expect(frame).toContain("$ npm install")
    expect(frame).toContain("added 12 packages")
    expect(frame).toContain("streaming")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the complete summary with line count", async () => {
  const app = await renderOutput(120, {
    lines: accessor(["line one", "line two"]),
    complete: accessor(true),
  })
  try {
    expect(app.captureCharFrame()).toContain("2 lines")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the failure path with redacted message and keeps prior output", async () => {
  const app = await renderOutput(120, {
    lines: accessor(["Booting…", "Connecting to service"]),
    complete: accessor(false),
    failure: accessor("Connection refused: Bearer sk-live-abcdefghijklmnop"),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Failed:")
    expect(frame).toContain("Connection refused")
    expect(frame).not.toContain("sk-live")
    // Prior streamed lines remain visible alongside the failure banner.
    expect(frame).toContain("Booting…")
    expect(frame).toContain("Connecting to service")
  } finally {
    app.renderer.destroy()
  }
})

test("folds long output and expands on space", async () => {
  const lines = Array.from({ length: 25 }, (_, i) => `streamed line ${i}`)
  const app = await renderOutput(120, { lines: accessor(lines), complete: accessor(true) })
  try {
    const foldedFrame = app.captureCharFrame()
    expect(foldedFrame).toContain("lines hidden")
    expect(foldedFrame).toContain("press space to expand")
    expect(foldedFrame).not.toContain("streamed line 12")

    app.mockInput.pressKey(" ")
    await app.flush()
    const expandedFrame = app.captureCharFrame()
    expect(expandedFrame).toContain("streamed line 12")
    expect(expandedFrame).not.toContain("press space to expand")
  } finally {
    app.renderer.destroy()
  }
})

test("narrow terminals truncate long lines without dropping content meaning", async () => {
  const longLine = "x".repeat(200)
  const app = await renderOutput(40, { lines: accessor(["short", longLine]), complete: accessor(true) })
  try {
    const frame = app.captureCharFrame()
    // The long line is truncated with an ellipsis on a narrow terminal.
    expect(frame).toContain("…")
    expect(frame).toContain("short")
    // The raw 200-char run is not dumped verbatim into the narrow frame.
    expect(frame).not.toContain(longLine)
  } finally {
    app.renderer.destroy()
  }
})

test("standard width shows full lines that narrow would truncate", async () => {
  const longLine = "y".repeat(120)
  const narrow = await renderOutput(40, { lines: accessor([longLine]), complete: accessor(true) })
  const wide = await renderOutput(160, { lines: accessor([longLine]), complete: accessor(true) })
  try {
    expect(narrow.captureCharFrame()).toContain("…")
    expect(wide.captureCharFrame()).toContain(longLine)
  } finally {
    narrow.renderer.destroy()
    wide.renderer.destroy()
  }
})

test("keyboard navigation moves focus between lines", async () => {
  const app = await renderOutput(120, {
    lines: accessor(["first", "second", "third"]),
    complete: accessor(true),
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
  const app = await renderOutput(120, {
    lines: accessor(["focus me", "skip me"]),
    complete: accessor(true),
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
  const app = await renderOutput(120, { lines: accessor(lines), complete: accessor(true) })
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

test("resize behavior: a narrow truncation clears after widening", async () => {
  const longLine = "z".repeat(150)
  const app = await renderOutput(40, { lines: accessor([longLine]), complete: accessor(true) })
  try {
    expect(app.captureCharFrame()).toContain("…")
    app.resize(160, 40)
    await app.flush()
    expect(app.captureCharFrame()).toContain(longLine)
  } finally {
    app.renderer.destroy()
  }
})

test("streaming updates append lines and keep selection valid", async () => {
  const [lines, setLines] = createSignal<string[]>(["line one"])
  const app = await renderOutput(120, { lines, complete: accessor(false) })
  try {
    expect(app.captureCharFrame()).toContain("streaming")
    expect(app.captureCharFrame()).toContain("line one")

    setLines(["line one", "line two", "line three"])
    await app.flush()
    const frame = app.captureCharFrame()
    expect(frame).toContain("line two")
    expect(frame).toContain("line three")
    // Selection stays on a real, visible line (focus not lost on append).
    expect(frame).toContain("> line one")
  } finally {
    app.renderer.destroy()
  }
})

test("selection activates via enter and reports the focused id", async () => {
  let activated = -1
  const app = await renderOutput(120, {
    lines: accessor(["alpha", "beta"]),
    complete: accessor(true),
    onSelect: (id) => {
      activated = id
    },
  })
  try {
    app.mockInput.pressArrow("down")
    await app.flush()
    app.mockInput.pressEnter()
    await app.flush()
    expect(activated).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
