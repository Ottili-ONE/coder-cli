/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createSignal } from "solid-js"
import { useTheme, selectedForeground } from "../../context/theme"
import { useClipboard } from "../../context/clipboard"
import { useTerminalDimensions } from "@opentui/solid"
import {
  buildCodeBlockState,
  executionAvailable,
  formatGutter,
  gutterWidth,
  isFilePreviewNarrow,
  lineInSelection,
  type CodeBlockProps,
  type FilePreviewSelection,
  type FilePreviewTokenKind,
} from "./state"

/** Map a token kind to the Ottili syntax palette. Mirrors `FilePreview.tsx`. */
function tokenColor(theme: ReturnType<typeof useTheme>["theme"], kind: FilePreviewTokenKind) {
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

/**
 * Redesigned code block surface. A bordered panel with a one-line header
 * (language · line count · affordance hints), a right-aligned line-number
 * gutter, and a syntax-highlighted body. Copy, line selection, wrap and run
 * affordances are wired to real handlers (no placeholders).
 *
 * Interaction:
 *  - mouse: click the `c` / `w` / `e` hints in the header.
 *  - keyboard: `c` copy, `C` copy selection, `w` wrap, `e`/`Enter` run
 *    (shell-eligible only), `g`/`G` jump to first/last line,
 *    Shift+↑/Shift+↓ extend the line selection.
 */
export function CodeBlockView(props: CodeBlockProps) {
  const { theme } = useTheme()
  const clipboard = useClipboard()
  const dims = useTerminalDimensions()

  const [wrap, setWrap] = createSignal(props.wrap ?? false)
  const [selection, setSelection] = createSignal<FilePreviewSelection | null>(props.selection ?? null)
  const [anchor, setAnchor] = createSignal<number | null>(null)

  const state = createMemo(() =>
    buildCodeBlockState({
      code: props.code,
      language: props.language ?? null,
      wrap: wrap(),
      selection: selection(),
      conceal: props.conceal,
    }),
  )

  const narrow = () => isFilePreviewNarrow(dims().width)
  const wide = () => !narrow()
  const showGutter = () => wide() && state().lineCount > 0
  const wrapMode = () => (state().wrap ? "word" : "none")
  const canRun = () => executionAvailable(props.language ?? null)

  const languageLabel = () => (state().language ? state().language! : "(code)")
  const headerLeft = () => languageLabel()
  const headerRight = () =>
    `${state().lineCount} line${state().lineCount === 1 ? "" : "s"}` +
    `  c copy · w wrap` +
    (canRun() ? " · e run" : "")

  const ariaLabel = () =>
    props.ariaLabel ??
    `Code block, ${languageLabel()}, ${state().lineCount} line${
      state().lineCount === 1 ? "" : "s"
    }, c to copy`

  const copy = (text: string) => {
    void clipboard.write?.(text)
  }

  const copyBlock = () => copy(props.code)
  const copySelection = () => {
    const sel = selection()
    if (!sel) {
      copyBlock()
      return
    }
    const lines = state().lines
    const slice = lines.slice(sel.start - 1, sel.end)
    copy(slice.join("\n"))
  }

  const toggleWrap = () => setWrap((w) => !w)

  const run = () => {
    if (canRun()) props.onExecute?.(props.code, props.language ?? null)
  }

  const extendSelection = (line: number, extend: boolean) => {
    if (!extend) {
      setSelection({ start: line, end: line })
      setAnchor(line)
      return
    }
    const a = anchor() ?? line
    setSelection({ start: Math.min(a, line), end: Math.max(a, line) })
  }

  const onKey = (event: { key?: string; shift?: boolean }) => {
    const key = event.key
    if (!key) return
    switch (key) {
      case "c":
        if (event.shift) copySelection()
        else copyBlock()
        return
      case "C":
        copySelection()
        return
      case "w":
      case "W":
        toggleWrap()
        return
      case "e":
      case "E":
      case "Enter":
        run()
        return
      case "g":
        setAnchor(1)
        setSelection({ start: 1, end: 1 })
        return
      case "G":
        setAnchor(state().lineCount)
        setSelection({ start: state().lineCount, end: state().lineCount })
        return
      case "ArrowUp":
        if (event.shift) {
          const cur = selection()?.end ?? anchor() ?? state().lineCount
          extendSelection(Math.max(1, cur - 1), true)
        }
        return
      case "ArrowDown":
        if (event.shift) {
          const cur = selection()?.end ?? anchor() ?? 1
          extendSelection(Math.min(state().lineCount, cur + 1), true)
        }
        return
    }
  }

  return (
    <box
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      borderColor={theme.markdownCodeBlock}
      border={["left"]}
      paddingLeft={1}
      paddingTop={0}
      paddingBottom={0}
      marginTop={0}
      marginBottom={0}
      id="code-block"
      aria-label={ariaLabel()}
      on:keyPress={(e: { key?: string; shift?: boolean }) => onKey(e)}
    >
      {/* Header: language (left) · line count + affordance hints (right) */}
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={theme.textMuted} wrapMode="none">
          {headerLeft()}
        </text>
        <Show when={wide()}>
          <text fg={theme.textMuted} wrapMode="none">
            <text
              fg={theme.info}
              onMouseUp={copyBlock}
            >{`c copy `}</text>
            <text
              fg={theme.info}
              onMouseUp={toggleWrap}
            >{`w wrap `}</text>
            <Show when={canRun()}>
              <text
                fg={theme.success}
                onMouseUp={run}
              >{`e run`}</text>
            </Show>
          </text>
        </Show>
      </box>

      <Show
        when={state().status === "populated"}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">{`(${languageLabel()} — empty)`}</text>
        }
      >
        <For each={state().lines}>
          {(line, i) => {
            const lineNumber = () => i() + 1
            const selected = () => lineInSelection(state().selection, lineNumber())
            const rowBg = () => (selected() ? theme.backgroundMenu : undefined)
            const gutterColor = () =>
              selected() ? selectedForeground(theme, theme.backgroundMenu) : theme.textMuted
            return (
              <box flexDirection="row" backgroundColor={rowBg()}>
                <Show when={showGutter()}>
                  <text fg={gutterColor()} wrapMode="none" flexShrink={0}>
                    {`${formatGutter(lineNumber(), gutterWidth(state().lineCount))} `}
                  </text>
                </Show>
                <text wrapMode={wrapMode()}>
                  <For each={state().tokens[i()]}>
                    {(tok) => <text fg={tokenColor(theme, tok.kind)}>{tok.text}</text>}
                  </For>
                </text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}
