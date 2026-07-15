/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { RGBA, TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { colorSupport, redactSensitive } from "../agent-roster/model"
import { Spinner } from "../spinner"
import {
  parseMarkdown,
  inlineToPlain,
  calloutLabel,
  calloutGlyph,
  type Align,
  type Block,
  type CalloutKind,
  type Inline,
} from "./model"
import {
  buildMarkdownState,
  createMarkdownThrottle,
  isMarkdownNarrow,
  markdownStatusGlyph,
  markdownStatusLabel,
  markdownSummary,
  MARKDOWN_COMMIT_INTERVAL_MS,
  MARKDOWN_NARROW_WIDTH,
  MARKDOWN_RENDER_BUDGET,
  type MarkdownContext,
  type MarkdownStatus,
} from "./state"

export interface MarkdownViewProps {
  content: string
  /** Reserved for parity with the legacy surface; the view is always live. */
  streaming?: boolean
  /** When true, secret-shaped text is redacted before painting. */
  conceal?: boolean
  /** Left indentation reserved by the parent box (used for table fit math). */
  indent?: number
}

function concealText(value: string, conceal?: boolean): string {
  if (!conceal) return value
  return redactSensitive(value).text
}

function calloutColor(kind: CalloutKind, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (kind) {
    case "tip":
      return theme.success
    case "important":
      return theme.primary
    case "warning":
      return theme.warning
    case "caution":
      return theme.error
    case "note":
    case "info":
    default:
      return theme.info
  }
}

function renderInline(children: Inline[], theme: ReturnType<typeof useTheme>["theme"], conceal?: boolean): JSX.Element[] {
  return children.map((node): JSX.Element => {
    switch (node.type) {
      case "text":
        return (
          <text fg={theme.markdownText}>{concealText(node.value, conceal)}</text>
        )
      case "code":
        return (
          <text fg={theme.markdownCode}>{concealText(node.value, conceal)}</text>
        )
      case "link": {
        const url = concealText(node.url, conceal)
        const text = node.text || url
        return (
          <text fg={theme.markdownLink}>
            {text}
            <Show when={text !== url}>
              <text fg={theme.markdownLinkText}> ({url})</text>
            </Show>
          </text>
        )
      }
      case "bold":
        return (
          <text fg={theme.markdownStrong} attributes={TextAttributes.BOLD}>
            {renderInline(node.children, theme, conceal)}
          </text>
        )
      case "italic":
        return (
          <text fg={theme.markdownEmph} attributes={TextAttributes.ITALIC}>
            {renderInline(node.children, theme, conceal)}
          </text>
        )
      case "strike":
        return (
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            {renderInline(node.children, theme, conceal)}
          </text>
        )
    }
  })
}

function headingPrefix(level: number): string {
  if (level <= 1) return ""
  return "  ".repeat(Math.min(level - 1, 5))
}

function renderBlock(block: Block, theme: ReturnType<typeof useTheme>["theme"], conceal?: boolean, indent = 0): JSX.Element {
  switch (block.type) {
    case "heading": {
      const prefix = headingPrefix(block.level)
      return (
        <text fg={theme.markdownHeading} attributes={TextAttributes.BOLD} wrapMode="word">
          {prefix}
          {renderInline(block.children, theme, conceal)}
        </text>
      )
    }
    case "paragraph":
      return (
        <text wrapMode="word">{renderInline(block.children, theme, conceal)}</text>
      )
    case "list":
      return (
        <box flexDirection="column" gap={0}>
          <For each={block.items}>
            {(item, idx) => (
              <box flexDirection="row" flexWrap="nowrap" alignItems="flex-start" gap={1}>
                <text fg={block.ordered ? theme.markdownListEnumeration : theme.markdownListItem} attributes={TextAttributes.BOLD}>
                  {block.ordered ? `${idx() + 1}.` : "•"}
                </text>
                <text wrapMode="word" flexGrow={1}>
                  {renderInline(item, theme, conceal)}
                </text>
              </box>
            )}
          </For>
        </box>
      )
    case "blockquote":
      return (
        <box flexDirection="column" borderColor={theme.markdownBlockQuote} border={["left"]} paddingLeft={1} gap={0}>
          <For each={block.children}>
            {(child) => renderBlock(child, theme, conceal, indent + 2)}
          </For>
        </box>
      )
    case "callout":
      return <CalloutView kind={block.kind} children={block.children} theme={theme} conceal={conceal} indent={indent} />
    case "code":
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
        >
          <text fg={theme.markdownCode} wrapMode="none">
            {concealText(block.value, conceal)}
          </text>
        </box>
      )
    case "hr":
      return (
        <text fg={theme.markdownHorizontalRule} wrapMode="none">
          {"─".repeat(Math.max(4, 40))}
        </text>
      )
    case "table":
      return <TableView block={block} theme={theme} conceal={conceal} indent={indent} />
  }
}

