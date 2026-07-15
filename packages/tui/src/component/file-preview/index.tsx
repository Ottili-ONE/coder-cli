/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import {
  type FilePreviewContext,
  type FilePreviewLine,
  type FilePreviewStatus,
  NARROW_WIDTH_DEFAULT,
  PREVIEW_HEAD_DEFAULT,
  PREVIEW_MAX_LINES_DEFAULT,
  PREVIEW_TAIL_DEFAULT,
  buildPreviewLine,
  buildState,
  effectiveSelection,
  filePreviewSummary,
  isNarrow,
  moveSelection,
  redactMessage,
  truncateLine,
  visibleLines,
} from "./model"

export interface FilePreviewProps {
  /** Path or label of the file being previewed (used in the accessible summary). */
  path?: string
  /** Raw file lines. New entries are appended as the content streams in. */
  content: Accessor<string[]>
  /** Whether the content is still being read/streamed. */
  loading?: Accessor<boolean>
  /** A read failure reason; present => the failure path is rendered. */
  failure?: Accessor<string | undefined>
  /** Access was refused by the filesystem/permission layer. */
  denied?: Accessor<boolean>
  /** The source is unreachable (host offline / remote fetch failed). */
  offline?: Accessor<boolean>
  /** Content is shown at reduced fidelity (binary / limited-color terminal). */
  degraded?: Accessor<boolean>
  /** Human-readable reason the preview is degraded. */
  degradedReason?: Accessor<string | undefined>
  /** Head/tail fold budget. */
  headLines?: number
  tailLines?: number
  /** Terminal width below which lines are truncated. */
  narrowWidth?: number
  /** Initial fold state. */
  folded?: boolean
  /** Fired with the focused line text when the user copies it. */
  onCopy?: (text: string) => void
  /** Fired with the focused line id when the user activates it (enter). */
  onSelect?: (id: number) => void
  /** Fired when the user requests to open the file in an editor. */
  onOpen?: (path: string | undefined) => void
  /** Fired when the user retries a failed/denied/offline load (r). */
  onRetry?: () => void
}

function resolveContext(props: FilePreviewProps): FilePreviewContext {
  return {
    loading: props.loading ? props.loading() : false,
    failure: props.failure ? props.failure() : undefined,
    denied: props.denied ? props.denied() : false,
    offline: props.offline ? props.offline() : false,
    degraded: props.degraded ? props.degraded() : false,
    degradedReason: props.degradedReason ? props.degradedReason() : undefined,
  }
}

function statusColor(status: FilePreviewStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "failure":
    case "denied":
      return theme.error
    case "offline":
    case "degraded":
      return theme.warning
    case "loading":
    case "empty":
      return theme.textMuted
    default:
      return theme.text
  }
}

