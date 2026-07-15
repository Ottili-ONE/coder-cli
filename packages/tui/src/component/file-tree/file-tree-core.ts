// Reusable, framework-free file tree model and operations for Ottili Coder.
//
// This generalizes the diff-viewer file tree (see
// ../../feature-plugins/system/diff-viewer-file-tree-utils.ts) into a component
// that any TUI view can adopt: the diff viewer, a repository browser, file
// pickers, and the session file-change dialog. It keeps the proven tree
// algorithm (deduplicated directories, depth-first flatten, unary chain
// collapse) and adds the capabilities the current file tree lacks:
//   - generic version-control status markers (modified / added / deleted / ...)
//   - ignored-file handling (dim + optional hide)
//   - search filtering with ancestor auto-expansion
//   - navigation by item index (not file index), so it works for any item list
//
// No OpenCode-specific imports live here; the palette is supplied by the host
// (the resolved Ottili Theme) and consumed by the presentational component.

import { redactSensitive } from "../agent-roster/model"

// ---------------------------------------------------------------------------
// Lifecycle hardening model
//
// The File tree is rendered in many environments (diff viewer, repo browser,
// pickers, dialogs) that each can be loading, offline, denied, failed, empty,
// partially loaded, large, or fully populated. These helpers classify and
// summarize that lifecycle so the presentational component can render every
// state intentionally and keep the view accessible and within a render budget.
// They are pure and item-shape agnostic: they only need a count and a context.
// ---------------------------------------------------------------------------

/** The eight intentionally-rendered lifecycle states of the File tree. */
export type FileTreeLifecycleStatus =
  | "loading"
  | "offline"
  | "denied"
  | "failure"
  | "empty"
  | "degraded"
  | "long-content"
  | "populated"

/** Environmental context that decides which top-level lifecycle state we are in. */
export interface FileTreeContext {
  loading: boolean
  connected: boolean
  permitted: boolean
  partial: boolean
  error?: string
}

/** Derivable, memoizable File tree view state consumed by the component. */
export interface FileTreeViewState {
  status: FileTreeLifecycleStatus
  context: FileTreeContext
  itemCount: number
  showAll: boolean
  renderBudget: number
  narrowWidth: number
}

/** Default maximum number of rows painted before a "show more" budget hint. */
export const FILE_TREE_RENDER_BUDGET_DEFAULT = 200

/** Terminal width below which the tree collapses to a compact, truncated layout. */
export const FILE_TREE_NARROW_WIDTH_DEFAULT = 60

/** Marker substituted for redacted secrets in visual output and diagnostics. */
export const FILE_TREE_REDACTION_MARKER = "••••"

/** Redact secrets from an error message so it can be shown or logged safely. */
export function redactFileTreeError(message: string): string {
  return redactSensitive(message).text
}

/** A terminal is "narrow" when long paths must be truncated to preserve layout. */
export function isFileTreeNarrow(width: number, threshold = FILE_TREE_NARROW_WIDTH_DEFAULT): boolean {
  return width < threshold
}

/**
 * Classify the File tree's top-level state. Order matters: transient/blocking
 * states win over presentational ones so the user always sees the most
 * actionable message first.
 */
export function deriveFileTreeLifecycleStatus(
  context: FileTreeContext,
  itemCount: number,
  renderBudget: number,
  showAll: boolean,
): FileTreeLifecycleStatus {
  if (context.loading) return "loading"
  if (!context.connected) return "offline"
  if (!context.permitted) return "denied"
  if (context.error) return "failure"
  if (itemCount === 0) return "empty"
  if (context.partial) return "degraded"
  if (!showAll && itemCount > renderBudget) return "long-content"
  return "populated"
}

export function buildFileTreeViewState(
  context: FileTreeContext,
  itemCount: number,
  overrides: { showAll?: boolean; renderBudget?: number; narrowWidth?: number } = {},
): FileTreeViewState {
  const renderBudget = overrides.renderBudget ?? FILE_TREE_RENDER_BUDGET_DEFAULT
  const showAll = overrides.showAll ?? false
  return {
    status: deriveFileTreeLifecycleStatus(context, itemCount, renderBudget, showAll),
    context,
    itemCount,
    showAll,
    renderBudget,
    narrowWidth: overrides.narrowWidth ?? FILE_TREE_NARROW_WIDTH_DEFAULT,
  }
}

/** Count of rows painted when the render budget is applied (0 once expanded). */
export function visibleItemCount(state: FileTreeViewState): number {
  if (state.showAll) return state.itemCount
  return Math.min(state.itemCount, state.renderBudget)
}

