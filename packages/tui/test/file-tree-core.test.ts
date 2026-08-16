import { describe, expect, test } from "bun:test"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  buildFileTreeViewState,
  deriveFileTreeLifecycleStatus,
  fileTreeItemSelection,
  fileTreeLifecycleGlyph,
  fileTreeLifecycleLabel,
  fileTreeStatusLetter,
  fileTreeSummary,
  flattenFileTree,
  hiddenItemCount,
  isFileTreeNarrow,
  moveFileTreeSelection,
  moveFileTreeSelectionToFile,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToParent,
  redactFileTreeError,
  setFileTreeDirectoryExpanded,
  shouldShowFileTree,
  toggleFileTreeDirectory,
  truncateFileName,
  visibleItemCount,
  type FileTreeItem,
} from "../src/component/file-tree/file-tree-core"

const file = (path: string, extra: Partial<FileTreeItem> = {}): FileTreeItem => ({
  path,
  status: extra.status,
  ignored: extra.ignored,
  staged: extra.staged,
  kind: extra.kind,
})

describe("reusable file tree core", () => {
  test("builds a nested tree with deduplicated directories and item indexes", () => {
    const tree = buildFileTree([file("src/config/tui.ts"), file("src/config/keybind.ts"), file("src/session/index.ts")])

    expect(tree.nodes.filter((node) => node.kind === "directory" && node.name === "src")).toHaveLength(1)
    expect(tree.nodes.filter((node) => node.kind === "directory" && node.name === "config")).toHaveLength(1)
    expect(tree.nodes.filter((node) => node.kind === "directory" && node.name === "session")).toHaveLength(1)
    expect(
      tree.nodes
        .filter((node) => node.kind === "file")
        .map((node) => ({ name: node.name, itemIndex: node.itemIndex, depth: node.depth })),
    ).toEqual([
      { name: "tui.ts", itemIndex: 0, depth: 2 },
      { name: "keybind.ts", itemIndex: 1, depth: 2 },
      { name: "index.ts", itemIndex: 2, depth: 2 },
    ])
  })

  test("stores vcs status, ignored and staged metadata on file nodes", () => {
    const tree = buildFileTree([
      file("a/added.ts", { status: "added" }),
      file("b/ignored.ts", { ignored: true }),
      file("c/staged.ts", { status: "modified", staged: true }),
    ])

    const added = tree.nodes.find((node) => node.name === "added.ts")!
    expect(added.kind).toBe("file")
    expect(added.status).toBe("added")
    expect(added.staged).toBeUndefined()

    const ignored = tree.nodes.find((node) => node.name === "ignored.ts")!
    expect(ignored.ignored).toBe(true)

    const staged = tree.nodes.find((node) => node.name === "staged.ts")!
    expect(staged.status).toBe("modified")
    expect(staged.staged).toBe(true)
  })

  test("supports explicit directory placeholder entries", () => {
    const tree = buildFileTree([file("src/empty", { kind: "directory" }), file("src/app.ts")])

    const empty = tree.nodes.find((node) => node.name === "empty")!
    expect(empty.kind).toBe("directory")
    expect(empty.path).toBe("src/empty")
  })

  test("sorts directories before files and alphabetically within each group", () => {
    const rows = flattenFileTree(
      buildFileTree([file("z-file.ts"), file("b/file.ts"), file("a/zeta.ts"), file("b/alpha.ts"), file("a/alpha.ts")]),
    )

    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.kind}:${row.name}`)).toEqual([
      "directory:a",
      "  file:alpha.ts",
      "  file:zeta.ts",
      "directory:b",
      "  file:alpha.ts",
      "  file:file.ts",
      "file:z-file.ts",
    ])
  })

  test("sorts root-level files without creating directories", () => {
    const tree = buildFileTree([file("zeta.ts"), file("alpha.ts"), file("beta.ts")])

    expect(tree.nodes.every((node) => node.kind === "file")).toBe(true)
    expect(flattenFileTree(tree).map((row) => row.name)).toEqual(["alpha.ts", "beta.ts", "zeta.ts"])
  })

  test("collapses unary directory chains while flattening", () => {
    const rows = flattenFileTree(
      buildFileTree([file("packages/ottili-coder/src/cli/app.ts"), file("packages/ottili-coder/src/server/server.ts")]),
    )

    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.kind}:${row.name}`)).toEqual([
      "directory:packages/ottili-coder/src",
      "  directory:cli",
      "    file:app.ts",
      "  directory:server",
      "    file:server.ts",
    ])
  })

  test("flattens all-expanded rows depth-first with depths and item references", () => {
    const rows = flattenFileTree(
      buildFileTree([file("src/config/tui.ts"), file("src/config/keybind.ts"), file("README.md")]),
    )

    expect(
      rows.map((row) => ({ name: row.name, kind: row.kind, depth: row.depth, itemIndex: row.itemIndex })),
    ).toEqual([
      { name: "src/config", kind: "directory", depth: 0, itemIndex: undefined },
      { name: "keybind.ts", kind: "file", depth: 1, itemIndex: 1 },
      { name: "tui.ts", kind: "file", depth: 1, itemIndex: 0 },
      { name: "README.md", kind: "file", depth: 0, itemIndex: 2 },
    ])
  })

  test("flattens only expanded directory descendants when expansion is provided", () => {
    const tree = buildFileTree([file("src/config/tui.ts"), file("src/session/index.ts"), file("README.md")])
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!
    const config = tree.nodes.find((node) => node.kind === "directory" && node.name === "config")!

    expect(flattenFileTree(tree, { expanded: new Set() }).map((row) => row.name)).toEqual(["src", "README.md"])
    expect(flattenFileTree(tree, { expanded: new Set([src.id]) }).map((row) => row.name)).toEqual([
      "src",
      "config",
      "session",
      "README.md",
    ])
    expect(flattenFileTree(tree, { expanded: new Set([src.id, config.id]) }).map((row) => row.name)).toEqual([
      "src",
      "config",
      "tui.ts",
      "session",
      "README.md",
    ])
  })

  test("hides ignored files when hideIgnored is set", () => {
    const tree = buildFileTree([file("src/keep.ts"), file("src/ignore.ts", { ignored: true })])
    const visible = flattenFileTree(tree, { hideIgnored: true })
    expect(visible.map((row) => row.name)).toEqual(["src", "keep.ts"])
    const withIgnored = flattenFileTree(tree, { hideIgnored: false })
    expect(withIgnored.map((row) => row.name)).toEqual(["src", "ignore.ts", "keep.ts"])
  })

  test("filters by search query and auto-expands ancestors of matches", () => {
    const tree = buildFileTree([
      file("src/config/tui.ts"),
      file("src/config/keybind.ts"),
      file("src/session/index.ts"),
      file("README.md"),
    ])

    const matches = flattenFileTree(tree, { search: "keybind" })
    expect(matches.map((row) => `${row.kind}:${row.name}`)).toEqual([
      "directory:src/config",
      "file:keybind.ts",
    ])

    const multiple = flattenFileTree(tree, { search: "src" })
    expect(multiple.map((row) => `${row.kind}:${row.name}`)).toEqual([
      "directory:src",
      "directory:config",
      "file:keybind.ts",
      "file:tui.ts",
      "directory:session",
      "file:index.ts",
    ])
  })

  test("returns no rows when the search query matches nothing", () => {
    const tree = buildFileTree([file("src/app.ts")])
    expect(flattenFileTree(tree, { search: "zzz-nope" })).toEqual([])
  })

  test("moves selection across visible rows and clamps to bounds", () => {
    const rows = flattenFileTree(buildFileTree([file("src/config/tui.ts"), file("README.md")]))

    expect(moveFileTreeSelection(rows, undefined, 1)).toBe(rows[0]!.id)
    expect(moveFileTreeSelection(rows, rows[0]!.id, 1)).toBe(rows[1]!.id)
    expect(moveFileTreeSelection(rows, rows[1]!.id, 99)).toBe(rows[rows.length - 1]!.id)
    expect(moveFileTreeSelection(rows, rows[1]!.id, -99)).toBe(rows[0]!.id)
    expect(moveFileTreeSelection([], undefined, 1)).toBeUndefined()
  })

  test("moves directory selection to first visible child", () => {
    const rows = flattenFileTree(buildFileTree([file("src/config/tui.ts"), file("src/session/index.ts")]))
    const src = rows.find((row) => row.kind === "directory" && row.name === "src")!
    const config = rows.find((row) => row.kind === "directory" && row.name === "config")!
    const tui = rows.find((row) => row.name === "tui.ts")!

    expect(moveFileTreeSelectionToFirstChild(rows, src.id)).toBe(config.id)
    expect(moveFileTreeSelectionToFirstChild(rows, tui.id)).toBe(tui.id)
    expect(moveFileTreeSelectionToFirstChild(rows, undefined)).toBeUndefined()
  })

  test("moves file and collapsed directory selection to visible parent", () => {
    const rows = flattenFileTree(
      buildFileTree([file("packages/ottili-coder/src/cli/app.ts"), file("packages/ottili-coder/src/server/server.ts")]),
    )
    const root = rows.find((row) => row.kind === "directory" && row.name === "packages/ottili-coder/src")!
    const cli = rows.find((row) => row.kind === "directory" && row.name === "cli")!
    const app = rows.find((row) => row.name === "app.ts")!

    expect(moveFileTreeSelectionToParent(rows, app.id)).toBe(cli.id)
    expect(moveFileTreeSelectionToParent(rows, cli.id)).toBe(root.id)
    expect(moveFileTreeSelectionToParent(rows, root.id)).toBe(root.id)
    expect(moveFileTreeSelectionToParent(rows, undefined)).toBeUndefined()
  })

  test("moves file selection relative to the highlighted row", () => {
    const rows = flattenFileTree(
      buildFileTree([file("src/config/tui.ts"), file("src/session/index.ts"), file("README.md")]),
    )
    const config = rows.find((row) => row.kind === "directory" && row.name === "config")!
    const session = rows.find((row) => row.kind === "directory" && row.name === "session")!
    const tui = rows.find((row) => row.name === "tui.ts")!
    const index = rows.find((row) => row.name === "index.ts")!
    const readme = rows.find((row) => row.name === "README.md")!

    expect(moveFileTreeSelectionToFile(rows, undefined, 1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, undefined, -1)).toBe(readme.id)
    expect(moveFileTreeSelectionToFile(rows, config.id, 1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, session.id, -1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, tui.id, 1)).toBe(index.id)
    expect(moveFileTreeSelectionToFile(rows, index.id, -1)).toBe(tui.id)
    expect(moveFileTreeSelectionToFile(rows, readme.id, 1)).toBe(readme.id)
  })

  test("selects a file tree node and expands its parents for an item index", () => {
    const tree = buildFileTree([file("src/config/tui.ts"), file("src/session/index.ts"), file("README.md")])
    const selection = fileTreeItemSelection(tree, 1)

    expect(selection?.highlightedNode).toBe(
      tree.nodes.find((node) => node.kind === "file" && node.name === "index.ts")?.id,
    )
    expect([...selection!.expandedNodes].map((id) => tree.nodes[id]!.name)).toEqual(["session", "src"])
    expect(fileTreeItemSelection(tree, 99)).toBeUndefined()
  })

  test("toggles only selected directory expansion", () => {
    const tree = buildFileTree([file("src/config/tui.ts"), file("README.md")])
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!
    const readme = tree.nodes.find((node) => node.kind === "file" && node.name === "README.md")!
    const expanded = allExpandedFileTreeDirectories(tree)

    const collapsed = toggleFileTreeDirectory(tree, expanded, src.id)
    expect(collapsed.has(src.id)).toBe(false)
    expect(flattenFileTree(tree, { expanded: collapsed }).map((row) => row.name)).toEqual(["src/config", "README.md"])

    const reopened = toggleFileTreeDirectory(tree, collapsed, src.id)
    expect(reopened.has(src.id)).toBe(true)

    expect(toggleFileTreeDirectory(tree, reopened, readme.id)).toBe(reopened)
    expect(toggleFileTreeDirectory(tree, reopened, undefined)).toBe(reopened)
  })

  test("sets only selected directory expansion", () => {
    const tree = buildFileTree([file("src/config/tui.ts"), file("README.md")])
    const src = tree.nodes.find((node) => node.kind === "directory" && node.name === "src")!
    const readme = tree.nodes.find((node) => node.kind === "file" && node.name === "README.md")!
    const expanded = allExpandedFileTreeDirectories(tree)

    const collapsed = setFileTreeDirectoryExpanded(tree, expanded, src.id, false)
    expect(collapsed.has(src.id)).toBe(false)

    const reopened = setFileTreeDirectoryExpanded(tree, collapsed, src.id, true)
    expect(reopened.has(src.id)).toBe(true)

    expect(setFileTreeDirectoryExpanded(tree, reopened, readme.id, false)).toBe(reopened)
    expect(setFileTreeDirectoryExpanded(tree, reopened, undefined, false)).toBe(reopened)
  })

  test("shows the file tree only when enabled and items exist", () => {
    expect(shouldShowFileTree(true, 1)).toBe(true)
    expect(shouldShowFileTree(true, 0)).toBe(false)
    expect(shouldShowFileTree(false, 1)).toBe(false)
    expect(shouldShowFileTree(false, 0)).toBe(false)
  })

  test("maps status values to single-character markers", () => {
    expect(fileTreeStatusLetter("modified")).toBe("M")
    expect(fileTreeStatusLetter("added")).toBe("A")
    expect(fileTreeStatusLetter("deleted")).toBe("D")
    expect(fileTreeStatusLetter("renamed")).toBe("R")
    expect(fileTreeStatusLetter("untracked")).toBe("U")
    expect(fileTreeStatusLetter("conflict")).toBe("!")
    expect(fileTreeStatusLetter(undefined)).toBe("?")
  })
})