export function FilePreview(props: FilePreviewProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const narrow = () => isNarrow(width(), props.narrowWidth ?? NARROW_WIDTH_DEFAULT)

  const [selectedId, setSelectedId] = createSignal<number | null>(null)
  const [query, setQuery] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [folded, setFolded] = createSignal(props.folded ?? true)
  const [copied, setCopied] = createSignal<string | null>(null)

  const headLines = () => props.headLines ?? PREVIEW_HEAD_DEFAULT
  const tailLines = () => props.tailLines ?? PREVIEW_TAIL_DEFAULT

  // Map raw file lines into presentable lines (strip ANSI once, classify).
  const allLines = createMemo<FilePreviewLine[]>(() => {
    const raw = props.content() ?? []
    return raw.map((line, index) => buildPreviewLine(index, line))
  })

  const state = createMemo(() =>
    buildState(allLines(), resolveContext(props), {
      query: query(),
      searching: searching(),
      folded: folded(),
      selectedId: selectedId(),
    }),
  )

  const view = createMemo(() => {
    const v = visibleLines(state(), { headLines: headLines(), tailLines: tailLines() })
    if (!narrow()) return v
    // Truncate each visible line to fit the narrow terminal.
    const max = width() - 4
    return {
      ...v,
      lines: v.lines.map((line) => truncateLine(line, max)),
    }
  })

  const summary = createMemo(() => filePreviewSummary(state(), props.path))
  const selected = createMemo(() => effectiveSelection(state(), { headLines: headLines(), tailLines: tailLines() }))

  // Keep the selection signal in sync with the derived valid selection so focus
  // is retained (never lost or trapped) as lines stream in or folds change.
  createEffect(() => {
    const valid = effectiveSelection(state(), { headLines: headLines(), tailLines: tailLines() })
    if (valid !== selectedId()) setSelectedId(valid)
  })

  function copyFocused() {
    const id = selected()
    const line = allLines().find((line) => line.id === id)
    if (!line) return
    setCopied(line.text)
    props.onCopy?.(line.text)
  }

  const retryable = () => state().status === "failure" || state().status === "denied" || state().status === "offline"

  useKeyboard((event) => {
    if (searching()) {
      if (event.name === "escape") {
        setQuery("")
        setSearching(false)
        return
      }
      if (event.name === "backspace") {
        setQuery((q) => q.slice(0, -1))
        return
      }
      if (event.name === "return" || event.name === "enter") {
        setSearching(false)
        return
      }
      if (event.sequence && event.sequence.length === 1 && !event.ctrl && !event.meta) {
        setQuery((q) => q + event.sequence)
      }
      return
    }

    switch (event.name) {
      case "up":
      case "k":
        setSelectedId(moveSelection(state(), -1, { headLines: headLines(), tailLines: tailLines() }))
        break
      case "down":
      case "j":
        setSelectedId(moveSelection(state(), 1, { headLines: headLines(), tailLines: tailLines() }))
        break
      case "space":
        if (state().status === "populated" || state().status === "long" || state().status === "degraded") {
          setFolded(!folded())
        }
        break
      case "y":
        copyFocused()
        break
      case "/":
        if (state().status === "populated" || state().status === "long" || state().status === "degraded") {
          setSearching(true)
        }
        break
      case "r":
        if (retryable()) props.onRetry?.()
        break
      case "o":
        if (props.onOpen) props.onOpen(props.path)
        break
      case "return":
      case "enter": {
        const id = selected()
        if (id !== null) props.onSelect?.(id)
        break
      }
    }
  })

  const isContentState = () =>
    state().status === "populated" || state().status === "long" || state().status === "degraded"

  return (
    <box id="file-preview" flexDirection="column" width={width()} selectable>
      <text id="file-preview-status" live>
        {summary()}{" "}
        <Show when={copied()}>
          <text fg={theme.success}>· copied</text>
        </Show>
      </text>

      <Show when={state().status === "loading"}>
        <text id="file-preview-loading" fg={theme.textMuted}>
          Loading file contents…
        </text>
      </Show>

      <Show when={state().status === "offline"}>
        <text id="file-preview-offline" fg={theme.warning}>
          {`Offline — cannot load file${props.path ? ` (${redactMessage(props.path)})` : ""}. Press r to retry.`}
        </text>
      </Show>

      <Show when={state().status === "denied"}>
        <text id="file-preview-denied" fg={theme.error}>
          {`Access denied${props.path ? `: ${redactMessage(props.path)}` : ""}. Press r to retry, o to open.`}
        </text>
      </Show>

      <Show when={state().status === "failure"}>
        <text id="file-preview-failure" fg={theme.error}>
          {`Failed to read: ${redactMessage(state().context.failure ?? "unknown error")}. Press r to retry.`}
        </text>
      </Show>

      <Show when={state().status === "degraded"}>
        <text id="file-preview-degraded" fg={theme.warning}>
          {`Limited preview — ${state().context.degradedReason ?? "reduced fidelity"}${props.path ? ` (${redactMessage(props.path)})` : ""}.`}
        </text>
      </Show>

      <Show when={view().matched > 0}>
        <text id="file-preview-matchcount" fg={theme.textMuted}>
          {`${view().matched} match${view().matched === 1 ? "" : "es"}`}
        </text>
      </Show>

      <Show when={isContentState()}>
        <box flexDirection="column">
          <For each={view().lines}>
            {(line) => {
              const isSelected = () => !line.isFoldMarker && selected() === line.id
              if (line.isFoldMarker) {
                return (
                  <text id="file-preview-fold" fg={theme.textMuted}>
                    {line.text}
                  </text>
                )
              }
              return (
                <box
                  id={`file-preview-line-${line.id}`}
                  selectable
                  flexDirection="row"
                  gap={1}
                  backgroundColor={isSelected() ? theme.backgroundElement : theme.background}
                >
                  <text>{isSelected() ? "> " : "  "}</text>
                  <text fg={line.level === "error" ? theme.error : line.level === "warn" ? theme.warning : theme.text} wrapMode="none">
                    {line.text}
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={view().hidden > 0 && !state().query.trim()}>
            <text id="file-preview-budget" fg={theme.textMuted}>
              {`${view().lines.length} shown · ${view().hidden} hidden — press space to expand`}
            </text>
          </Show>
          <Show when={view().capped}>
            <text id="file-preview-cap" fg={theme.textMuted}>
              {`Large file — render capped at ${PREVIEW_MAX_LINES_DEFAULT} lines for performance.`}
            </text>
          </Show>
        </box>
      </Show>

      <Show when={state().status === "empty"}>
        <text id="file-preview-empty" fg={theme.textMuted}>
          {`No content${props.path ? ` in ${redactMessage(props.path)}` : ""} — file is empty.`}
        </text>
      </Show>
    </box>
  )
}
