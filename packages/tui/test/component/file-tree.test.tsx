/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { describe, expect, test as bunTest } from "bun:test"
import { testRender, type JSX } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { FileTree } from "../../src/component/file-tree/FileTree"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  type FileTreeItem,
} from "../../src/component/file-tree/file-tree-core"
import { DEFAULT_THEMES, resolveTheme, type Theme } from "../../src/theme"

// The FileTree uses requestAnimationFrame for scroll-into-view; guarantee it
// exists in the test runtime so focused/highlighted renders behave like the TUI.
if (typeof (globalThis as Record<string, unknown>).requestAnimationFrame !== "function") {
  ;(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(0), 0) as unknown as number
}

const theme: Theme = resolveTheme(DEFAULT_THEMES.ottiliCoder, "dark")

function item(path: string, extra: Partial<FileTreeItem> = {}): FileTreeItem {
  return { path, kind: extra.kind, status: extra.status, ignored: extra.ignored, staged: extra.staged }
}

type FileTreeState = {
  items: Accessor<FileTreeItem[]>
  setItems: (value: FileTreeItem[]) => void
  loading: Accessor<boolean>
  setLoading: (value: boolean) => void
  error: Accessor<unknown>
  setError: (value: unknown) => void
  focused: Accessor<boolean>
  setFocused: (value: boolean) => void
  highlighted: Accessor<number | undefined>
  setHighlighted: (value: number | undefined) => void
  selected: Accessor<number | undefined>
  setSelected: (value: number | undefined) => void
  marked: Accessor<ReadonlySet<number>>
  setMarked: (value: ReadonlySet<number>) => void
  expanded: Accessor<ReadonlySet<number>>
  setExpanded: (value: ReadonlySet<number>) => void
  search: Accessor<string | undefined>
  setSearch: (value: string | undefined) => void
  hideIgnored: Accessor<boolean | undefined>
  setHideIgnored: (value: boolean | undefined) => void
  width: Accessor<number>
  setWidth: (value: number) => void
}

function createFileTreeState(
  initial: Partial<Omit<FileTreeState, "setItems" | "setLoading" | "setError" | "setFocused" | "setHighlighted" | "setSelected" | "setMarked" | "setExpanded" | "setSearch" | "setHideIgnored" | "setWidth">> = {},
) {
  const [items, setItems] = createSignal<FileTreeItem[]>(initial.items?.() ?? [])
  const [loading, setLoading] = createSignal(initial.loading?.() ?? false)
  const [error, setError] = createSignal<unknown>(initial.error?.() ?? undefined)
  const [focused, setFocused] = createSignal(initial.focused?.() ?? false)
  const [highlighted, setHighlighted] = createSignal<number | undefined>(initial.highlighted?.() ?? undefined)
  const [selected, setSelected] = createSignal<number | undefined>(initial.selected?.() ?? undefined)
  const [marked, setMarked] = createSignal<ReadonlySet<number>>(initial.marked?.() ?? new Set())
  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(initial.expanded?.() ?? new Set())
  const [search, setSearch] = createSignal<string | undefined>(initial.search?.() ?? undefined)
  const [hideIgnored, setHideIgnored] = createSignal<boolean | undefined>(initial.hideIgnored?.() ?? undefined)
  const [width, setWidth] = createSignal(initial.width?.() ?? 120)
  return {
    items, setItems, loading, setLoading, error, setError, focused, setFocused, highlighted,
    setHighlighted, selected, setSelected, marked, setMarked, expanded, setExpanded, search, setSearch,
    hideIgnored, setHideIgnored, width, setWidth,
  }
}

async function renderFileTree(state: FileTreeState) {
  const app = await testRender(
    () => (
      // Full-height background wrapper so every render repaints the whole
      // viewport; otherwise empty/loading states leave stale rows behind.
      <box width={state.width()} height={40} backgroundColor={theme.background}>
        <FileTree
          width={state.width()}
          items={state.items()}
          loading={state.loading()}
          error={state.error()}
          theme={theme}
          focused={state.focused()}
          highlightedNode={state.highlighted()}
          selectedItemIndex={state.selected()}
          markedItemIndexes={state.marked()}
          expandedNodes={state.expanded()}
          search={state.search()}
          hideIgnored={state.hideIgnored()}
        />
      </box>
    ),
    { width: state.width(), height: 40 },
  )
  await app.renderOnce()
  return app
}

function firstFileNodeId(items: readonly FileTreeItem[], name: string) {
  const tree = buildFileTree(items)
  return tree.nodes.find((node) => node.kind === "file" && node.name === name)!.id
}

function sameColor(a: RGBA, b: RGBA) {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}

// The opentui test renderer shares a single native frame buffer, so concurrent
// tests within a file collide on capture. Serialize every test through one chain
// so only one FileTree render/capture is live at a time (stable, no sleeps).
const serial = { chain: Promise.resolve() as Promise<unknown> }
function isolated(name: string, fn: () => Promise<void>) {
  bunTest(name, async () => {
    const run = serial.chain.catch(() => {}).then(fn)
    serial.chain = run.catch(() => {})
    return run
  })
}

