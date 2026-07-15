/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import { FilePreview } from "../../src/component/file-preview/index"

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

async function renderPreview(width: number, props: Parameters<typeof FilePreview>[0], height = 40) {
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

// ---------- Accessible labels + lifecycle states ----------

test("renders the loading state with an accessible label", async () => {
  const app = await renderPreview(120, { content: accessor([]), loading: accessor(true), path: accessor("src/app.ts") })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("File preview")
    expect(frame).toContain("src/app.ts")
    expect(frame).toContain("loading")
  } finally {
    app.renderer.destroy()
  }
})

test("renders the empty state when the file has no content", async () => {
  const app = await renderPreview(120, { content: accessor([]), path: accessor("empty.ts") })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("File preview")
    expect(frame).toContain("empty")
    expect(frame).toContain("No content")
  } finally {
    app.renderer.destroy()
  }
})

test("renders populated content with line count and ANSI-safe text", async () => {
  const app = await renderPreview(120, {
    content: accessor(["\x1b[32mconst x = 1\x1b[0m", "function main() {}"]),
    path: accessor("src/app.ts"),
  })
  try {
    const frame = app.captureCharFrame()
    // ANSI is stripped before it reaches the terminal frame.
    expect(frame).not.toContain("\x1b[")
    expect(frame).toContain("const x = 1")
    expect(frame).toContain("function main() {}")
    expect(frame).toContain("2 lines")
  } finally {
    app.renderer.destroy()
  }
})

test("failure path redacts the message and offers a retry", async () => {
  const app = await renderPreview(120, {
    content: accessor(["Booting…"]),
    failure: accessor("Connection refused: Bearer sk-live-abcdefghijklmnop"),
    path: accessor("secret.ts"),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Failed to read")
    expect(frame).toContain("Connection refused")
    expect(frame).toContain("Press r to retry")
    expect(frame).not.toContain("sk-live")
  } finally {
    app.renderer.destroy()
  }
})

test("denied path reports access refusal and a retry hint", async () => {
  const app = await renderPreview(120, {
    content: accessor(["x"]),
    denied: accessor(true),
    path: accessor("/etc/secret"),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Access denied")
    expect(frame).toContain("Press r to retry")
  } finally {
    app.renderer.destroy()
  }
})

test("offline path reports an unreachable source", async () => {
  const app = await renderPreview(120, {
    content: accessor(["x"]),
    offline: accessor(true),
    path: accessor("remote://file"),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Offline")
    expect(frame).toContain("Press r to retry")
  } finally {
    app.renderer.destroy()
  }
})

test("degraded path reports reduced fidelity with a reason", async () => {
  const app = await renderPreview(120, {
    content: accessor(["binary blob"]),
    degraded: accessor(true),
    degradedReason: accessor("binary file"),
  })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Limited preview")
    expect(frame).toContain("binary file")
  } finally {
    app.renderer.destroy()
  }
})

// ---------- Large-file / fold behavior ----------

test("large files fold by default and expand on space", async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `source line ${i}`)
  const app = await renderPreview(120, { content: accessor(lines), path: accessor("big.ts") })
  try {
    const folded = app.captureCharFrame()
    expect(folded).toContain("lines hidden")
    expect(folded).toContain("press space to expand")
    expect(folded).not.toContain("source line 20")

    app.mockInput.pressKey(" ")
    await app.flush()
    const expanded = app.captureCharFrame()
    expect(expanded).toContain("source line 20")
    expect(expanded).not.toContain("press space to expand")
  } finally {
    app.renderer.destroy()
  }
})

test("very large files are capped with a performance notice", async () => {
  const lines = Array.from({ length: 6000 }, (_, i) => `l${i}`)
  const app = await renderPreview(120, { content: accessor(lines), path: accessor("huge.ts") })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Large file")
    expect(frame).toContain("render capped")
  } finally {
    app.renderer.destroy()
  }
})

// ---------- Narrow vs standard terminal dimensions ----------

test("narrow terminals truncate long lines without dumping raw content", async () => {
  const longLine = "x".repeat(200)
  const app = await renderPreview(40, { content: accessor(["short", longLine]), path: accessor("a.ts") })
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
  const narrow = await renderPreview(40, { content: accessor([longLine]), path: accessor("a.ts") })
  const wide = await renderPreview(160, { content: accessor([longLine]), path: accessor("a.ts") })
  try {
    expect(narrow.captureCharFrame()).toContain("…")
    expect(wide.captureCharFrame()).toContain(longLine)
  } finally {
    narrow.renderer.destroy()
    wide.renderer.destroy()
  }
})

