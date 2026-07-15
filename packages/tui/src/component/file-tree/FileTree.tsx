/** @jsxImportSource @opentui/solid */
import type { ScrollBoxRenderable } from "@opentui/core"
import type { Theme } from "../../theme"
import { tint } from "../../context/theme"
import { Locale } from "../../util/locale"
import { createEffect, createMemo, For, Match, Switch } from "solid-js"
import {
  buildFileTree,
  fileTreeStatusLetter,
  flattenFileTree,
  type FileTreeItem,
  type FileTreeRow,
  type FileTreeStatus,
} from "./file-tree-core"

const FILE_TREE_STATUS_WIDTH = 2

export type FileTreeProps = {
  readonly width: number
  readonly items: readonly FileTreeItem[]
  readonly loading: boolean
  readonly error: unknown
  readonly theme: Theme
  readonly focused?: boolean
  readonly highlightedNode?: number
  readonly selectedItemIndex?: number
  readonly markedItemIndexes?: ReadonlySet<number>
  readonly expandedNodes?: ReadonlySet<number>
  readonly search?: string
  readonly hideIgnored?: boolean
  readonly onRowClick?: (row: FileTreeRow) => void
}

export function FileTree(props: FileTreeProps) {
  const tree = createMemo(() => buildFileTree(props.items))
  const rows = createMemo(() => flattenFileTree(tree(), {
    expanded: props.expandedNodes,
    hideIgnored: props.hideIgnored,
    search: props.search,
  }))
  let scroll: ScrollBoxRenderable | undefined

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

  return (
    <box border={["left", "right"]} borderColor={props.theme.border} width={props.width}>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <Switch>
          <Match when={props.loading || props.error}>
            <text />
          </Match>
          <Match when={props.items.length === 0}>
            <text fg={props.theme.text}>{props.search ? "No matches" : "No files"}</text>
          </Match>
          <Match when={props.items.length > 0}>
            <For each={rows()}>
              {(row, index) => {
                const highlighted = () => props.focused && props.highlightedNode === row.id
                const selected = () =>
                  row.itemIndex !== undefined && props.selectedItemIndex === row.itemIndex
                const marked = () =>
                  row.itemIndex !== undefined && (props.markedItemIndexes?.has(row.itemIndex) ?? false)
                const prefix = () => fileTreeRowPrefix(rows(), index(), row, props.expandedNodes)
                const status = () => fileTreeRowStatus(row.status, marked())
                const name = () =>
                  Locale.truncate(
                    row.name,
                    Math.max(1, props.width - FILE_TREE_STATUS_WIDTH - prefix().length),
                  )
                return (
                  <box
                    flexDirection="row"
                    width="100%"
                    backgroundColor={highlighted() ? props.theme.primary : undefined}
                    onMouseUp={() => props.onRowClick?.(row)}
                  >
                    <text
                      fg={highlighted() ? props.theme.background : fadedColor()}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {prefix()}
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text
                        fg={
                          highlighted()
                            ? props.theme.background
                            : selected()
                              ? props.theme.primary
                              : marked() || row.kind === "directory" || row.ignored
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
          </Match>
        </Switch>
      </scrollbox>
    </box>
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

function fileTreeRowStatus(status: FileTreeStatus | undefined, marked: boolean) {
  const letter = status === undefined ? " " : fileTreeStatusLetter(status)
  return `${marked ? "✓" : " "}${letter}`.padStart(FILE_TREE_STATUS_WIDTH)
}