function CalloutView(props: {
  kind: CalloutKind
  children: Block[]
  theme: ReturnType<typeof useTheme>["theme"]
  conceal?: boolean
  indent: number
}) {
  const accent = () => calloutColor(props.kind, props.theme)
  return (
    <box
      flexDirection="column"
      gap={0}
      backgroundColor={props.theme.backgroundPanel}
      borderColor={accent()}
      border={["left"]}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      marginTop={0}
      marginBottom={0}
    >
      <text fg={accent()} attributes={TextAttributes.BOLD}>
        {`${calloutGlyph(props.kind)} ${calloutLabel(props.kind)}`}
      </text>
      <Show when={props.children.length > 0}>
        <box flexDirection="column" gap={0} paddingTop={1}>
          <For each={props.children}>{(child) => renderBlock(child, props.theme, props.conceal, props.indent + 2)}</For>
        </box>
      </Show>
    </box>
  )
}

const ALIGN_PAD: Record<Align, (s: string, w: number) => string> = {
  left: (s, w) => s.padEnd(w),
  right: (s, w) => s.padStart(w),
  center: (s, w) => {
    const left = Math.floor((w - s.length) / 2)
    return s.padStart(left + s.length).padEnd(w)
  },
}

function TableView(props: {
  block: Extract<Block, { type: "table" }>
  theme: ReturnType<typeof useTheme>["theme"]
  conceal?: boolean
  indent: number
}) {
  const dims = useTerminalDimensions()
  const layout = createMemo(() => {
    const width = Math.max(24, dims().width - props.indent - 2)
    const table = props.block
    const cols = table.header.length
    const plain: string[][] = [table.header.map((c) => inlineToPlain(c))]
    for (const row of table.rows) {
      plain.push(row.map((c) => inlineToPlain(c)))
    }
    const aligns = table.aligns
    while (plain[0].length < cols) plain[0].push("")
    const colMin = 3
    const sep = 3 // " | "
    const overhead = sep * Math.max(1, cols) + 1
    let avail = Math.max(colMin * cols + overhead, width)
    let colWidths = plain[0].map((_, c) => {
      let max = 0
      for (const row of plain) {
        const cell = row[c] ?? ""
        if (cell.length > max) max = cell.length
      }
      return Math.max(colMin, max)
    })
    const total = () => colWidths.reduce((a, b) => a + b, 0) + overhead
    while (total() > avail && colWidths.some((w) => w > colMin)) {
      const idx = colWidths.indexOf(Math.max(...colWidths))
      colWidths[idx] = Math.max(colMin, colWidths[idx] - 1)
    }
    const truncateCell = (value: string, w: number) =>
      value.length > w ? value.slice(0, Math.max(1, w - 1)) + "…" : value
    const rowText = (cells: string[]) =>
      colWidths
        .map((w, c) => {
          const value = truncateCell((cells[c] ?? "").replace(/\s+/g, " "), w)
          return ALIGN_PAD[aligns[c] ?? "left"](value, w)
        })
        .join(" │ ")
    return {
      header: rowText(plain[0]),
      separator: colWidths.map((w) => "─".repeat(w)).join("─┼─"),
      rows: plain.slice(1).map((cells) => rowText(cells)),
    }
  })

  return (
    <box flexDirection="column" gap={0} marginTop={0} marginBottom={0}>
      <text fg={props.theme.markdownHeading} attributes={TextAttributes.BOLD} wrapMode="none">
        {`│ ${layout().header} │`}
      </text>
      <text fg={props.theme.markdownHorizontalRule} wrapMode="none">
        {`├─${layout().separator}─┤`}
      </text>
      <For each={layout().rows}>
        {(row) => (
          <text fg={props.theme.markdownText} wrapMode="none">
            {`│ ${row} │`}
          </text>
        )}
      </For>
    </box>
  )
}

