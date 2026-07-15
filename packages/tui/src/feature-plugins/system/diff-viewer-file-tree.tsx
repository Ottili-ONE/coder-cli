/** @jsxImportSource @opentui/solid */
import type { ColorInput, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { Locale } from "../../util/locale"
import { tint } from "../../context/theme"
import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js"
import { buildFileTree, flattenFileTree, type FileTreeItem, type FileTreeRow } from "./diff-viewer-file-tree-utils"
import {
  type FileTreeContext,
  type FileTreeViewState,
  buildFileTreeViewState,
  fileTreeSummary,
  fileTreeLifecycleGlyph,
  hiddenItemCount,
  FILE_TREE_RENDER_BUDGET_DEFAULT,
  FILE_TREE_NARROW_WIDTH_DEFAULT,
} from "../../component/file-tree/file-tree-core"
import { Panel } from "./diff-viewer-ui"

const FILE_TREE_STATUS_WIDTH = 2

export type DiffViewerFileTreeTheme = {
  readonly background: RGBA
  readonly backgroundPanel: ColorInput
  readonly backgroundElement: ColorInput
  readonly primary: ColorInput
  readonly secondary: ColorInput
  readonly selectedListItemText: ColorInput
  readonly text: RGBA
  readonly textMuted: RGBA
  readonly error: ColorInput
}

export type DiffViewerFileTreeProps = {
  readonly width: number
  readonly files: readonly FileTreeItem[]
  readonly loading: boolean
  readonly error: unknown
  readonly theme: DiffViewerFileTreeTheme
  readonly focused?: boolean
  readonly highlightedNode?: number
  readonly selectedFileIndex?: number
  readonly reviewedFileNames?: ReadonlySet<string>
  readonly expandedNodes?: ReadonlySet<number>
  readonly onRowClick?: (row: FileTreeRow) => void
  // Lifecycle hardening knobs. Safe defaults preserve prior behaviour: the tree
  // is online, permitted, fully loaded and capped at the standard render budget.
  readonly connected?: boolean
  readonly permitted?: boolean
  readonly partial?: boolean
  readonly showAll?: boolean
  readonly renderBudget?: number
  readonly narrowWidth?: number
  readonly colorLevel?: number
  readonly onToggleShowAll?: () => void
}

function errorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return String(error)
}