describe("file tree lifecycle hardening model", () => {
  const online = { loading: false, connected: true, permitted: true, partial: false }

  test("deriveFileTreeLifecycleStatus orders blocking states first", () => {
    expect(deriveFileTreeLifecycleStatus({ ...online, loading: true }, 0, 200, false)).toBe("loading")
    expect(deriveFileTreeLifecycleStatus({ ...online, connected: false }, 0, 200, false)).toBe("offline")
    expect(deriveFileTreeLifecycleStatus({ ...online, permitted: false }, 0, 200, false)).toBe("denied")
    expect(deriveFileTreeLifecycleStatus({ ...online, error: "boom" }, 0, 200, false)).toBe("failure")
    expect(deriveFileTreeLifecycleStatus(online, 0, 200, false)).toBe("empty")
    expect(deriveFileTreeLifecycleStatus({ ...online, partial: true }, 3, 200, false)).toBe("degraded")
    expect(deriveFileTreeLifecycleStatus(online, 500, 200, false)).toBe("long-content")
    expect(deriveFileTreeLifecycleStatus(online, 500, 200, true)).toBe("populated")
    expect(deriveFileTreeLifecycleStatus(online, 3, 200, false)).toBe("populated")
  })

  test("buildFileTreeViewState defaults keep the prior behaviour", () => {
    const state = buildFileTreeViewState(online, 3)
    expect(state.status).toBe("populated")
    expect(state.showAll).toBe(false)
    expect(state.renderBudget).toBe(200)
    expect(state.context.connected).toBe(true)
    expect(state.context.permitted).toBe(true)
  })

  test("visibleItemCount and hiddenItemCount track the render budget", () => {
    const capped = buildFileTreeViewState(online, 500, { renderBudget: 200 })
    expect(visibleItemCount(capped)).toBe(200)
    expect(hiddenItemCount(capped)).toBe(300)
    const expanded = buildFileTreeViewState(online, 500, { renderBudget: 200, showAll: true })
    expect(visibleItemCount(expanded)).toBe(500)
    expect(hiddenItemCount(expanded)).toBe(0)
    const small = buildFileTreeViewState(online, 5, { renderBudget: 200 })
    expect(hiddenItemCount(small)).toBe(0)
  })

  test("fileTreeSummary is semantic per state and redacts on failure", () => {
    expect(fileTreeSummary(buildFileTreeViewState({ ...online, loading: true }, 0))).toBe("File tree: loading…")
    expect(fileTreeSummary(buildFileTreeViewState({ ...online, connected: false }, 0))).toBe(
      "File tree: offline — unavailable",
    )
    expect(fileTreeSummary(buildFileTreeViewState({ ...online, permitted: false }, 0))).toBe(
      "File tree: permission denied",
    )
    const failing = fileTreeSummary(
      buildFileTreeViewState({ ...online, error: "Bearer sk-live-secret-token" }, 0),
    )
    expect(failing).toContain("failed to load")
    expect(failing).not.toContain("sk-live")
    expect(fileTreeSummary(buildFileTreeViewState(online, 0))).toBe("File tree: No files")
    expect(fileTreeSummary(buildFileTreeViewState({ ...online, partial: true }, 3))).toContain("degraded")
    expect(fileTreeSummary(buildFileTreeViewState(online, 500, { renderBudget: 200 }))).toContain("showing 200")
    expect(fileTreeSummary(buildFileTreeViewState(online, 1))).toBe("File tree: 1 file")
    expect(fileTreeSummary(buildFileTreeViewState(online, 2))).toBe("File tree: 2 files")
  })

  test("lifecycle label and glyph never rely on color alone", () => {
    const statuses = ["loading", "offline", "denied", "failure", "empty", "degraded", "long-content", "populated"] as const
    for (const status of statuses) {
      expect(fileTreeLifecycleLabel(status)).toBeTruthy()
      // Color glyphs and no-color bracket tags are both non-empty and distinct enough.
      expect(fileTreeLifecycleGlyph(status, true)).not.toBe(fileTreeLifecycleGlyph(status, false))
    }
  })

  test("no-color glyphs are bracket tags while color glyphs are single symbols", () => {
    expect(fileTreeLifecycleGlyph("populated", false)).toBe("[ok]")
    expect(fileTreeLifecycleGlyph("populated", true)).toBe("✓")
    expect(fileTreeLifecycleGlyph("offline", false)).toBe("[offline]")
  })

  test("redactFileTreeError removes tokens and keys", () => {
    expect(redactFileTreeError("api_key = supersecretvalue123")).toContain("••••")
    expect(redactFileTreeError("Bearer sk-live-abcdefghijklmnop")).not.toContain("sk-live")
    expect(redactFileTreeError("plain message")).toBe("plain message")
  })

  test("isFileTreeNarrow flags narrow terminals past the threshold", () => {
    expect(isFileTreeNarrow(40)).toBe(true)
    expect(isFileTreeNarrow(80)).toBe(false)
    expect(isFileTreeNarrow(40, 30)).toBe(false)
  })

  test("truncateFileName preserves short names and ellipsizes long ones", () => {
    expect(truncateFileName("short", 20)).toBe("short")
    const long = truncateFileName("x".repeat(200), 10)
    expect(long.endsWith("…")).toBe(true)
    expect(long).toHaveLength(10)
  })
})
