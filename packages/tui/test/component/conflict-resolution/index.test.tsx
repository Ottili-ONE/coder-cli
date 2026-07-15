/** @jsxImportSource @opentui/solid */
import { testRender, useRenderer } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createSignal, onCleanup, type JSX } from "solid-js"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider, resolve } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { OttiliCoderKeymapProvider, registerOttiliCoderKeymap } from "../../../src/keymap"
import { ConflictResolutionView } from "../../../src/component/conflict-resolution/index"
import {
  type ConflictAction,
  type ConflictFile,
  makeConflict,
} from "../../../src/component/conflict-resolution/model"

function list(): ConflictFile[] {
  return [
    makeConflict("src/a.ts", "merge"),
    makeConflict("src/b.ts", "merge"),
    makeConflict("src/c.ts", "rebase"),
    makeConflict("docs/README.md", "merge"),
  ]
}

type Mount = {
  app: Awaited<ReturnType<typeof testRender>>
  actions: ConflictAction[]
  setFiles: (f: ConflictFile[]) => void
  setLoading: (v: boolean) => void
  setError: (e: string | undefined) => void
}

function KeymapWrapper(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
  onCleanup(registerOttiliCoderKeymap(keymap, renderer, resolvedConfig))
  return <OttiliCoderKeymapProvider keymap={keymap}>{props.children}</OttiliCoderKeymapProvider>
}

function mount(opts: { width?: number; initial?: ConflictFile[]; loading?: boolean; error?: string } = {}): Promise<Mount> {
  const actions: ConflictAction[] = []
  let setFiles!: (f: ConflictFile[]) => void
  let setLoading!: (v: boolean) => void
  let setError!: (e: string | undefined) => void

  const app = testRender(() => {
    const [files, setF] = createSignal<ConflictFile[]>(opts.initial ?? [])
    setFiles = setF
    const [loading, setL] = createSignal(opts.loading ?? false)
    setLoading = setL
    const [error, setE] = createSignal<string | undefined>(opts.error)
    setError = setE
    return (
      <TestTuiContexts>
        <TuiConfigProvider config={resolve({}, { terminalSuspend: true })}>
          <KeymapWrapper>
            <ArgsProvider>
              <KVProvider>
                <ThemeProvider>
                  <ConflictResolutionView
                    files={files}
                    loading={loading}
                    error={error}
                    onAction={(a) => actions.push(a)}
                  />
                </ThemeProvider>
              </KVProvider>
            </ArgsProvider>
          </KeymapWrapper>
        </TuiConfigProvider>
      </TestTuiContexts>
    )
  }, { width: opts.width ?? 120, height: 40 })

  return app.then((a) => ({ app: a, actions, setFiles, setLoading, setError }))
}

