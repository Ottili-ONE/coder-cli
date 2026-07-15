/**
 * Redesigned Markdown renderer — pure model.
 *
 * Parses Markdown into a structured block tree that the TUI renderer
 * (`index.tsx`) paints with the Ottili palette. The parser is intentionally
 * tolerant: partial/incomplete input (streaming) never throws and degrades to
 * the best-effort block it can recognise.
 *
 * Supported surface:
 *  - Headings (ATX `#`..`######`)
 *  - Unordered / ordered lists (single level)
 *  - GFM tables with alignment rows
 *  - Links, inline code, bold, italic, strikethrough
 *  - GitHub-style callouts (`> [!NOTE]`, `> [!WARNING]`, ...)
 *  - Block quotes, fenced code, horizontal rules
 *
 * The model is framework-agnostic (no opentui imports) so it can be unit
 * tested in isolation and reused by other surfaces (web/desktop) later.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; text: string; url: string }

export type Align = "left" | "center" | "right"

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution" | "info"

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; aligns: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: "callout"; kind: CalloutKind; children: Block[] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "blockquote"; children: Block[] }
  | { type: "hr" }

export const CALLOUT_KINDS: CalloutKind[] = ["note", "tip", "important", "warning", "caution", "info"]

const CALLOUT_LABEL: Record<CalloutKind, string> = {
  note: "NOTE",
  tip: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
  caution: "CAUTION",
  info: "INFO",
}

const CALLOUT_GLYPH: Record<CalloutKind, string> = {
  note: "ℹ",
  tip: "✓",
  important: "❗",
  warning: "⚠",
  caution: "⚠",
  info: "ℹ",
}

export function calloutLabel(kind: CalloutKind): string {
  return CALLOUT_LABEL[kind]
}

export function calloutGlyph(kind: CalloutKind): string {
  return CALLOUT_GLYPH[kind]
}

// --- Inline parsing --------------------------------------------------------

function parseInline(input: string): Inline[] {
  const out: Inline[] = []
  let rest = input
  let buffer = ""

  const flush = () => {
    if (buffer) {
      out.push({ type: "text", value: buffer })
      buffer = ""
    }
  }

  while (rest.length > 0) {
    // Inline code
    const code = rest.match(/^`([^`]+)`/)
    if (code) {
      flush()
      out.push({ type: "code", value: code[1] })
      rest = rest.slice(code[0].length)
      continue
    }

    // Link [text](url)
    const link = rest.match(/^\[([^\]]*)\]\(([^)]+)\)/)
    if (link) {
      flush()
      out.push({ type: "link", text: link[1], url: link[2] })
      rest = rest.slice(link[0].length)
      continue
    }

    // Bold **x** or __x__
    const bold = rest.match(/^\*\*([\s\S]+?)\*\*|^__([\s\S]+?)__/)
    if (bold) {
      flush()
      out.push({ type: "bold", children: parseInline(bold[1] ?? bold[2] ?? "") })
      rest = rest.slice(bold[0].length)
      continue
    }

    // Strikethrough ~~x~~
    const strike = rest.match(/^~~([\s\S]+?)~~/)
    if (strike) {
      flush()
      out.push({ type: "strike", children: parseInline(strike[1]) })
      rest = rest.slice(strike[0].length)
      continue
    }

    // Italic *x* or _x_ (avoid eating the leading char of a word)
    const italic = rest.match(/^\*([^\s*][\s\S]*?)\*|^_([^\s_][\s\S]*?)_/)
    if (italic) {
      flush()
      out.push({ type: "italic", children: parseInline(italic[1] ?? italic[2] ?? "") })
      rest = rest.slice(italic[0].length)
      continue
    }

    buffer += rest[0]
    rest = rest.slice(1)
  }

  flush()
  return out
}

export function inlineToPlain(inline: Inline[]): string {
  return inline
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.value
        case "link":
          return node.text || node.url
        default:
          return inlineToPlain(node.children)
      }
    })
    .join("")
}

// --- Block parsing ---------------------------------------------------------

function isHeading(line: string): RegExpMatchArray | null {
  return line.match(/^(#{1,6})\s+(.*)$/)
}

function isHr(line: string): boolean {
  return /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
}

function isFence(line: string): { mark: string; lang: string | null } | null {
  const m = line.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`~]*)\s*$/)
  if (!m) return null
  return { mark: m[2][0], lang: m[3] ? m[3] : null }
}

function listItem(line: string): { ordered: boolean; text: string } | null {
  const unordered = line.match(/^\s*[-*+]\s+(.*)$/)
  if (unordered) return { ordered: false, text: unordered[1] }
  const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
  if (ordered) return { ordered: true, text: ordered[1] }
  return null
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed.split("|").map((cell) => cell.trim())
}

function isTableSeparator(line: string): Align[] | null {
  if (!line.includes("|")) return null
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return null
  const cells = splitTableRow(line)
  if (cells.length === 0 || cells.some((c) => !/^:?-+:?$/.test(c))) return null
  return cells.map((c) => {
    const left = c.startsWith(":")
    const right = c.endsWith(":")
    if (left && right) return "center"
    if (right) return "right"
    return "left"
  })
}

function parseCalloutKind(first: string): CalloutKind | null {
  const m = first.match(/^\s*>?\s*\[!(\w+)\]\s*(.*)$/i)
  if (!m) return null
  const kind = m[1].toLowerCase() as CalloutKind
  return CALLOUT_KINDS.includes(kind) ? kind : null
}

function stripQuote(line: string): string {
  return line.replace(/^\s*>\s?/, "")
}

/**
 * Parse a Markdown document into blocks. Tolerant of partial input.
 */