export function DiffViewerFileTree(props: DiffViewerFileTreeProps) {
  const tree = createMemo(() => buildFileTree(props.files))
  const allRows = createMemo(() => flattenFileTree(tree(), props.expandedNodes))
  let scroll: ScrollBoxRenderable | undefined

  const context = (): FileTreeContext => ({
    loading: props.loading,
    connected: props.connected ?? true,
    permitted: props.permitted ?? true,
    partial: props.partial ?? false,
    error: errorMessage(props.error),
  })

  const state = createMemo(() =>
    buildFileTreeViewState(context(), allRows().length, {
      showAll: props.showAll ?? false,
      renderBudget: props.renderBudget ?? FILE_TREE_RENDER_BUDGET_DEFAULT,
      narrowWidth: props.narrowWidth ?? FILE_TREE_NARROW_WIDTH_DEFAULT,
    }),
  )

  // Keep focus reachable: when the highlighted row falls outside the render
  // budget we expand for render so the focused row is never hidden or trapped.
  const renderAll = createMemo(() => {
    if (state().showAll) return true
    const highlight = props.highlightedNode
    if (highlight === undefined) return false
    return !allRows().some((row) => row.id === highlight)
  })

  const rows = createMemo(() => (renderAll() ? allRows() : allRows().slice(0, state().renderBudget)))

  createEffect(() => {
    const node = props.highlightedNode
    if (node === undefined) return
    const selectedIndex = rows().findIndex((row) => row.id === node)
    if (selectedIndex === -1) return
    const scrollSelectedIntoView = () => scrollFileTreeRowIntoView(scroll, selectedIndex)
    scrollSelectedIntoView()
    requestAnimationFrame(scrollSelectedIntoView)
  })

  const fadedColor = () => tint(props.theme.text, props.theme.background, 0.75)
  const useColor = () => (props.colorLevel ?? 3) >= 1

  const statusColor = () =>
    state().status === "failure"
      ? props.theme.error
      : state().status === "offline" || state().status === "denied"
        ? props.theme.textMuted
        : props.theme.textMuted

  return (
    <Panel border="both" width={props.width}>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <Switch>
          <Match when={state().status === "loading"}>
            <FileTreeStatusRow state={state()} useColor={useColor()} color={statusColor()} />
          </Match>
          <Match when={state().status === "offline"}>
            <FileTreeStatusRow state={state()} useColor={useColor()} color={statusColor()} />
          </Match>
          <Match when={state().status === "denied"}>
            <FileTreeStatusRow state={state()} useColor={useColor()} color={statusColor()} />
          </Match>
          <Match when={state().status === "failure"}>
            <FileTreeStatusRow state={state()} useColor={useColor()} color={statusColor()} />
          </Match>
          <Match when={state().status === "empty"}>
            <FileTreeStatusRow state={state()} useColor={useColor()} color={statusColor()} />
          </Match>
          <Match when={state().status === "degraded"}>
            <FileTreeStatusRow state={state()} useColor={useColor()} color={statusColor()} />
            {renderRows()}
          </Match>
          <Match when={state().status === "long-content"}>
            {renderRows()}
            <Show when={!state().showAll && hiddenItemCount(state()) > 0}>
              <text
                id="diff-file-tree-budget"
                fg={props.theme.textMuted}
                wrapMode="none"
                onMouseUp={() => props.onToggleShowAll?.()}
              >
                {`${hiddenItemCount(state())} more — press to reveal`}
              </text>
            </Show>
          </Match>
          <Match when={state().status === "populated"}>{renderRows()}</Match>
        </Switch>
      </scrollbox>
    </Panel>
  )

  function renderRows() {
    return (
      <For each={rows()}>
        {(row, index) => {
          const highlighted = () => props.focused && props.highlightedNode === row.id
          const selected = () => row.fileIndex !== undefined && props.selectedFileIndex === row.fileIndex
          const reviewed = () => {
            const file = row.fileIndex === undefined ? undefined : props.files[row.fileIndex]?.file
            return file !== undefined && (props.reviewedFileNames?.has(file) ?? false)
          }
          // On no-color terminals the highlight/selection is conveyed by a text
          // marker, never by color alone, so focus is never invisible.
          const focusMarker = () => (highlighted() && !useColor() ? "› " : "")
          const selectMarker = () => (!highlighted() && selected() && !useColor() ? "● " : "")
          const leading = () => focusMarker() + selectMarker()
          const prefix = () => fileTreeRowPrefix(rows(), index(), row, props.expandedNodes)
          const status = () => fileTreeRowStatus(row, props.files, reviewed())
          const name = () =>
            Locale.truncate(
              leading() + row.name,
              Math.max(1, props.width - FILE_TREE_STATUS_WIDTH - prefix().length - leading().length),
            )
          return (
            <box
              flexDirection="row"
              width="100%"
              backgroundColor={highlighted() && useColor() ? props.theme.primary : undefined}
              onMouseUp={() => props.onRowClick?.(row)}
            >
              <text fg={highlighted() ? props.theme.background : fadedColor()} wrapMode="none" flexShrink={0}>
                {prefix()}
              </text>
              <box flexGrow={1} minWidth={0}>
                <text
                  fg={
                    highlighted()
                      ? props.theme.background
                      : selected()
                        ? props.theme.primary
                        : reviewed() || row.kind === "directory"
                          ? props.theme.textMuted
                          : props.theme.text
                  }
                  wrapMode="none"
                >
                  {name()}
                </text>
              </box>
              <text
                fg={highlighted() ? props.theme.background : props.theme.textMuted}
                wrapMode="none"
                flexShrink={0}
              >
                {status()}
              </text>
            </box>
          )
        }}
      </For>
    )
  }
}

function FileTreeStatusRow(props: { state: FileTreeViewState; useColor: boolean; color: ColorInput }) {
  return (
    <text id="diff-file-tree-status" live fg={props.color} wrapMode="none">
      {`${fileTreeLifecycleGlyph(props.state.status, props.useColor)} ${fileTreeSummary(props.state)}`}
    </text>
  )
}

function scrollFileTreeRowIntoView(scroll: ScrollBoxRenderable | undefined, index: number) {
  if (!scroll) return
  if (index < scroll.scrollTop) {
    scroll.scrollTo(index)
    return
  }
  if (index >= scroll.scrollTop + scroll.viewport.height) {
    scroll.scrollTo(index - scroll.viewport.height + 1)
  }
}

function fileTreeRowPrefix(
  rows: readonly FileTreeRow[],
  index: number,
  row: FileTreeRow,
  expandedNodes: ReadonlySet<number> | undefined,
) {
  const indentation = Array.from({ length: row.depth }, (_, depth) => {
    if (depth === 0 && !hasLaterSibling(rows, 0, 0)) return " "
    return hasLaterSibling(rows, index, depth) ? "│  " : "   "
  }).join("")
  const topRoot = index === 0 && row.depth === 0
  const branch = topRoot ? " " : hasLaterSibling(rows, index, row.depth) ? "├─ " : "└─ "
  const marker = row.kind === "directory" ? (expandedNodes && !expandedNodes.has(row.id) ? "▸ " : "▾ ") : ""

  return `${indentation}${branch}${marker}`
}

function hasLaterSibling(rows: readonly FileTreeRow[], index: number, depth: number) {
  return rows.slice(index + 1).find((row) => row.depth <= depth)?.depth === depth
}

function fileTreeRowStatus(row: FileTreeRow, files: readonly FileTreeItem[], reviewed: boolean) {
  if (row.fileIndex === undefined) return ""
  const status = files[row.fileIndex]?.status
  const marker = status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : "?"
  return `${reviewed ? "✓" : " "}${marker}`.padStart(FILE_TREE_STATUS_WIDTH)
}
