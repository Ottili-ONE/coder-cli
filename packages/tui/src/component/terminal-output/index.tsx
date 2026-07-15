/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import {
  type LineLevel,
  type TerminalLine,
  type TerminalOutputContext,
  FOLD_HEAD_DEFAULT,
  FOLD_TAIL_DEFAULT,
  NARROW_WIDTH_DEFAULT,
  buildState,
  classifyLine,
  deriveStatus,
  effectiveSelection,
  foldLines,
  isNarrow,
  matchCount,
  moveSelection,
  redactFailure,
  stripAnsiLine,
  terminalSummary,
  truncateLine,
  visibleLines,
} from "./model"

export interface TerminalOutputProps {
  /** Streamed raw lines. New entries are appended as the stream grows. */
  lines: Accessor<string[]>
  /** Whether the stream has finished (true) or is still producing output. */
  complete?: Accessor<boolean>
  /** A failure reason; present => the failure path is rendered. */
  failure?: Accessor<string | undefined>
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
}

function resolveContext(props: TerminalOutputProps): TerminalOutputContext {
  return {
    complete: props.complete ? props.complete() : false,
    failure: props.failure ? props.failure() : undefined,
  }
}

function levelColor(level: LineLevel, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (level) {
    case "error":
      return theme.error
    case "warn":
      return theme.warning
    default:
      return theme.text
  }
}

export function TerminalOutput(props: TerminalOutputProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const narrow = () => isNarrow(width(), props.narrowWidth ?? NARROW_WIDTH_DEFAULT)

  const [selectedId, setSelectedId] = createSignal<number | null>(null)
  const [query, setQuery] = createSignal("")
  const [searching, setSearching] = createSignal(false)
  const [folded, setFolded] = createSignal(props.folded ?? true)
  const [copied, setCopied] = createSignal<string | null>(null)

  const headLines = () => props.headLines ?? FOLD_HEAD_DEFAULT
  const tailLines = () => props.tailLines ?? FOLD_TAIL_DEFAULT

  // Map raw stream lines into presentable lines (strip ANSI once, classify).
  const allLines = createMemo<TerminalLine[]>(() => {
    const raw = props.lines() ?? []
    return raw.map((line, index) => {
      const text = stripAnsiLine(line)
      return { id: index, raw: line, text, level: classifyLine(text) }
    })
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

  const summary = createMemo(() => terminalSummary(state()))
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
      // Printable input becomes part of the query.
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
        setFolded(!folded())
        break
      case "y":
        copyFocused()
        break
      case "/":
        setSearching(true)
        break
      case "return":
      case "enter": {
        const id = selected()
        if (id !== null) props.onSelect?.(id)
        break
      }
    }
  })

  return (
    <box id="terminal-output" flexDirection="column" width={width()} selectable>
      <text id="terminal-output-status" live>
        {summary()}{" "}
        <Show when={copied()}>
          <text fg={theme.success}>· copied</text>
        </Show>
      </text>

      <Show when={state().status === "failure"}>
        <text id="terminal-output-failure" fg={theme.error}>
          {`Failed: ${redactFailure(state().context.failure ?? "unknown error")}`}
        </text>
      </Show>

      <Show when={view().matched > 0}>
        <text id="terminal-output-matchcount" fg={theme.textMuted}>
          {`${view().matched} match${view().matched === 1 ? "" : "es"}`}
        </text>
      </Show>

      <box flexDirection="column">
        <For each={view().lines}>
          {(line) => {
            const isSelected = () => !line.isFoldMarker && selected() === line.id
            if (line.isFoldMarker) {
              return (
                <text id="terminal-output-fold" fg={theme.textMuted}>
                  {line.text}
                </text>
              )
            }
            return (
              <box
                id={`terminal-output-line-${line.id}`}
                selectable
                flexDirection="row"
                gap={1}
                backgroundColor={isSelected() ? theme.backgroundElement : theme.background}
              >
                <text>{isSelected() ? "> " : "  "}</text>
                <text fg={levelColor(line.level, theme)} wrapMode="none">
                  {line.text}
                </text>
              </box>
            )
          }}
        </For>
        <Show when={view().hidden > 0 && !state().query.trim()}>
          <text id="terminal-output-budget" fg={theme.textMuted}>
            {`${view().lines.length} shown · ${view().hidden} hidden — press space to expand`}
          </text>
        </Show>
      </box>

      <Show when={state().status === "empty"}>
        <text id="terminal-output-empty" fg={theme.textMuted}>
          No output yet
        </text>
      </Show>
    </box>
  )
}