// ---------- Keyboard navigation + focus behavior ----------

test("arrow keys move focus between lines (regression for keybindings)", async () => {
  const app = await renderPreview(120, {
    content: accessor(["first", "second", "third"]),
    path: accessor("a.ts"),
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

test("j/k keys also move focus, matching the vi-style binding", async () => {
  const app = await renderPreview(120, { content: accessor(["a", "b", "c"]), path: accessor("a.ts") })
  try {
    app.mockInput.pressKey("j")
    await app.flush()
    expect(app.captureCharFrame()).toContain("> b")
    app.mockInput.pressKey("k")
    await app.flush()
    expect(app.captureCharFrame()).toContain("> a")
  } finally {
    app.renderer.destroy()
  }
})

test("copy key copies the focused line and signals it", async () => {
  let copied = ""
  const app = await renderPreview(120, {
    content: accessor(["focus me", "skip me"]),
    path: accessor("a.ts"),
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

test("enter activates the focused line and reports its id", async () => {
  let activated = -1
  const app = await renderPreview(120, {
    content: accessor(["alpha", "beta"]),
    path: accessor("a.ts"),
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

test("open key fires onOpen with the path", async () => {
  let opened: string | undefined
  const app = await renderPreview(120, {
    content: accessor(["x"]),
    path: accessor("src/open.ts"),
    onOpen: (p) => {
      opened = p
    },
  })
  try {
    app.mockInput.pressKey("o")
    await app.flush()
    expect(opened).toBe("src/open.ts")
  } finally {
    app.renderer.destroy()
  }
})

test("retry key fires onRetry only on a retryable failure", async () => {
  let retries = 0
  const app = await renderPreview(120, {
    content: accessor(["x"]),
    failure: accessor("boom"),
    path: accessor("a.ts"),
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

test("retry key is a no-op on healthy content", async () => {
  let retries = 0
  const app = await renderPreview(120, {
    content: accessor(["x"]),
    path: accessor("a.ts"),
    onRetry: () => {
      retries++
    },
  })
  try {
    app.mockInput.pressKey("r")
    await app.flush()
    expect(retries).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

test("search filters to matches, shows a count, and escape clears", async () => {
  const lines = ["info message", "Error: disk full", "another error here", "plain text"]
  const app = await renderPreview(120, { content: accessor(lines), path: accessor("a.ts") })
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

// ---------- Resize behavior ----------

test("resize clears narrow truncation after widening", async () => {
  const longLine = "z".repeat(150)
  const app = await renderPreview(40, { content: accessor([longLine]), path: accessor("a.ts") })
  try {
    expect(app.captureCharFrame()).toContain("…")
    app.resize(160, 40)
    await app.flush()
    expect(app.captureCharFrame()).toContain(longLine)
  } finally {
    app.renderer.destroy()
  }
})

// ---------- Streaming updates ----------

test("streaming updates append lines and keep selection valid", async () => {
  const [content, setContent] = createSignal<string[]>(["line one"])
  const app = await renderPreview(120, { content, path: accessor("a.ts") })
  try {
    expect(app.captureCharFrame()).toContain("line one")

    setContent(["line one", "line two", "line three"])
    await app.flush()
    const frame = app.captureCharFrame()
    expect(frame).toContain("line two")
    expect(frame).toContain("line three")
    // Focus stays on a real, visible line (not lost on append).
    expect(frame).toContain("> line one")
  } finally {
    app.renderer.destroy()
  }
})

test("streaming transitions loading -> populated and selection stays valid", async () => {
  const [content, setContent] = createSignal<string[]>([])
  const [loading, setLoading] = createSignal(true)
  const app = await renderPreview(120, { content, loading, path: accessor("a.ts") })
  try {
    expect(app.captureCharFrame()).toContain("loading")

    setContent(["alpha", "beta"])
    setLoading(false)
    await app.flush()
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("loading")
    expect(frame).toContain("2 lines")
    expect(frame).toContain("> alpha")
  } finally {
    app.renderer.destroy()
  }
})