/** Count of rows hidden by the render budget (0 once expanded). */
export function hiddenItemCount(state: FileTreeViewState): number {
  if (state.showAll) return 0
  return Math.max(0, state.itemCount - state.renderBudget)
}

/** Single-line summary used as the accessible live-region label and header. */
export function fileTreeSummary(state: FileTreeViewState): string {
  const count = state.itemCount
  switch (state.status) {
    case "loading":
      return "File tree: loading…"
    case "offline":
      return "File tree: offline — unavailable"
    case "denied":
      return "File tree: permission denied"
    case "failure":
      return `File tree: failed to load — ${redactFileTreeError(state.context.error ?? "unknown error")}`
    case "empty":
      return "File tree: No files"
    case "degraded":
      return `File tree: ${count} files (degraded)`
    case "long-content":
      return `File tree: ${count} files (showing ${state.renderBudget})`
    case "populated":
    default:
      return `File tree: ${count} ${count === 1 ? "file" : "files"}`
  }
}

/** Short textual status label, always rendered so state is never color-only. */
export function fileTreeLifecycleLabel(status: FileTreeLifecycleStatus): string {
  switch (status) {
    case "loading":
      return "loading"
    case "offline":
      return "offline"
    case "denied":
      return "denied"
    case "failure":
      return "failed"
    case "empty":
      return "empty"
    case "degraded":
      return "degraded"
    case "long-content":
      return "truncated"
    case "populated":
      return "ready"
  }
}

/** Compact marker for a state; colored glyph when color is available, else a bracket tag. */
export function fileTreeLifecycleGlyph(status: FileTreeLifecycleStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "loading":
        return "…"
      case "offline":
        return "○"
      case "denied":
        return "⊘"
      case "failure":
        return "✗"
      case "empty":
        return "∅"
      case "degraded":
        return "△"
      case "long-content":
        return "▤"
      case "populated":
        return "✓"
    }
  }
  switch (status) {
    case "loading":
      return "[loading]"
    case "offline":
      return "[offline]"
    case "denied":
      return "[denied]"
    case "failure":
      return "[failed]"
    case "empty":
      return "[empty]"
    case "degraded":
      return "[degraded]"
    case "long-content":
      return "[truncated]"
    case "populated":
      return "[ok]"
  }
}

/** Truncate a single name to fit a narrow terminal without dropping its meaning. */
export function truncateFileName(name: string, max: number): string {
  if (name.length <= max) return name
  if (max <= 1) return name.slice(0, Math.max(0, max))
  return name.slice(0, max - 1) + "…"
}

export type FileTreeStatus =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "untracked"
  | "conflict"

export type FileTreeItem = {
  // Posix path relative to the repository root, e.g. "src/config/tui.ts".
  // A trailing slash marks the entry as a directory placeholder.
  readonly path: string
  readonly kind?: "file" | "directory"
  readonly status?: FileTreeStatus
  readonly ignored?: boolean
  readonly staged?: boolean
}

export type FileTreeNode = {
  readonly id: number
  readonly name: string
  // Full path from the repository root to this node (directories joined by "/").
  readonly path: string
  readonly parent: number | undefined
  readonly children: number[]
  readonly depth: number
  readonly kind: "directory" | "file"
  // Index into the source item list for the node that owns this entry.
  readonly itemIndex?: number
  readonly status?: FileTreeStatus
  readonly ignored?: boolean
  readonly staged?: boolean
}

export type FileTree = {
  readonly roots: number[]
  readonly nodes: FileTreeNode[]
}

export type FileTreeRow = {
  readonly id: number
  readonly depth: number
  readonly kind: "directory" | "file"
  readonly name: string
  readonly path: string
  readonly itemIndex?: number
  readonly status?: FileTreeStatus
  readonly ignored?: boolean
  readonly staged?: boolean
}

export type FileTreeFlattenOptions = {
  readonly expanded?: ReadonlySet<number>
  readonly hideIgnored?: boolean
  readonly search?: string
}