describe("ConflictResolutionView — semantic output (not implementation trivia)", () => {
  test("paints a progress summary, every conflict, and resolution badges", async () => {
    const { app } = await mount({ initial: list() })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("Merge conflicts — 0/4 resolved · 4 to go")
      expect(frame).toContain("src/a.ts")
      expect(frame).toContain("src/b.ts")
      expect(frame).toContain("src/c.ts")
      expect(frame).toContain("docs/README.md")
      expect(frame).toContain("[ ]")
      expect(frame).toContain("[o]urs")
      expect(frame).toContain("[c]ontinue")
      expect(frame).toContain("[a]bort")
    } finally {
      app.renderer.destroy()
    }
  })

  test("binary conflict still renders without a side pre chosen", async () => {
    const { app } = await mount({ initial: [makeConflict("img.png", "merge", { binary: true })] })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("img.png")
      expect(frame).toContain("[ ]")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("ConflictResolutionView — narrow and standard terminal dimensions", () => {
  test("standard width shows full detail", async () => {
    const { app } = await mount({ width: 120, initial: list() })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("src/a.ts")
      expect(frame).toContain("[ ]")
    } finally {
      app.renderer.destroy()
    }
  })
  test("narrow width keeps every file and its badge readable", async () => {
    const { app } = await mount({ width: 50, initial: list() })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("src/a.ts")
      expect(frame).toContain("src/b.ts")
      expect(frame).toContain("src/c.ts")
      expect(frame).toContain("docs/README.md")
      expect(frame).toContain("[ ]")
      expect(frame).toContain("[c]ontinue")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("ConflictResolutionView — keyboard navigation and focus", () => {
  test("down moves focus and marks the focused file with '>'", async () => {
    const { app } = await mount({ initial: list() })
    try {
      expect(app.captureCharFrame()).toContain("> src/a.ts")
      app.mockInput.pressArrow("down")
      await app.flush()
      expect(app.captureCharFrame()).toContain("> src/b.ts")
      app.mockInput.pressArrow("up")
      await app.flush()
      expect(app.captureCharFrame()).toContain("> src/a.ts")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("ConflictResolutionView — file resolver keybindings", () => {
  test("o / t / u / m resolve the focused file to each side", async () => {
    const { app } = await mount({ initial: list() })
    try {
      app.mockInput.pressKey("o")
      await app.flush()
      expect(app.captureCharFrame()).toContain("src/a.ts") // still listed
      expect(app.captureCharFrame()).toContain("[ours]")

      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressKey("t")
      await app.flush()
      expect(app.captureCharFrame()).toContain("[theirs]")

      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressKey("u")
      await app.flush()
      expect(app.captureCharFrame()).toContain("[union]")

      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressKey("m")
      await app.flush()
      expect(app.captureCharFrame()).toContain("[manual]")
    } finally {
      app.renderer.destroy()
    }
  })

  test("resolving files updates the progress summary", async () => {
    const { app } = await mount({ initial: list() })
    try {
      app.mockInput.pressKey("o")
      await app.flush()
      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressKey("t")
      await app.flush()
      expect(app.captureCharFrame()).toContain("Merge conflicts — 2/4 resolved · 2 to go")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("ConflictResolutionView — validation and abort/continue", () => {
  test("continue is blocked while conflicts remain (failure path)", async () => {
    const { app, actions } = await mount({ initial: list() })
    try {
      app.mockInput.pressKey("c")
      await app.flush()
      const last = actions.at(-1) as { type: string; reason?: string }
      expect(last.type).toBe("blocked")
      expect(last.reason).toContain("still unresolved")
    } finally {
      app.renderer.destroy()
    }
  })

  test("continue is allowed once every conflict is resolved", async () => {
    const { app, actions } = await mount({ initial: list() })
    try {
      for (let i = 0; i < 4; i++) {
        app.mockInput.pressKey("o")
        await app.flush()
        app.mockInput.pressArrow("down")
        await app.flush()
      }
      app.mockInput.pressKey("c")
      await app.flush()
      expect((actions.at(-1) as { type: string }).type).toBe("continue")
    } finally {
      app.renderer.destroy()
    }
  })

  test("abort emits an abort action", async () => {
    const { app, actions } = await mount({ initial: list() })
    try {
      app.mockInput.pressKey("a")
      await app.flush()
      expect((actions.at(-1) as { type: string }).type).toBe("abort")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("ConflictResolutionView — streaming updates", () => {
  test("shows a stale scanning marker then settles to the full list", async () => {
    const { app, setFiles, setLoading } = await mount({ initial: list().slice(0, 2), loading: true })
    try {
      const streaming = app.captureCharFrame()
      expect(streaming).toContain("scanning")
      expect(streaming).toContain("src/a.ts")
      expect(streaming).not.toContain("docs/README.md")

      setFiles(list())
      setLoading(false)
      await app.flush()
      const settled = app.captureCharFrame()
      expect(settled).not.toContain("scanning")
      expect(settled).toContain("docs/README.md")
      expect(settled).toContain("Merge conflicts — 0/4 resolved · 4 to go")
    } finally {
      app.renderer.destroy()
    }
  })
})

describe("ConflictResolutionView — failure path", () => {
  test("renders an error state and hides the file list", async () => {
    const { app } = await mount({ initial: list(), error: "fatal: corrupted index" })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("Resolution failed")
      expect(frame).toContain("corrupted index")
      expect(frame).not.toContain("src/a.ts")
    } finally {
      app.renderer.destroy()
    }
  })

  test("redacts secrets shown in the error", async () => {
    const { app } = await mount({
      initial: list(),
      error: "fatal: token=sk-live-abcdefghijklmnop rejected",
    })
    try {
      const frame = app.captureCharFrame()
      expect(frame).not.toContain("sk-live")
      expect(frame).toContain("••••")
    } finally {
      app.renderer.destroy()
    }
  })
})
