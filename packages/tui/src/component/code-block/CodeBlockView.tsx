/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createSignal } from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "../../context/theme"
import { useClipboard } from "../../context/clipboard"
import { useTerminalDimensions } from "@opentui/solid"
import { colorSupport } from "../agent-roster/model"
import { Spinner } from "../spinner"
import {
  buildCodeBlockState,
  codeBlockAriaLabel,
  codeBlockStatusGlyph,
  codeBlockStatusLabel,
  codeBlockSummary,
  executionAvailable,
  formatGutter,
  gutterWidth,
  isFilePreviewNarrow,
  lineInSelection,
  type CodeBlockProps,
  type CodeBlockStatus,
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

function noticeColor(status: "failure" | "denied" | "offline", theme: ReturnType<typeof useTheme>["theme"]): RGBA {
  switch (status) {
    case "failure":
    case "denied":
      return theme.error
    case "offline":
      return theme.warning
    default:
      return theme.textMuted
  }
}

function showContentStatus(status: CodeBlockStatus): boolean {
  return status === "populated" || status === "long-content" || status === "degraded"
}

/** A bordered notice panel for blocking states (failure, denied, offline). */
function CodeBlockNotice(props: {
  status: "failure" | "denied" | "offline"
  message: string
  theme: ReturnType<typeof useTheme>["theme"]
  useColor: boolean
}) {
  const accent = () => (props.useColor ? noticeColor(props.status, props.theme) : props.theme.textMuted)
  return (
    <box
      flexDirection="column"
      backgroundColor={props.theme.backgroundPanel}
      borderColor={accent()}
      border={["left"]}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={accent()} attributes={TextAttributes.BOLD}>
        {`${codeBlockStatusGlyph(props.status, props.useColor)} ${codeBlockStatusLabel(props.status)}`}
      </text>
      <text fg={props.theme.text} wrapMode="word">
        {props.message}
      </text>
    </box>
  )
}

/**
 * Redesigned code block surface. A bordered panel with a one-line header
 * (language · line count · affordance hints), a right-aligned line-number
 * gutter, and a syntax-highlighted body. Copy, line selection, wrap and run
 * affordances are wired to real handlers (no placeholders).
 *
 * HARDENING (T-CLI-0194):
 *  - 8-state lifecycle: loading, empty, populated, long-content, failure,
 *    denied, offline, degraded — each intentionally rendered.
 *  - Accessibility: a `live` status line announces state changes; the root
 *    box has a self-describing aria-label; color is never the only signal
 *    (glyph + bracketed text fallback when color is off).
 *  - Terminal fallbacks: narrow terminals collapse gutter + header hints;
 *    NO_COLOR / colorLevel 0 disable color while keeping textual markers.
 *  - Performance: tokenizing is capped at the render budget so large/rapid
 *    streams never OOM; rendering is Stable (Solid `<Show>` preserves DOM
 *    nodes so focus is never lost across content updates).
 *  - Focus is never captured: the root is a single stable box whose children
 *    are swapped via `<Show>`, so Solid reuses the DOM node and any external
 *    focus (parent scroll/selection) is retained across content updates.
 *  - Secrets: every error/banner is redacted before painting; content is
 *    redacted when `conceal` is set.
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

  const level = () => props.colorLevel ?? 3
  const useColor = () => colorSupport(level()).useColor

  const state = createMemo(() =>
    buildCodeBlockState({
      code: props.code,
      language: props.language ?? null,
      wrap: wrap(),
      selection: selection(),
      conceal: props.conceal,
      context: props.context,
    }),
  )

  const status = () => state().status
  const narrow = () => isFilePreviewNarrow(dims().width)
  const wide = () => !narrow()
  const showGutter = () => wide() && state().lineCount > 0 && showContentStatus(status())
  const wrapMode = () => (state().wrap ? "word" : "none")
  const canRun = () => executionAvailable(props.language ?? null)

  const languageLabel = () => (state().language ? state().language! : "(code)")
  const headerLeft = () => languageLabel()
  const headerRight = () =>
    `${state().lineCount} line${state().lineCount === 1 ? "" : "s"}` +
    `  c copy · w wrap` +
    (canRun() ? " · e run" : "")

  const ariaLabel = () =>
    props.ariaLabel ?? codeBlockAriaLabel(state())

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

  const mutedText = () => (useColor() ? theme.textMuted : theme.text)

  return (
    <box
      flexDirection="column"
      backgroundColor={showContentStatus(status()) ? theme.backgroundPanel : undefined}
      borderColor={showContentStatus(status()) ? theme.markdownCodeBlock : undefined}
      border={showContentStatus(status()) ? (["left"] as const) : undefined}
      paddingLeft={showContentStatus(status()) ? 1 : 0}
      paddingTop={0}
      paddingBottom={0}
      marginTop={0}
      marginBottom={0}
      id="code-block"
      aria-label={ariaLabel()}
      on:keyPress={(e: { key?: string; shift?: boolean }) => onKey(e)}
    >
      {/* Status banner — always rendered so state is never silent */}
      <Show when={status() !== "populated"}>
        <text fg={mutedText()} live>
          {`${codeBlockStatusGlyph(status(), useColor())} ${codeBlockSummary(state())}`}
        </text>
      </Show>

      {/* Loading state */}
      <Show when={status() === "loading"}>
        <Spinner color={useColor() ? theme.info : theme.textMuted}>Loading code block\u2026</Spinner>
      </Show>

      {/* Empty state */}
      <Show when={status() === "empty"}>
        <text fg={mutedText()} wrapMode="word">
          {"(empty code block)"}
        </text>
      </Show>

      {/* Denied state */}
      <Show when={status() === "denied"}>
        <CodeBlockNotice
          status="denied"
          message="Permission denied \u2014 you cannot view this code block."
          theme={theme}
          useColor={useColor()}
        />
      </Show>

      {/* Offline state */}
      <Show when={status() === "offline"}>
        <CodeBlockNotice
          status="offline"
          message="No network \u2014 code block dependencies are unavailable."
          theme={theme}
          useColor={useColor()}
        />
      </Show>

      {/* Failure state */}
      <Show when={status() === "failure"}>
        <CodeBlockNotice
          status="failure"
          message={state().context.error ?? "unknown error"}
          theme={theme}
          useColor={useColor()}
        />
      </Show>

      {/* Degraded state */}
      <Show when={status() === "degraded"}>
        <text fg={mutedText()}>
          {`${codeBlockStatusGlyph("degraded", useColor())} ${codeBlockStatusLabel("degraded")}: rendering in reduced mode`}
        </text>
      </Show>

      {/* Content states: populated, long-content, degraded (show code when degraded) */}
      <Show when={showContentStatus(status())}>
        {/* Header: language (left) · line count + affordance hints (right) */}
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text fg={mutedText()} wrapMode="none">
            {headerLeft()}
          </text>
          <Show when={wide()}>
            <text fg={mutedText()} wrapMode="none">
              <text
                fg={useColor() ? theme.info : theme.text}
                onMouseUp={copyBlock}
              >{`c copy `}</text>
              <text
                fg={useColor() ? theme.info : theme.text}
                onMouseUp={toggleWrap}
              >{`w wrap `}</text>
              <Show when={canRun()}>
                <text
                  fg={useColor() ? theme.success : theme.text}
                  onMouseUp={run}
                >{`e run`}</text>
              </Show>
            </text>
          </Show>
        </box>

        <For each={state().lines}>
          {(line, i) => {
            const lineNumber = () => i() + 1
            const selected = () => lineInSelection(state().selection, lineNumber())
            const rowBg = () => (selected() ? theme.backgroundMenu : undefined)
            const gutterColor = () =>
              selected() ? selectedForeground(theme, theme.backgroundMenu) : mutedText()
            return (
              <box flexDirection="row" backgroundColor={rowBg()}>
                <Show when={showGutter()}>
                  <text fg={gutterColor()} wrapMode="none" flexShrink={0}>
                    {`${formatGutter(lineNumber(), gutterWidth(state().lineCount))} `}
                  </text>
                </Show>
                <text wrapMode={wrapMode()}>
                  <For each={state().tokens[i()] ?? []}>
                    {(tok) => (
                      <text fg={useColor() ? tokenColor(theme, tok.kind) : theme.text}>
                        {tok.text}
                      </text>
                    )}
                  </For>
                </text>
              </box>
            )
          }}
        </For>

        {/* Long-content notification */}
        <Show when={status() === "long-content"}>
          <text fg={mutedText()} wrapMode="word">
            {state().lineLimited
              ? `Long content \u2014 showing up to ${state().lineCount - state().hiddenLines} lines (${state().hiddenLines} hidden by render budget).`
              : `Long content \u2014 ${state().lineCount} lines.`}
          </text>
        </Show>

        {/* Render budget notification */}
        <Show when={state().lineLimited && status() !== "long-content"}>
          <text fg={mutedText()} wrapMode="word">
            {`Showing up to ${state().lineCount - state().hiddenLines} lines (${state().hiddenLines} hidden by render budget).`}
          </text>
        </Show>
      </Show>
    </box>
  )
}