export function parseMarkdown(input: string): Block[] {
  const lines = (input ?? "").replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line
    if (line.trim() === "") {
      i++
      continue
    }

    // Horizontal rule
    if (isHr(line)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }

    // Fenced code
    const fence = isFence(line)
    if (fence) {
      const lang = fence.lang
      const body: string[] = []
      i++
      while (i < lines.length) {
        const close = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*$/)
        if (close && close[2][0] === fence.mark) {
          i++
          break
        }
        body.push(lines[i])
        i++
      }
      blocks.push({ type: "code", lang, value: body.join("\n") })
      continue
    }

    // Heading
    const heading = isHeading(line)
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2].trim()),
      })
      i++
      continue
    }

    // Block quote / callout
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = []
      let calloutKind: CalloutKind | null = null
      let consumedFirst = false
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const raw = stripQuote(lines[i])
        if (!consumedFirst) {
          calloutKind = parseCalloutKind(raw)
          consumedFirst = true
        }
        quoteLines.push(raw)
        i++
      }
      const inner = quoteLines.join("\n")
      if (calloutKind) {
        blocks.push({ type: "callout", kind: calloutKind, children: parseMarkdown(inner.replace(/^\[!\w+\]\s*/i, "")) })
      } else {
        // A leading "[!X]" without a known kind is treated as a normal quote.
        blocks.push({ type: "blockquote", children: parseMarkdown(inner) })
      }
      continue
    }

    // Table (header + separator)
    if (line.includes("|") && i + 1 < lines.length) {
      const sep = isTableSeparator(lines[i + 1])
      if (sep) {
        const header = splitTableRow(line).map((c) => parseInline(c))
        const rows: Inline[][][] = []
        i += 2
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
          rows.push(splitTableRow(lines[i]).map((c) => parseInline(c)))
          i++
        }
        blocks.push({ type: "table", aligns: sep, header, rows })
        continue
      }
    }

    // List
    const item = listItem(line)
    if (item) {
      const ordered = item.ordered
      const items: Inline[][] = []
      while (i < lines.length) {
        const li = listItem(lines[i])
        if (!li || li.ordered !== ordered) break
        items.push(parseInline(li.text))
        i++
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }

    // Paragraph (gather consecutive non-blank, non-structural lines)
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isHr(lines[i]) &&
      !isHeading(lines[i]) &&
      !isFence(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !listItem(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      para.push(lines[i])
      i++
    }
    if (para.length > 0) {
      blocks.push({ type: "paragraph", children: parseInline(para.join(" ").trim()) })
    } else {
      i++
    }
  }

  return blocks
}
