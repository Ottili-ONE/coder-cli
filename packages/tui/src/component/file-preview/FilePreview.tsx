/** @jsxImportSource @opentui/solid */
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core"
import type { Theme } from "../../theme"
import { selectedForeground } from "../../context/theme"
import { Locale } from "../../util/locale"
import { For, Match, Show, Switch } from "solid-js"
import {
  filePreviewLifecycleGlyph,
  filePreviewSummary,
  formatGutter,
  gutterWidth,
  hiddenLineCount,
  languageFromFile,
  lineInSelection,
  normalizeFileContents,
  normalizeSelection,
  referencesForLine,
  splitFileLines,
  tokenizeFile,
  type FilePreviewLifecycleStatus,
  type FilePreviewReference,
  type FilePreviewSelection,
  type FilePreviewTokenKind,
} from "./file-preview-core"

const GUTTER_PAD = 1
const REFERENCE_MARKER = "●"

export type FilePreviewProps = {
  readonly width: number
  readonly height: number
  readonly theme: Theme
  /** Path used to infer the language when `language` is omitted. */
  readonly path?: string
  /** Explicit language id; otherwise derived from `path`. */
  readonly language?: string
  /** File contents. `undefined` means no file is loaded (empty state). */
  readonly contents: string | readonly string[] | undefined
  readonly loading?: boolean
  readonly error?: unknown
  /** Show line-number gutter (default true). */
  readonly gutter?: boolean
  readonly showAll?: boolean
  readonly renderBudget?: number
  readonly selectedRange?: FilePreviewSelection | null
  readonly references?: readonly FilePreviewReference[]
  readonly focused?: boolean
  readonly colorLevel?: number
  readonly onLineClick?: (line: number) => void
  readonly onLineNumberClick?: (line: number) => void
  readonly onRevealMore?: () => void
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

function tokenColor(theme: Theme, kind: FilePreviewTokenKind): ColorInput {
  switch (kind) {
    case "comment":
      return theme.syntaxComment
    case "keyword":
      return theme.syntaxKeyword
    case "function":
      return theme.syntaxFunction
    case "variable":
      return theme.syntaxVariable
    case "string":
      return theme.syntaxString
    case "number":
      return theme.syntaxNumber
    case "type":
      return theme.syntaxType
    case "operator":
      return theme.syntaxOperator
    case "punctuation":
      return theme.syntaxPunctuation
    default:
      return theme.text
  }
}

export function FilePreview(props: FilePreviewProps) {
  const useGutter = () => props.gutter ?? true
  const useColor = () => (props.colorLevel ?? 3) >= 1
  const language = () => props.language ?? languageFromFile(props.path)
  const noFile = () => props.contents === undefined
  const rawLines = () => splitFileLines(normalizeFileContents(noFile() ? "" : props.contents))
  const error = () => errorMessage(props.error)

  const status = (): FilePreviewLifecycleStatus => {
    if (props.loading) return "loading"
    if (error()) return "error"
    if (noFile()) return "empty"
    const budget = props.renderBudget ?? 2000
    const showAll = props.showAll ?? false
    const lineCount = rawLines().length
    if (!showAll && lineCount > budget) return "large"
    return "populated"
  }

  const state = () => ({ status: status(), error: error(), lineCount: rawLines().length })
  const selection = () => normalizeSelection(props.selectedRange)

  const renderedLines = () => {
    const all = rawLines()
    if (state().status !== "large") return all
    const budget = props.renderBudget ?? 2000
    return all.slice(0, props.showAll ? all.length : budget)
  }

  const tokens = () => tokenizeFile(renderedLines(), language(), Number.POSITIVE_INFINITY)
  const gw = () => gutterWidth(rawLines().length)

  let scroll: ScrollBoxRenderable | undefined

  // Keep a selected line reachable: scroll it into view when the range changes.
  const scrollSelectionIntoView = () => {
    const sel = selection()
    if (!sel || !scroll) return
    const line = sel.start
    const total = renderedLines().length
    if (line < 1 || line > total) return
    if (line < scroll.scrollTop) scroll.scrollTo(line - 1)
    else if (line >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(line - scroll.viewport.height)
  }

  return (
    <box border={["left", "right"]} borderColor={props.theme.border} width={props.width} height={props.height} flexDirection="column">
      <Switch>
        <Match when={state().status === "loading" || state().status === "error" || state().status === "empty"}>
          <FilePreviewStatusRow
            status={state().status}
            error={state().error}
            useColor={useColor()}
            color={statusColor()}
            width={props.width}
          />
        </Match>
        <Match when={state().status === "large" || state().status === "populated"}>
          <scrollbox
            ref={(element: ScrollBoxRenderable) => {
              scroll = element
              // Defer so layout settles before we compute offsets.
              requestAnimationFrame(scrollSelectionIntoView)
            }}
            verticalScrollbarOptions={{ visible: false }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <Show when={state().status === "large" && !(props.showAll ?? false)}>
              <text
                id="file-preview-budget"
                fg={props.theme.textMuted}
                wrapMode="none"
                live
                onMouseUp={() => props.onRevealMore?.()}
              >
                {`▤ Showing ${renderedLines().length} of ${rawLines().length} lines — press to reveal all`}
              </text>
            </Show>
            <For each={renderedLines()}>
              {(line, index) => {
                const lineNumber = () => index() + 1
                const selected = () => lineInSelection(selection(), lineNumber())
                const refs = () => referencesForLine(props.references ?? [], lineNumber())
                const hasRefs = () => refs().length > 0
                const gutterText = () =>
                  (hasRefs() ? REFERENCE_MARKER + " " : "  ") + formatGutter(lineNumber(), gw())
                const gutterColor = () =>
                  hasRefs() ? props.theme.primary : useColor() ? props.theme.diffLineNumber : props.theme.textMuted
                const lineColor = () => (hasRefs() ? props.theme.primary : props.theme.textMuted)
                const rowBg = () => (selected() && useColor() ? props.theme.primary : undefined)
                const tokenFg = (kind: FilePreviewTokenKind) =>
                  selected() && useColor() ? selectedForeground(props.theme, props.theme.primary) : tokenColor(props.theme, kind)

                return (
                  <box
                    flexDirection="row"
                    width="100%"
                    backgroundColor={rowBg()}
                    onMouseUp={() => props.onLineClick?.(lineNumber())}
                  >
                    <Show when={useGutter()}>
                      <text
                        fg={gutterColor()}
                        wrapMode="none"
                        flexShrink={0}
                        onMouseUp={() => props.onLineNumberClick?.(lineNumber())}
                      >
                        {gutterText()}
                      </text>
                    </Show>
                    <box flexGrow={1} minWidth={0}>
                      <For each={tokens()[index()]}>
                        {(token) => <text fg={tokenFg(token.kind)} wrapMode="none">{token.text}</text>}
                      </For>
                    </box>
                  </box>
                )
              }}
            </For>
            <Show when={(props.references?.length ?? 0) > 0}>
              <text id="file-preview-references" fg={props.theme.textMuted} wrapMode="none">
                {`${props.references!.length} reference${props.references!.length === 1 ? "" : "s"}`}
              </text>
            </Show>
          </scrollbox>
        </Match>
      </Switch>
    </box>
  )

  function statusColor(): ColorInput {
    const s = state().status
    if (s === "error") return props.theme.error
    if (s === "empty") return props.theme.textMuted
    return props.theme.textMuted
  }
}

function FilePreviewStatusRow(props: {
  status: FilePreviewLifecycleStatus
  error: string | undefined
  useColor: boolean
  color: ColorInput
  width: number
}) {
  const label = () => {
    if (props.status === "loading") return "File preview: loading…"
    if (props.status === "error") return `File preview: ${props.error ?? "failed to load"}`
    if (props.status === "empty") return "File preview: No file loaded"
    return "File preview"
  }
  return (
    <text id="file-preview-status" live fg={props.color} wrapMode="none">
      {`${filePreviewLifecycleGlyph(props.status, props.useColor)} ${Locale.truncate(label(), Math.max(1, props.width - 4))}`}
    </text>
  )
}

// Re-export the core so host views import a single module.
export * from "./file-preview-core"