export function MarkdownView(props: MarkdownViewProps) {
  const { theme } = useTheme()
  const blocks = createMemo<Block[]>(() => parseMarkdown(props.content ?? ""))
  const indent = () => props.indent ?? 0

  return (
    <box flexDirection="column" gap={1} flexShrink={0}>
      <For each={blocks()}>{(block) => renderBlock(block, theme, props.conceal, indent())}</For>
    </box>
  )
}

// ---------------------------------------------------------------------------
// State-hardened wrapper
// ---------------------------------------------------------------------------

export interface MarkdownStateViewProps {
  /** Raw markdown content (may be a live stream accessor). */
  content: Accessor<string> | string
  /** Content is being fetched or streamed and not yet presentable. */
  loading?: Accessor<boolean> | boolean
  /** A network is required to resolve linked/embedded content. */
  connected?: Accessor<boolean> | boolean
  /** The caller is allowed to view this content. */
  permitted?: Accessor<boolean> | boolean
  /** A render/load failure message (surfaced in the failure state). */
  error?: Accessor<string | null | undefined> | string | null
  /** Render in reduced-fidelity mode (e.g. no callouts/highlight). */
  degraded?: Accessor<boolean> | boolean
  /** When true, secret-shaped text is redacted before painting. */
  conceal?: boolean
  /** Left indentation reserved by the parent box. */
  indent?: number
  /** Render budget (characters) before the markdown switches to long-content. */
  renderBudget?: number
  /** Terminal width at or below which the compact layout is used. */
  narrowWidth?: number
  /** Explicit color level (0 disables color). */
  colorLevel?: number | Accessor<number>
  /** Throttle rapid content updates to the render budget window (default true). */
  coalesce?: boolean
}

function isAccessor<T>(value: unknown): value is Accessor<T> {
  return typeof value === "function"
}

