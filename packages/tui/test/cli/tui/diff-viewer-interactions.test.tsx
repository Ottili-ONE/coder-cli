/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, Show, type JSX } from "solid-js"
import { TextareaRenderable, type DiffRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { TuiPluginApi, TuiPluginMeta, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import type { Session } from "@opencode-ai/sdk/v2"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { TuiKeybind } from "../../../src/config/keybind"
import { OttiliCoderKeymapProvider, registerOttiliCoderKeymap } from "../../../src/keymap"
import { DialogProvider } from "../../../src/ui/dialog"
import { DialogPrompt } from "../../../src/ui/dialog-prompt"
import { ToastProvider } from "../../../src/ui/toast"
import diffViewerPlugin from "../../../src/feature-plugins/system/diff-viewer"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"

type DiffFile = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
  patch?: string
}

const THREE_HUNK_PATCH = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,3 @@
 const first = true
-const oldFirst = true
+const newFirst = true
 const afterFirst = true
@@ -20,3 +20,3 @@
 const second = true
-const oldSecond = true
+const newSecond = true
 const afterSecond = true
@@ -40,3 +40,3 @@
 const third = true
-const oldThird = true
+const newThird = true
 const afterThird = true`

function file(file: string, extra = ""): DiffFile {
  return {
    file,
    additions: 3,
    deletions: 3,
    status: "modified",
    patch: THREE_HUNK_PATCH.replace(/src\/file\.ts/g, file).replace(/const newFirst/g, `const newFirst${extra}`),
  }
}

const session: Session = {
  id: "session-1",
  slug: "session-1",
  projectID: "project-1",
  directory: "/repo/session",
  title: "Session",
  version: "1",
  time: { created: 0, updated: 0 },
} satisfies Session

const startRoute: TuiRouteCurrent = { name: "session", params: { sessionID: "session-1" } }

const pluginMeta: TuiPluginMeta = {
  id: "diff-viewer",
  source: "internal",
  spec: "diff-viewer",
  target: "diff-viewer",
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: "test",
  state: "same",
}

type Viewer = {
  app: Awaited<ReturnType<typeof testRender>>
  commands: Map<string, { run?: (arg: never) => void }>
  current: () => TuiRouteCurrent
  vcsDiffInput: () => unknown
  controls: { resolve: (files: DiffFile[]) => void; reject: (error: unknown) => void }
  toasts: Array<{ title: string; message: string; variant: string }>
  applies: Array<{ directory: string; patch: string }>
}

async function renderDiffViewer(opts: {
  files?: DiffFile[]
  width?: number
  height?: number
  reject?: boolean
  streaming?: boolean
} = {}): Promise<Viewer> {
  const commands = new Map<string, { run?: (arg: never) => void }>()
  let current: TuiRouteCurrent = startRoute
  let renderDiff: ((props: { params?: unknown }) => JSX.Element) | undefined
  let vcsDiffInput: unknown
  const toasts: Array<{ title: string; message: string; variant: string }> = []
  const applies: Array<{ directory: string; patch: string }> = []

  let resolveDiff!: (value: { data: unknown[] }) => void
  let rejectDiff!: (reason: unknown) => void
  const diffPromise = new Promise<{ data: unknown[] }>((resolve, reject) => {
    resolveDiff = resolve
    rejectDiff = reject
  })

  if (!opts.reject && !opts.streaming) resolveDiff({ data: opts.files ?? [] })

  const config = createTuiResolvedConfig()
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const registerLayer = keymap.registerLayer.bind(keymap)
    keymap.registerLayer = (layer) => {
      layer.commands?.forEach((command) => commands.set(command.name, command as never))
      return registerLayer(layer)
    }
    const offKeymap = registerOttiliCoderKeymap(keymap, renderer, config)
    onCleanup(offKeymap)

    const [dialogRender, setDialogRender] = createSignal<(() => JSX.Element) | undefined>(undefined)

    const base = createTuiPluginApi({
      keymap,
      client: {
        vcs: {
          diff: async (input: unknown) => {
            vcsDiffInput = input
            if (opts.reject) return Promise.reject(new Error("boom"))
            return diffPromise
          },
          apply: async (input: { directory: string; patch: string }) => {
            applies.push(input)
            return { error: undefined }
          },
        },
        session: { diff: async () => ({ data: [] }) },
      } as unknown as TuiPluginApi["client"],
      state: { session: { get: () => session } },
    })

    const api = {
      ...base,
      route: {
        register(routes: { name: string; render: (props: { params?: unknown }) => JSX.Element }[]) {
          renderDiff = routes.find((route) => route.name === "diff")?.render
          return () => {}
        },
        navigate(name: string, params?: unknown) {
          current = params ? ({ name, params } as TuiRouteCurrent) : ({ name } as TuiRouteCurrent)
        },
        get current() {
          return current
        },
      },
      ui: {
        ...base.ui,
        dialog: {
          clear: () => setDialogRender(undefined),
          replace: (render: () => JSX.Element) => setDialogRender(() => render),
          setSize: () => {},
          size: "medium" as const,
          depth: 0,
          open: false,
        },
        DialogPrompt: (props: Record<string, unknown>) => <DialogPrompt {...(props as never)} />,
        toast: (options: { title: string; message: string; variant: string }) => {
          toasts.push(options)
          return Promise.resolve()
        },
      },
    } satisfies TuiPluginApi

    void diffViewerPlugin.tui(api, undefined, pluginMeta)
    commands.get("diff.open")?.run?.({} as never)

    return (
      <TestTuiContexts>
        <OttiliCoderKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider>
                <ToastProvider>
                  <DialogProvider>
                    {renderDiff?.({ params: "params" in current ? current.params : undefined })}
                    <Show when={dialogRender()}>{dialogRender()!()}</Show>
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OttiliCoderKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: opts.width ?? 120, height: opts.height ?? 30 })
  await app.renderOnce()
  return {
    app,
    commands,
    current: () => current,
    vcsDiffInput: () => vcsDiffInput,
    controls: { resolve: (files) => resolveDiff({ data: files }), reject: (error) => rejectDiff(error) },
    toasts,
    applies,
  }
}

function findRenderable(root: Renderable, id: string): Renderable | undefined {
  if (root.id === id) return root
  return root
    .getChildren()
    .map((child) => findRenderable(child, id))
    .find(Boolean)
}

function findDiffRenderable(app: Viewer["app"], fileIndex: number): DiffRenderable {
  const node = findRenderable(app.renderer.root, `diff-viewer-patch-${fileIndex}`)
  if (!node) throw new Error(`diff renderable for file ${fileIndex} not found`)
  return node as DiffRenderable
}

async function waitForText(app: Viewer["app"], text: string) {
  await app.waitForFrame((frame) => frame.includes(text))
}

const SAMPLE_FILES = [file("src/alpha.ts"), file("src/beta.ts"), file("src/gamma.ts")]

test("loading state is shown before the diff resolves, then the file list appears", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES, streaming: true })
  try {
    expect(viewer.app.captureCharFrame()).toContain("Loading diff...")
    viewer.controls.resolve(SAMPLE_FILES)
    await waitForText(viewer.app, "src/alpha.ts")
    const frame = viewer.app.captureCharFrame()
    expect(frame).toContain("src/alpha.ts")
    expect(frame).toContain("src/beta.ts")
    expect(frame).toContain("src/gamma.ts")
    expect(frame).toContain("3 files")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("empty diff renders the no-diff state", async () => {
  const viewer = await renderDiffViewer({ files: [] })
  try {
    await waitForText(viewer.app, "No diff!")
    expect(viewer.app.captureCharFrame()).toContain("No diff!")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("vcs failure renders the error state", async () => {
  const viewer = await renderDiffViewer({ reject: true })
  try {
    await waitForText(viewer.app, "Failed to load diff")
    const frame = viewer.app.captureCharFrame()
    expect(frame).toContain("Failed to load diff")
    expect(frame).not.toContain("Loading diff...")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("file list shows file names, change counts and status markers", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    const frame = viewer.app.captureCharFrame()
    expect(frame).toContain("src/alpha.ts")
    expect(frame).toContain("src/beta.ts")
    expect(frame).toContain("src/gamma.ts")
    expect(frame).toContain("+3")
    expect(frame).toContain("-3")
    expect(frame).toContain("M")
    expect(frame).toContain("3 files")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("footer advertises the diff keybindings", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES })
  try {
    await waitForText(viewer.app, "next file")
    const frame = viewer.app.captureCharFrame()
    expect(frame).toContain("next file")
    expect(frame).toContain("next hunk")
    expect(frame).toContain("previous hunk")
    expect(frame).toContain("switch source")
    expect(frame).toContain("mark reviewed")
    expect(frame).toContain("accept hunk")
    expect(frame).toContain("apply accepted")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("narrow terminal uses unified view, wide terminal uses split view", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")], width: 80 })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    expect(findDiffRenderable(viewer.app, 0).view).toBe("unified")
  } finally {
    viewer.app.renderer.destroy()
  }

  const wide = await renderDiffViewer({ files: [file("src/alpha.ts")], width: 140 })
  try {
    await waitForText(wide.app, "src/alpha.ts")
    expect(findDiffRenderable(wide.app, 0).view).toBe("split")
  } finally {
    wide.app.renderer.destroy()
  }
})

test("resizing from narrow to wide switches the diff layout to split", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")], width: 80 })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    expect(findDiffRenderable(viewer.app, 0).view).toBe("unified")
    viewer.app.resize(140, 30)
    await viewer.app.renderOnce()
    expect(findDiffRenderable(viewer.app, 0).view).toBe("split")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("toggle view switches split/unified and is a no-op when split is unavailable", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")], width: 140 })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    expect(findDiffRenderable(viewer.app, 0).view).toBe("split")
    viewer.commands.get("diff.toggle_view")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(findDiffRenderable(viewer.app, 0).view).toBe("unified")
    viewer.commands.get("diff.toggle_view")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(findDiffRenderable(viewer.app, 0).view).toBe("split")
  } finally {
    viewer.app.renderer.destroy()
  }

  const narrow = await renderDiffViewer({ files: [file("src/alpha.ts")], width: 80 })
  try {
    await waitForText(narrow.app, "src/alpha.ts")
    expect(findDiffRenderable(narrow.app, 0).view).toBe("unified")
    narrow.commands.get("diff.toggle_view")!.run?.({} as never)
    await narrow.app.renderOnce()
    expect(findDiffRenderable(narrow.app, 0).view).toBe("unified")
  } finally {
    narrow.app.renderer.destroy()
  }
})

test("syntax highlighting is configured for the diff filetype", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")] })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    const diff = findDiffRenderable(viewer.app, 0)
    expect(diff.filetype).toBe("typescript")
    expect(diff.syntaxStyle).toBeTruthy()
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("toggling the file tree hides and restores the file list", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    expect(viewer.app.captureCharFrame()).toContain("src/alpha.ts")
    viewer.commands.get("diff.toggle_file_tree")!.run?.({} as never)
    await viewer.app.renderOnce()
    const hidden = viewer.app.captureCharFrame()
    expect(hidden).not.toContain("src/alpha.ts")
    viewer.commands.get("diff.toggle_file_tree")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("src/alpha.ts")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("patch navigation scrolls the patch pane", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")], height: 20 })
  try {
    await waitForText(viewer.app, "const first")
    const scroll = findRenderable(viewer.app.renderer.root, "diff-viewer-patches") as ScrollBoxRenderable
    const initial = scroll.scrollTop
    viewer.commands.get("diff.down")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBeGreaterThan(initial)
    const afterDown = scroll.scrollTop
    viewer.commands.get("diff.up")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBeLessThan(afterDown)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("hunk navigation moves between hunks", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")] })
  try {
    await waitForText(viewer.app, "const first")
    const scroll = findRenderable(viewer.app.renderer.root, "diff-viewer-patches") as ScrollBoxRenderable
    const initial = scroll.scrollTop
    viewer.commands.get("diff.next_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBeGreaterThan(initial)
    const first = scroll.scrollTop
    viewer.commands.get("diff.next_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBeGreaterThan(first)
    viewer.commands.get("diff.previous_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(first)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("next and previous file move through files in single patch mode", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES, width: 140 })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    viewer.commands.get("diff.single_patch")!.run?.({} as never)
    await viewer.app.renderOnce()
    let frame = viewer.app.captureCharFrame()
    expect(frame).toContain("src/alpha.ts")
    expect(frame).not.toContain("src/beta.ts")
    viewer.commands.get("diff.next_file")!.run?.({} as never)
    await viewer.app.renderOnce()
    frame = viewer.app.captureCharFrame()
    expect(frame).toContain("src/beta.ts")
    expect(frame).not.toContain("src/alpha.ts")
    viewer.commands.get("diff.previous_file")!.run?.({} as never)
    await viewer.app.renderOnce()
    frame = viewer.app.captureCharFrame()
    expect(frame).toContain("src/alpha.ts")
    expect(frame).not.toContain("src/beta.ts")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("switching focus changes which pane responds to navigation", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")], height: 20 })
  try {
    await waitForText(viewer.app, "const first")
    const scroll = findRenderable(viewer.app.renderer.root, "diff-viewer-patches") as ScrollBoxRenderable
    viewer.commands.get("diff.down")!.run?.({} as never)
    await viewer.app.renderOnce()
    const scrolled = scroll.scrollTop
    expect(scrolled).toBeGreaterThan(0)
    viewer.commands.get("diff.switch_focus")!.run?.({} as never)
    await viewer.app.renderOnce()
    viewer.commands.get("diff.down")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBe(scrolled)
    viewer.commands.get("diff.switch_focus")!.run?.({} as never)
    await viewer.app.renderOnce()
    viewer.commands.get("diff.down")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(scroll.scrollTop).toBeGreaterThan(scrolled)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("accept and reject hunks update the visible decision counters", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES, width: 140 })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    viewer.commands.get("diff.next_file")!.run?.({} as never)
    await viewer.app.renderOnce()
    viewer.commands.get("diff.accept_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("a1")
    viewer.commands.get("diff.reject_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("r1")
    viewer.commands.get("diff.accept_file")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("a3")
    viewer.commands.get("diff.reject_file")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("r3")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("applying accepted hunks invokes the vcs apply client", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")] })
  try {
    await waitForText(viewer.app, "const first")
    viewer.commands.get("diff.accept_hunk")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("a1")
    viewer.commands.get("diff.apply")!.run?.({} as never)
    await viewer.app.waitFor(() => viewer.applies.length > 0)
    expect(viewer.applies).toHaveLength(1)
    expect(viewer.applies[0]!.directory).toBe("/repo/session")
    expect(viewer.applies[0]!.patch).toContain("const newFirst")
    expect(viewer.toasts.some((toast) => toast.title === "Applied")).toBe(true)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("comments can be added through the dialog and toggled", async () => {
  const viewer = await renderDiffViewer({ files: [file("src/alpha.ts")] })
  try {
    await waitForText(viewer.app, "const first")
    viewer.commands.get("diff.add_comment")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("Comment — src/alpha.ts")
    const textarea = viewer.app.renderer.currentFocusedEditor
    if (!(textarea instanceof TextareaRenderable)) throw new Error("expected focused dialog textarea")
    viewer.app.mockInput.typeText("please simplify this")
    viewer.app.mockInput.pressEnter()
    await viewer.app.renderOnce()
    const framed = viewer.app.captureCharFrame()
    expect(framed).toContain("c1")
    expect(framed).toContain("▸ please simplify this")
    viewer.commands.get("diff.toggle_comments")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).not.toContain("▸ please simplify this")
    viewer.commands.get("diff.toggle_comments")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("▸ please simplify this")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("help and switch-source dialogs open from their commands", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    viewer.commands.get("diff.help")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("Diff shortcuts")
    viewer.commands.get("diff.close")!.run?.({} as never)
    await viewer.app.renderOnce()
    viewer.commands.get("diff.switch_source")!.run?.({} as never)
    await viewer.app.renderOnce()
    const frame = viewer.app.captureCharFrame()
    expect(frame).toContain("Working tree")
    expect(frame).toContain("Last turn")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("marking a file reviewed shows the reviewed marker", async () => {
  const viewer = await renderDiffViewer({ files: SAMPLE_FILES })
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    expect(viewer.app.captureCharFrame()).not.toContain("✓")
    viewer.commands.get("diff.mark_reviewed")!.run?.({} as never)
    await viewer.app.renderOnce()
    expect(viewer.app.captureCharFrame()).toContain("✓")
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("closing the diff viewer returns to the originating route", async () => {
  const viewer = await renderDiffViewer(SAMPLE_FILES)
  try {
    await waitForText(viewer.app, "src/alpha.ts")
    expect(viewer.current()).toEqual({
      name: "diff",
      params: { mode: "git", sessionID: "session-1", returnRoute: startRoute },
    })
    viewer.commands.get("diff.close")!.run?.({} as never)
    expect(viewer.current()).toEqual(startRoute)
  } finally {
    viewer.app.renderer.destroy()
  }
})

test("diff keybindings are mapped to their expected keys", () => {
  expect(TuiKeybind.defaultValue("diff_next_hunk")).toBe("]")
  expect(TuiKeybind.defaultValue("diff_previous_hunk")).toBe("[")
  expect(TuiKeybind.defaultValue("diff_next_file")).toBe("n")
  expect(TuiKeybind.defaultValue("diff_previous_file")).toBe("p")
  expect(TuiKeybind.defaultValue("diff_toggle_view")).toBe("v")
  expect(TuiKeybind.defaultValue("diff_toggle_file_tree")).toBe("b")
  expect(TuiKeybind.defaultValue("diff_single_patch")).toBe("s")
  expect(TuiKeybind.defaultValue("diff_switch_focus")).toBe("tab")
  expect(TuiKeybind.defaultValue("diff_switch_source")).toBe("d")
  expect(TuiKeybind.defaultValue("diff_help")).toBe("?")
  expect(TuiKeybind.defaultValue("diff_mark_reviewed")).toBe("m")
  expect(TuiKeybind.defaultValue("diff_accept_hunk")).toBe("a")
  expect(TuiKeybind.defaultValue("diff_reject_hunk")).toBe("r")
  expect(TuiKeybind.defaultValue("diff_accept_file")).toBe("A")
  expect(TuiKeybind.defaultValue("diff_reject_file")).toBe("R")
  expect(TuiKeybind.defaultValue("diff_apply")).toBe("g")
  expect(TuiKeybind.defaultValue("diff_add_comment")).toBe("c")
  expect(TuiKeybind.defaultValue("diff_toggle_comments")).toBe("C")
})