export function buildFileTree(items: readonly FileTreeItem[]): FileTree {
  const roots: number[] = []
  const nodes: FileTreeNode[] = []
  const directoryByPath = new Map<string, number>()

  items.forEach((item, itemIndex) => {
    const normalized = item.path.endsWith("/") ? item.path.slice(0, -1) : item.path
    const segments = normalized.split("/").filter(Boolean)
    if (segments.length === 0) return

    const isDirectory = item.kind === "directory" || item.path.endsWith("/")
    const parent = segments
      .slice(0, -1)
      .reduce(
        (state, segment) => {
          const directoryPath = state.path ? `${state.path}/${segment}` : segment
          const existing = directoryByPath.get(directoryPath)
          if (existing !== undefined) return { id: existing, path: directoryPath, depth: state.depth + 1 }

          const id = addFileTreeNode(nodes, roots, {
            name: segment,
            path: directoryPath,
            parent: state.id,
            depth: state.depth,
            kind: "directory",
          })
          directoryByPath.set(directoryPath, id)
          return { id, path: directoryPath, depth: state.depth + 1 }
        },
        { id: undefined as number | undefined, path: "", depth: 0 },
      )

    if (isDirectory) {
      addFileTreeNode(nodes, roots, {
        name: segments[segments.length - 1]!,
        path: normalized,
        parent: parent.id,
        depth: parent.depth,
        kind: "directory",
        itemIndex,
        status: item.status,
        ignored: item.ignored,
        staged: item.staged,
      })
      return
    }

    addFileTreeNode(nodes, roots, {
      name: segments[segments.length - 1]!,
      path: normalized,
      parent: parent.id,
      depth: parent.depth,
      kind: "file",
      itemIndex,
      status: item.status,
      ignored: item.ignored,
      staged: item.staged,
    })
  })

  const tree = { roots, nodes }
  tree.roots.sort((left, right) => compareFileTreeNodes(tree, left, right))
  tree.nodes.forEach((node) => node.children.sort((left, right) => compareFileTreeNodes(tree, left, right)))
  return tree
}

export function flattenFileTree(
  tree: FileTree,
  options: FileTreeFlattenOptions = {},
): FileTreeRow[] {
  const { expanded, hideIgnored = false, search } = options
  const query = search?.trim().toLowerCase()

  if (query) {
    return flattenFileTreeWithSearch(tree, query, hideIgnored)
  }

  const rows: FileTreeRow[] = []
  const visit = (id: number, depth: number) => {
    const node = tree.nodes[id]!
    if (node.kind === "file") {
      if (hideIgnored && node.ignored) return
      rows.push({
        id: node.id,
        depth,
        kind: node.kind,
        name: node.name,
        path: node.path,
        itemIndex: node.itemIndex,
        status: node.status,
        ignored: node.ignored,
        staged: node.staged,
      })
      return
    }

    const chain = collapsedFileTreeDirectoryChain(tree, node.id)
    const last = chain[chain.length - 1]!
    if (!(hideIgnored && node.ignored)) {
      rows.push({
        id: node.id,
        depth,
        kind: node.kind,
        name: chain.map((item) => item.name).join("/"),
        path: node.path,
        itemIndex: node.itemIndex,
        status: node.status,
        ignored: node.ignored,
        staged: node.staged,
      })
    }
    if (!expanded || expanded.has(node.id)) last.children.forEach((child) => visit(child, depth + 1))
  }
  tree.roots.forEach((root) => visit(root, 0))
  return rows
}

function flattenFileTreeWithSearch(tree: FileTree, query: string, hideIgnored: boolean): FileTreeRow[] {
  const matching = new Set<number>()
  tree.nodes.forEach((node) => {
    if (node.kind === "file" && node.path.toLowerCase().includes(query)) matching.add(node.itemIndex!)
  })
  if (matching.size === 0) return []

  const openDirectories = new Set<number>()
  for (const node of tree.nodes) {
    if (node.itemIndex === undefined || !matching.has(node.itemIndex)) continue
    for (let parent = node.parent; parent !== undefined; parent = tree.nodes[parent]?.parent) {
      openDirectories.add(parent)
    }
  }

  const rows: FileTreeRow[] = []
  const visit = (id: number, depth: number) => {
    const node = tree.nodes[id]!
    if (node.kind === "file") {
      if (!matching.has(node.itemIndex!)) return
      if (hideIgnored && node.ignored) return
      rows.push({
        id: node.id,
        depth,
        kind: node.kind,
        name: node.name,
        path: node.path,
        itemIndex: node.itemIndex,
        status: node.status,
        ignored: node.ignored,
        staged: node.staged,
      })
      return
    }

    if (!openDirectories.has(node.id)) return
    const chain = collapsedFileTreeDirectoryChain(tree, node.id)
    const last = chain[chain.length - 1]!
    rows.push({
      id: node.id,
      depth,
      kind: node.kind,
      name: chain.map((item) => item.name).join("/"),
      path: node.path,
      itemIndex: node.itemIndex,
      status: node.status,
      ignored: node.ignored,
      staged: node.staged,
    })
    last.children.forEach((child) => visit(child, depth + 1))
  }
  tree.roots.forEach((root) => visit(root, 0))
  return rows
}

function collapsedFileTreeDirectoryChain(tree: FileTree, id: number): FileTreeNode[] {
  const node = tree.nodes[id]!
  const child = node.children.length === 1 ? tree.nodes[node.children[0]!] : undefined
  if (child?.kind !== "directory") return [node]
  return [node, ...collapsedFileTreeDirectoryChain(tree, child.id)]
}

