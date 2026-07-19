/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { ConflictPreview } from "./preview"
import { ConflictFileFilter } from "./filter"
import {
  type ConflictAction,
  type ConflictContext,
  type ConflictFile,
  type ConflictSide,
  type ConflictType,
  NARROW_WIDTH_DEFAULT,
  abortAction,
  conflictResolutionState,
  continueAction,
  filterFiles,
  moveFocus,
  previewFocusTab,
  resolutionBadge,
  selectAction,
  togglePreview,
} from "./model"

const DETAIL_WIDTH = 80

export interface ConflictResolutionViewProps {
  files: Accessor<ReadonlyArray<ConflictFile>>
  operation?: Accessor<ConflictType> | ConflictType
  loading?: Accessor<boolean>
  error?: Accessor<string | undefined>
  narrowWidth?: number
  onAction?: (action: ConflictAction) => void
  onRefresh?: () => void
}

function resolveValue<T>(value: T | Accessor<T> | undefined, fallback: T): T {
  if (value === undefined) return fallback
  return typeof value === "function" ? (value as Accessor<T>)() : value
}

export function ConflictResolutionView(props: ConflictResolutionViewProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const height = () => dims().height
  const narrowWidth = () => props.narrowWidth ?? NARROW_WIDTH_DEFAULT

  const [resolutions, setResolutions] = createSignal<Record<string, ConflictSide>>({})
  const [focusIndex, setFocusIndex] = createSignal(0)
  const [previewOpen, setPreviewOpen] = createSignal(false)
  const [previewFileIndex, setPreviewFileIndex] = createSignal(-1)
  const [previewFocus, setPreviewFocus] = createSignal<"list" | "regions">("list")
  const [filterQuery, setFilterQuery] = createSignal("")
  const [filterActive, setFilterActive] = createSignal(false)

  const ctx = (): ConflictContext => ({
    loading: resolveValue(props.loading, false),
    error: props.error ? props.error() : undefined,
  })

  const operation = () => resolveValue(props.operation, props.files()[0]?.type ?? "unknown")

  const resolvedFiles = createMemo<ConflictFile[]>(() => {
    const overrides = resolutions()
    return props.files().map((f) => (overrides[f.path] ? { ...f, resolution: overrides[f.path] } : f))
  })

  const filteredView = createMemo<ReadonlyArray<ConflictFile>>(() => {
    const q = filterQuery()
    return q ? filterFiles(resolvedFiles(), q) : resolvedFiles()
  })

  const state = createMemo(() =>
    conflictResolutionState(resolvedFiles(), ctx(), {
      focusIndex: focusIndex(),
      width: width(),
      narrowWidth: narrowWidth(),
      operation: operation(),
      filterQuery: filterQuery(),
      previewOpen: previewOpen(),
      previewFileIndex: previewFileIndex(),
      previewFocus: previewFocus(),
    }),
  )

  const showDetail = () => width() >= DETAIL_WIDTH && !state().narrow
  const displayFiles = () => filteredView()
  const hasFilterQuery = () => filterQuery() !== ""

  function applySide(side: ConflictSide) {
    const f = displayFiles()[focusIndex()]
    if (!f) return
    setResolutions({ ...resolutions(), [f.path]: side })
  }

  function handleFilterKey(event: { name: string }) {
    if (event.name === "escape") { setFilterQuery(""); setFilterActive(false); return }
    if (event.name === "return" || event.name === "enter") { handleFilterSubmit(filterQuery()); return }
    if (event.name === "backspace") { setFilterQuery((q) => q.slice(0, -1)); return }
    if (event.name.length === 1) { setFilterQuery((q) => q + event.name) }
  }

  function openPreviewForFocused() {
    const f = displayFiles()[focusIndex()]
    if (!f) return
    const idx = resolvedFiles().findIndex((x) => x.path === f.path)
    if (idx >= 0) { setPreviewFileIndex(idx); setPreviewOpen(true); setPreviewFocus("list") }
  }

  function handleListKey(event: { name: string; shift?: boolean }) {
    switch (event.name) {
      case "up": case "left": case "k": setFocusIndex(moveFocus(state(), -1)); break
      case "down": case "right": case "j": setFocusIndex(moveFocus(state(), 1)); break
      case "o": if (!event.shift) applySide("ours"); break
      case "t": if (!event.shift) applySide("theirs"); break
      case "u": if (!event.shift) applySide("union"); break
      case "m": applySide("manual"); break
      case "return": case "enter": openPreviewForFocused(); break
      case "d": if (previewOpen()) setPreviewOpen(false); else openPreviewForFocused(); break
      case "c": props.onAction?.(continueAction(state().allResolved, state().unresolved)); break
      case "a": props.onAction?.(abortAction()); break
      case "r": props.onRefresh?.(); break
      case "Slash": case "/": setFilterActive(true); break
      case "escape":
        if (filterActive()) { setFilterQuery(""); setFilterActive(false) }
        else if (previewOpen()) setPreviewOpen(false)
        break
      case "tab": if (previewOpen()) setPreviewFocus(previewFocusTab(state())); break
    }
  }

  function handleRegionKey(event: { name: string }) {
    if (event.name === "escape" || event.name === "tab") setPreviewFocus("list")
  }

  useKeyboard((event) => {
    if (filterActive()) handleFilterKey(event)
    else if (previewOpen() && previewFocus() === "regions") handleRegionKey(event)
    else handleListKey(event)
  })

  function handleFilterClear() { setFilterQuery(""); setFilterActive(false) }

  function handleFilterSubmit(query: string) {
    setFilterQuery(query); setFilterActive(false)
    const list = query ? filterFiles(resolvedFiles(), query) : resolvedFiles()
    if (list.length > 0) {
      const idx = resolvedFiles().findIndex((f) => f.path === list[0].path)
      if (idx >= 0) setFocusIndex(idx)
    }
  }

  const getFileText = (file: ConflictFile, index: number): string => {
    const isFocused = index === focusIndex()
    const prefix = isFocused ? "> " : "  "
    const icon = file.resolution ? "  " : "⚠ "
    const sep = state().narrow ? "" : "  "
    const badge = resolutionBadge(file)
    let detail = ""
    if (showDetail()) {
      if (file.resolution === "manual" && file.content) detail = "  ✎ edited"
      else if (file.binary) detail = "  binary"
      else if (file.resolution) {
        const parts: string[] = []
        if (file.additions) parts.push(`+${file.additions}`)
        if (file.deletions) parts.push(`-${file.deletions}`)
        if (parts.length) detail = `  ${parts.join(" ")}`
      } else {
        const regions = file.conflictRegions ?? 0
        if (regions > 0) detail = `  <<<<<<< ${regions} conflict region${regions === 1 ? "" : "s"}`
      }
    }
    return `${prefix}${icon}${file.path}${sep}${badge}${detail}`
  }

  return (
    <box id="conflict-resolution" flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text id="conflict-header" fg={theme.text} attributes={TextAttributes.BOLD}>
          {state().summaryText}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onAction?.(abortAction())}>
          esc
        </text>
      </box>

      <Show when={filterActive()}>
        <ConflictFileFilter
          query={filterQuery()}
          onChange={setFilterQuery}
          onClear={handleFilterClear}
          onSubmit={handleFilterSubmit}
          resultCount={displayFiles().length}
        />
      </Show>

      <Show when={state().status === "error"} fallback={
        <Show when={state().files.length > 0} fallback={
          <text id="conflict-empty" fg={theme.textMuted} wrapMode="word">
            No conflicts to resolve.
          </text>
        }>
          {/* Render "no matches" or the file list */}
          <Show when={displayFiles().length === 0 && hasFilterQuery()}>
            <text id="conflict-filter-empty" fg={theme.textMuted} wrapMode="word">
              No matching conflicts.
            </text>
          </Show>
          <Show when={displayFiles().length > 0 || !hasFilterQuery()}>
            <box id="conflict-list" flexDirection="column" gap={0}>
              <For each={displayFiles()}>
                {(file, index) => (
                  <text
                    id={`conflict-file-${file.path}`}
                    fg={file.resolution ? theme.success : index() === focusIndex() ? theme.primary : theme.text}
                  >
                    {getFileText(file, index())}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </Show>
      }>
        <box id="conflict-error" flexDirection="column" gap={1}>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>Resolution failed</text>
          <text fg={theme.textMuted} wrapMode="word">{state().summaryText}</text>
        </box>
      </Show>

      <Show when={previewOpen() && previewFileIndex() >= 0 && previewFileIndex() < resolvedFiles().length}>
        <ConflictPreview
          file={resolvedFiles()[previewFileIndex()]}
          focusRegion={0}
          width={width()}
          height={Math.max(5, Math.floor(height() * 0.35))}
          focusZone={previewFocus()}
          onAction={(action) => {
            if (action.type === "accept" && action.side) {
              const file = resolvedFiles()[previewFileIndex()]
              if (file) setResolutions({ ...resolutions(), [file.path]: action.side })
            } else if (action.type === "close") setPreviewOpen(false)
            else if (action.type === "focus-list") setPreviewFocus("list")
          }}
        />
      </Show>

      <Show when={state().status !== "error"}>
        <box id="conflict-actions" flexDirection="row" gap={1} flexWrap="wrap">
          <text fg={theme.textMuted}>[o]urs [t]heirs [u]nion [m]anual</text>
          <text fg={state().allResolved ? theme.success : theme.textMuted}>[c]ontinue</text>
          <text fg={theme.warning}>[a]bort</text>
          <Show when={state().stale}>
            <text fg={theme.textMuted}>⟳ scanning…</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

export default ConflictResolutionView