function visibleLines(frame: string) {
  return frame
    .split("\n")
    .map((line) => line.replace(/^│\s?/, "").replace(/\s*│$/, "").trimEnd())
    .filter(Boolean)
}

describe("FileTree redesigned component", () => {
  isolated("renders repository navigation as a collapsed, sorted tree", async () => {
    const items = [
      item("src/config/tui.ts"),
      item("src/config/keybind.ts"),
      item("src/session/index.ts"),
      item("README.md"),
    ]
    const state = createFileTreeState({ items: () => items, expanded: () => allExpandedFileTreeDirectories(buildFileTree(items)) })
    const app = await renderFileTree(state)
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("src/config")
      expect(frame).toContain("keybind.ts")
      expect(frame).toContain("index.ts")
      expect(frame).toContain("README.md")
      expect(frame).toContain("▾")

      const lines = visibleLines(frame)
      expect(lines.indexOf("src/config")).toBeLessThan(lines.indexOf("keybind.ts"))
      expect(lines.indexOf("keybind.ts")).toBeLessThan(lines.indexOf("tui.ts"))
      expect(lines.indexOf("README.md")).toBeGreaterThanOrEqual(0)
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("renders version-control status markers on rows", async () => {
    const items = [
      item("src/added.ts", { status: "added" }),
      item("src/modified.ts", { status: "modified" }),
      item("src/deleted.ts", { status: "deleted" }),
      item("src/renamed.ts", { status: "renamed" }),
      item("src/plain.ts"),
    ]
    const state = createFileTreeState({ items: () => items, expanded: () => allExpandedFileTreeDirectories(buildFileTree(items)) })
    const app = await renderFileTree(state)
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain(" A")
      expect(frame).toContain(" M")
      expect(frame).toContain(" D")
      expect(frame).toContain(" R")
      // Unmodified files carry no status letter (the column renders blank).
      expect(frame).toContain("plain.ts")
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("dims ignored files and hides them when hideIgnored is set", async () => {
    const items = [item("src/keep.ts"), item("src/ignore.ts", { ignored: true })]
    const tree = buildFileTree(items)

    const shown = createFileTreeState({ items: () => items, expanded: () => allExpandedFileTreeDirectories(tree), hideIgnored: () => false })
    const shownApp = await renderFileTree(shown)
    try {
      const frame = shownApp.captureCharFrame()
      expect(frame).toContain("keep.ts")
      expect(frame).toContain("ignore.ts")
    } finally {
      shownApp.renderer.destroy()
    }

    const hidden = createFileTreeState({ items: () => items, expanded: () => allExpandedFileTreeDirectories(tree), hideIgnored: () => true })
    const hiddenApp = await renderFileTree(hidden)
    try {
      const frame = hiddenApp.captureCharFrame()
      expect(frame).toContain("keep.ts")
      expect(frame).not.toContain("ignore.ts")
    } finally {
      hiddenApp.renderer.destroy()
    }
  })

  isolated("filters by search query and auto-expands ancestor directories", async () => {
    const items = [
      item("src/config/tui.ts"),
      item("src/config/keybind.ts"),
      item("src/session/index.ts"),
      item("README.md"),
    ]
    const state = createFileTreeState({ items: () => items, search: () => "keybind" })
    const app = await renderFileTree(state)
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("src/config")
      expect(frame).toContain("keybind.ts")
      expect(frame).not.toContain("tui.ts")
      expect(frame).not.toContain("index.ts")
      expect(frame).not.toContain("README.md")
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("shows 'No matches' for an empty search result", async () => {
    const items = [item("src/app.ts")]
    const state = createFileTreeState({ items: () => items, search: () => "zzz-nope" })
    const app = await renderFileTree(state)
    try {
      expect(app.captureCharFrame()).toContain("No matches")
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("focus highlight marks the active row with the primary background", async () => {
    const items = [item("src/config/tui.ts"), item("src/config/keybind.ts")]
    const tree = buildFileTree(items)
    const expanded = allExpandedFileTreeDirectories(tree)
    const targetId = firstFileNodeId(items, "tui.ts")

    const focused = createFileTreeState({
      items: () => items,
      expanded: () => expanded,
      focused: () => true,
      highlighted: () => targetId,
    })
    const focusedApp = await renderFileTree(focused)
    try {
      const spans = focusedApp.captureSpans()
      const line = spans.lines.find((row) => row.spans.some((span) => span.text.includes("tui.ts")))
      expect(line).toBeDefined()
      const highlightSpan = line!.spans.find((span) => sameColor(span.bg, theme.primary))
      expect(highlightSpan).toBeDefined()
      expect(highlightSpan!.text).toContain("tui.ts")
    } finally {
      focusedApp.renderer.destroy()
    }

    const unfocused = createFileTreeState({
      items: () => items,
      expanded: () => expanded,
      focused: () => false,
      highlighted: () => targetId,
    })
    const unfocusedApp = await renderFileTree(unfocused)
    try {
      const spans = unfocusedApp.captureSpans()
      const line = spans.lines.find((row) => row.spans.some((span) => span.text.includes("tui.ts")))
      expect(line).toBeDefined()
      const highlightSpan = line!.spans.find((span) => sameColor(span.bg, theme.primary))
      expect(highlightSpan).toBeUndefined()
    } finally {
      unfocusedApp.renderer.destroy()
    }
  })

  isolated("resize: keeps full names on standard width and truncates on narrow width", async () => {
    const items = [item("src/components/very-long-file-name-that-exceeds.tsx")]
    const tree = buildFileTree(items)
    const expanded = allExpandedFileTreeDirectories(tree)

    const wide = createFileTreeState({ items: () => items, expanded: () => expanded, width: () => 120 })
    const wideApp = await renderFileTree(wide)
    try {
      const frame = wideApp.captureCharFrame()
      expect(frame).toContain("very-long-file-name-that-exceeds.tsx")
      expect(frame).not.toContain("…")
      expect(Math.max(...frame.split("\n").map((line) => line.length))).toBeLessThanOrEqual(120)
    } finally {
      wideApp.renderer.destroy()
    }

    const narrow = createFileTreeState({ items: () => items, expanded: () => expanded, width: () => 24 })
    const narrowApp = await renderFileTree(narrow)
    try {
      const frame = narrowApp.captureCharFrame()
      expect(frame).toContain("…")
      expect(frame).not.toContain("very-long-file-name-that-exceeds.tsx")
      expect(Math.max(...frame.split("\n").map((line) => line.length))).toBeLessThanOrEqual(24)
    } finally {
      narrowApp.renderer.destroy()
    }
  })

  isolated("resize mid-session re-lays out without losing rows", async () => {
    const items = [item("src/components/very-long-file-name-that-exceeds.tsx")]
    const tree = buildFileTree(items)
    const state = createFileTreeState({
      items: () => items,
      expanded: () => allExpandedFileTreeDirectories(tree),
      width: () => 120,
    })
    const app = await renderFileTree(state)
    try {
      const before = app.captureCharFrame()
      expect(before).toContain("very-long-file-name-that-exceeds.tsx")

      app.resize(24, 40)
      await app.flush()
      const after = app.captureCharFrame()
      expect(after).toContain("…")
      expect(after).not.toContain("very-long-file-name-that-exceeds.tsx")
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("streaming: quiet while loading, then renders files when data arrives", async () => {
    const items = [item("src/config/tui.ts"), item("src/session/index.ts")]
    const state = createFileTreeState({ items: () => [], loading: () => true })
    const app = await renderFileTree(state)
    try {
      const loadingFrame = app.captureCharFrame()
      expect(loadingFrame).not.toContain("tui.ts")
      expect(loadingFrame).not.toContain("No files")

      state.setLoading(false)
      state.setItems(items)
      await app.flush()
      const populated = app.captureCharFrame()
      expect(populated).toContain("tui.ts")
      expect(populated).toContain("index.ts")
      expect(populated).toContain("src/config")
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("empty state shows 'No files' without items, loading or error", async () => {
    const state = createFileTreeState({ items: () => [] })
    const app = await renderFileTree(state)
    try {
      expect(app.captureCharFrame()).toContain("No files")
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("failure path: error renders quietly and recovers to populated on retry", async () => {
    const items = [item("src/config/tui.ts")]
    const tree = buildFileTree(items)
    const state = createFileTreeState({ items: () => [], error: () => new Error("failed to list repository") })
    const app = await renderFileTree(state)
    try {
      const failedFrame = app.captureCharFrame()
      // The failure path is quiet: no rows, no "No files" label, no crash.
      expect(failedFrame).not.toContain("tui.ts")
      expect(failedFrame).not.toContain("No files")

      state.setError(undefined)
      state.setItems(items)
      await app.flush()
      const recovered = app.captureCharFrame()
      expect(recovered).toContain("tui.ts")
      expect(recovered).toContain("src/config")
    } finally {
      app.renderer.destroy()
    }
  })

  isolated("markers and selected file styling are independent of focus", async () => {
    const items = [item("src/config/tui.ts", { status: "modified" }), item("src/session/index.ts")]
    const tree = buildFileTree(items)
    const expanded = allExpandedFileTreeDirectories(tree)
    const tuiItemIndex = items.findIndex((entry) => entry.path === "src/config/tui.ts")

    const state = createFileTreeState({
      items: () => items,
      expanded: () => expanded,
      marked: () => new Set<number>([tuiItemIndex]),
      selected: () => tuiItemIndex,
    })
    const app = await renderFileTree(state)
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("✓M")
      expect(frame).toContain("index.ts")
      expect(frame).toContain("tui.ts")
    } finally {
      app.renderer.destroy()
    }
  })
})