export function compareFileTreeNodes(tree: FileTree, left: number, right: number) {
  const leftNode = tree.nodes[left]!
  const rightNode = tree.nodes[right]!
  if (leftNode.kind !== rightNode.kind) return leftNode.kind === "directory" ? -1 : 1
  if (leftNode.name < rightNode.name) return -1
  if (leftNode.name > rightNode.name) return 1
  return left - right
}

export function moveFileTreeSelection(rows: readonly FileTreeRow[], selected: number | undefined, offset: number) {
  if (rows.length === 0) return undefined
  const index = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected)
  if (index === -1) return rows[0]!.id
  return rows[Math.max(0, Math.min(rows.length - 1, index + offset))]!.id
}

export function moveFileTreeSelectionToFirstChild(
  rows: readonly FileTreeRow[],
  selected: number | undefined,
) {
  const index = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected)
  const row = index === -1 ? undefined : rows[index]
  if (row?.kind !== "directory") return selected
  const child = rows[index + 1]
  return child && child.depth > row.depth ? child.id : selected
}

export function moveFileTreeSelectionToParent(
  rows: readonly FileTreeRow[],
  selected: number | undefined,
) {
  const index = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected)
  const row = index === -1 ? undefined : rows[index]
  if (!row || row.depth === 0) return selected
  return rows.findLast((item, itemIndex) => itemIndex < index && item.depth < row.depth)?.id ?? selected
}

export function moveFileTreeSelectionToFile(
  rows: readonly FileTreeRow[],
  selected: number | undefined,
  offset: number,
) {
  const fileRows = rows.filter((row) => row.itemIndex !== undefined)
  if (fileRows.length === 0) return undefined
  const selectedIndex = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected)
  if (selectedIndex === -1) return offset < 0 ? fileRows[fileRows.length - 1]!.id : fileRows[0]!.id
  const next =
    offset < 0
      ? fileRows.findLast((row) => rows.findIndex((item) => item.id === row.id) < selectedIndex)
      : fileRows.find((row) => rows.findIndex((item) => item.id === row.id) > selectedIndex)
  return next?.id ?? (offset < 0 ? fileRows[0]!.id : fileRows[fileRows.length - 1]!.id)
}

export function fileTreeItemSelection(tree: FileTree, itemIndex: number) {
  const node = tree.nodes.find((item) => item.kind === "file" && item.itemIndex === itemIndex)
  if (!node) return undefined
  return {
    highlightedNode: node.id,
    expandedNodes: fileTreeParentDirectories(tree, node.id),
  }
}

export function allExpandedFileTreeDirectories(tree: FileTree) {
  return new Set(tree.nodes.filter((node) => node.kind === "directory").map((node) => node.id))
}

export function toggleFileTreeDirectory(
  tree: FileTree,
  expanded: ReadonlySet<number>,
  selected: number | undefined,
) {
  if (selected === undefined || tree.nodes[selected]?.kind !== "directory") return expanded
  const next = new Set(expanded)
  if (next.has(selected)) next.delete(selected)
  else next.add(selected)
  return next
}

export function setFileTreeDirectoryExpanded(
  tree: FileTree,
  expanded: ReadonlySet<number>,
  selected: number | undefined,
  value: boolean,
) {
  if (selected === undefined || tree.nodes[selected]?.kind !== "directory") return expanded
  const next = new Set(expanded)
  if (value) next.add(selected)
  else next.delete(selected)
  return next
}

export function shouldShowFileTree(show: boolean, itemCount: number) {
  return show && itemCount > 0
}

function addFileTreeNode(
  nodes: FileTreeNode[],
  roots: number[],
  input: Omit<FileTreeNode, "id" | "children">,
) {
  const id = nodes.length
  nodes.push({ ...input, id, children: [] })
  if (input.parent === undefined) roots.push(id)
  else nodes[input.parent]!.children.push(id)
  return id
}

function fileTreeParentDirectories(tree: FileTree, id: number) {
  const result = new Set<number>()
  for (let parent = tree.nodes[id]?.parent; parent !== undefined; parent = tree.nodes[parent]?.parent) {
    result.add(parent)
  }
  return result
}

export function fileTreeStatusLetter(status: FileTreeStatus | undefined): string {
  switch (status) {
    case "modified":
      return "M"
    case "added":
      return "A"
    case "deleted":
      return "D"
    case "renamed":
      return "R"
    case "untracked":
      return "U"
    case "conflict":
      return "!"
    default:
      return "?"
  }
}