function resolveFlag<T>(value: Accessor<T> | T | undefined, fallback: T): Accessor<T> {
  if (value === undefined) return () => fallback
  if (isAccessor<T>(value)) return value
  return () => value
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

function MarkdownNotice(props: {
  status: "failure" | "denied" | "offline"
  message: string
  theme: ReturnType<typeof useTheme>["theme"]
  useColor: boolean
}) {
  const accent = () => (props.useColor ? noticeColor(props.status, props.theme) : props.theme.textMuted)
  return (
    <box
      flexDirection="column"
      gap={0}
      backgroundColor={props.theme.backgroundPanel}
      borderColor={accent()}
      border={["left"]}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={accent()} attributes={TextAttributes.BOLD}>
        {`${markdownStatusGlyph(props.status, props.useColor)} ${markdownStatusLabel(props.status)}`}
      </text>
      <text fg={props.theme.text} wrapMode="word">
        {props.message}
      </text>
    </box>
  )
}

/**
 * State-hardened Markdown renderer. Wraps {@link MarkdownView} so every
 * lifecycle state (loading, empty, populated, long-content, failure, denied,
 * offline, degraded) is intentionally rendered and actionable.
 *
 * Hardening:
 *  - Accessibility: a `live` status line announces state changes with a
 *    self-contained redacted label; color is never the only signal (glyph +
 *    bracketed text fallback when color is off).
 *  - Terminal fallbacks: narrow terminals collapse the layout; NO_COLOR /
 *    colorLevel 0 disable color while keeping the textual markers.
 *  - Performance: runaway/rapid streams are capped by a hard safety budget and
 *    coalesced (leading+trailing throttle) so the parser runs at most once per
 *    render-budget window, never per keystroke.
 *  - Secrets: every error/banner is redacted before painting; the parser
 *    redacts inline when `conceal` is set.
 *
 * Focus is never captured: the root is a single stable box whose children are
 * swapped via `<Show>`, so Solid reuses the DOM node and any external focus
 * (parent scroll/selection) is retained across content updates.
 */
export function MarkdownStateView(props: MarkdownStateViewProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()

  const getContent = resolveFlag(props.content, "")
  const getLoading = resolveFlag(props.loading, false)
  const getConnected = resolveFlag(props.connected, true)
  const getPermitted = resolveFlag(props.permitted, true)
  const getError = resolveFlag(props.error, null)
  const getDegraded = resolveFlag(props.degraded, false)

  const level = () => (typeof props.colorLevel === "function" ? props.colorLevel() : (props.colorLevel ?? 3))
  const useColor = () => colorSupport(level()).useColor

  // Rapid-stream coalescing: bound reparse rate to the render-budget window.
  const [committed, setCommitted] = createSignal(getContent())
  const throttle = createMarkdownThrottle((value: string) => setCommitted(value), MARKDOWN_COMMIT_INTERVAL_MS)
  createEffect(() => {
    const next = getContent()
    if (props.coalesce ?? true) throttle.push(next)
    else setCommitted(next)
  })

  const ctx = (): MarkdownContext => ({
    loading: getLoading(),
    connected: getConnected(),
    permitted: getPermitted(),
    error: getError() ?? null,
    degraded: getDegraded(),
  })

  const state = createMemo(() =>
    buildMarkdownState(committed(), ctx(), {
      renderBudget: props.renderBudget ?? MARKDOWN_RENDER_BUDGET,
      narrowWidth: props.narrowWidth ?? MARKDOWN_NARROW_WIDTH,
    }),
  )

  const status = () => state().status
  const narrow = () => isMarkdownNarrow(dims().width, state().narrowWidth)
  const showContent = () => status() === "populated" || status() === "long-content" || status() === "degraded"

  return (
    <box flexDirection="column" gap={1} flexShrink={0}>
      <Show when={status() !== "populated"}>
        <text id="markdown-status" live>
          {`${markdownStatusGlyph(status(), useColor())} ${markdownSummary(state())}`}
        </text>
      </Show>

      <Show when={status() === "loading"}>
        <Spinner color={useColor() ? theme.info : theme.textMuted}>Rendering markdown…</Spinner>
      </Show>

      <Show when={status() === "empty"}>
        <text fg={theme.textMuted} wrapMode="word">
          {"(no content)"}
        </text>
      </Show>

      <Show when={status() === "denied"}>
        <MarkdownNotice
          status="denied"
          message="Permission denied — you cannot view this content."
          theme={theme}
          useColor={useColor()}
        />
      </Show>

      <Show when={status() === "offline"}>
        <MarkdownNotice
          status="offline"
          message="No network — linked or embedded content is unavailable."
          theme={theme}
          useColor={useColor()}
        />
      </Show>

      <Show when={status() === "failure"}>
        <MarkdownNotice
          status="failure"
          message={redactSensitive(state().context.error ?? "unknown error").text}
          theme={theme}
          useColor={useColor()}
        />
      </Show>

      <Show when={status() === "degraded"}>
        <text fg={useColor() ? theme.warning : theme.textMuted} wrapMode="word">
          {`${markdownStatusGlyph("degraded", useColor())} ${markdownStatusLabel("degraded")}: rendering in reduced mode`}
        </text>
      </Show>

      <Show when={showContent()}>
        <MarkdownView content={state().content} conceal={props.conceal} indent={narrow() ? 0 : props.indent} />
        <Show when={status() === "long-content"}>
          <text fg={theme.textMuted} wrapMode="word">
            {state().droppedChars > 0
              ? `Long content — truncated to ${state().content.length} characters (${state().droppedChars} dropped). Increase the render budget to expand.`
              : `Long content — showing ${state().content.length} characters. Increase the render budget to expand.`}
          </text>
        </Show>
      </Show>
    </box>
  )
}
