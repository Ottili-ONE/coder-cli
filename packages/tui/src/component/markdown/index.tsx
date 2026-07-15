/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { redactSensitive } from "../agent-roster/model"
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
