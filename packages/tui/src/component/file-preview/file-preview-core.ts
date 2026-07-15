// Reusable, framework-free file preview model and operations for Ottili Coder.
//
// This renders a single file's content as a syntax-highlighted, line-numbered,
// selectable preview with reference markers and large-file behaviour. It is
// the redesigned surface that replaces ad-hoc "cat the file into a box" previews
// in the TUI: any view that wants to show a file (the session file-preview
// dialog, a repo browser, pickers) can adopt it.
//
// The tokenizing highlighter is intentionally dependency-free: it maps a line of
// source into a small, stable set of token kinds that the presentational layer
// colours with the Ottili syntax palette (theme.syntax*). No native renderer or
// network access is required, so the logic is fully unit-testable.

import { filetype } from "../../util/filetype"

// ---------------------------------------------------------------------------
// Token model
// ---------------------------------------------------------------------------

/** Stable token categories understood by the theme palette. */
export type FilePreviewTokenKind =
  | "comment"
  | "keyword"
  | "function"
  | "variable"
  | "string"
  | "number"
  | "type"
  | "operator"
  | "punctuation"
  | "plain"

export type FilePreviewToken = {
  readonly text: string
  readonly kind: FilePreviewTokenKind
}

// ---------------------------------------------------------------------------
// Lifecycle / view state (mirrors the FileTree hardening model)
// ---------------------------------------------------------------------------

export type FilePreviewLifecycleStatus =
  | "loading"
  | "error"
  | "empty"
  | "large"
  | "populated"

export interface FilePreviewContext {
  loading: boolean
  error?: string
}

export interface FilePreviewViewState {
  status: FilePreviewLifecycleStatus
  context: FilePreviewContext
  lineCount: number
  showAll: boolean
  renderBudget: number
}

/** Default maximum number of lines tokenized before a "reveal all" affordance. */
export const FILE_PREVIEW_RENDER_BUDGET_DEFAULT = 2000

/** Terminal width below which the preview drops the gutter padding for compact layouts. */
export const FILE_PREVIEW_NARROW_WIDTH_DEFAULT = 60

export function isFilePreviewNarrow(width: number, threshold = FILE_PREVIEW_NARROW_WIDTH_DEFAULT): boolean {
  return width < threshold
}

/**
 * Classify the preview's top-level state. Transient/blocking states win so the
 * user always sees the most actionable message first.
 */
export function deriveFilePreviewStatus(
  context: FilePreviewContext,
  lineCount: number,
  renderBudget: number,
  showAll: boolean,
): FilePreviewLifecycleStatus {
  if (context.loading) return "loading"
  if (context.error) return "error"
  if (lineCount === 0) return "empty"
  if (!showAll && lineCount > renderBudget) return "large"
  return "populated"
}

export function buildFilePreviewViewState(
  context: FilePreviewContext,
  lineCount: number,
  overrides: { showAll?: boolean; renderBudget?: number } = {},
): FilePreviewViewState {
  const renderBudget = overrides.renderBudget ?? FILE_PREVIEW_RENDER_BUDGET_DEFAULT
  const showAll = overrides.showAll ?? false
  return {
    status: deriveFilePreviewStatus(context, lineCount, renderBudget, showAll),
    context,
    lineCount,
    showAll,
    renderBudget,
  }
}

/** Count of lines tokenized/painted when the render budget is applied. */
export function visibleLineCount(state: FilePreviewViewState): number {
  if (state.showAll) return state.lineCount
  return Math.min(state.lineCount, state.renderBudget)
}

/** Count of lines hidden by the render budget (0 once expanded). */
export function hiddenLineCount(state: FilePreviewViewState): number {
  if (state.showAll) return 0
  return Math.max(0, state.lineCount - state.renderBudget)
}

/** Single-line summary used as the accessible live-region label. */
export function filePreviewSummary(state: FilePreviewViewState): string {
  switch (state.status) {
    case "loading":
      return "File preview: loading…"
    case "error":
      return `File preview: failed to load — ${state.context.error ?? "unknown error"}`
    case "empty":
      return "File preview: No content"
    case "large":
      return `File preview: ${state.lineCount} lines (showing ${state.renderBudget})`
    case "populated":
    default:
      return `File preview: ${state.lineCount} ${state.lineCount === 1 ? "line" : "lines"}`
  }
}

/** Compact marker; colored glyph when color is available, else a bracket tag. */
export function filePreviewLifecycleGlyph(status: FilePreviewLifecycleStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "loading":
        return "…"
      case "error":
        return "✗"
      case "empty":
        return "∅"
      case "large":
        return "▤"
      case "populated":
        return "✓"
    }
  }
  switch (status) {
    case "loading":
      return "[loading]"
    case "error":
      return "[error]"
    case "empty":
      return "[empty]"
    case "large":
      return "[truncated]"
    case "populated":
      return "[ok]"
  }
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

/** Normalise the various ways callers pass file contents into a string. */
export function normalizeFileContents(contents: string | readonly string[] | undefined | null): string {
  if (contents === undefined || contents === null) return ""
  if (typeof contents === "string") return contents
  return contents.join("\n")
}

/** Split contents into lines without dropping a trailing newline's implied final line. */
export function splitFileLines(contents: string): string[] {
  if (contents === "") return [""]
  const lines = contents.split("\n")
  // A trailing newline means the last logical line is empty; keep it so line
  // numbers line up with editors (e.g. "a\n" => ["a", ""]).
  if (contents.endsWith("\n")) lines.push("")
  return lines
}

/** Width of the line-number gutter for a given total line count. */
export function gutterWidth(lineCount: number): number {
  return Math.max(1, String(Math.max(1, lineCount)).length)
}

export function formatGutter(lineNumber: number, width: number): string {
  return String(lineNumber).padStart(width, " ")
}

/** Resolve a language id (loose, from filetype()) into a highlighter family. */
export function highlightFamily(language: string | undefined): string {
  switch (language) {
    case "python":
    case "python-repl":
      return "python"
    case "rust":
      return "rust"
    case "go":
      return "go"
    case "shellscript":
    case "bash":
    case "sh":
    case "shell":
    case "zsh":
      return "shell"
    case "sql":
      return "sql"
    case "yaml":
      return "yaml"
    case "json":
    case "jsonc":
      return "json"
    case "markdown":
      return "markdown"
    default:
      return "c"
  }
}

function lineComment(language: string | undefined): string | undefined {
  switch (highlightFamily(language)) {
    case "python":
    case "shell":
    case "yaml":
      return "#"
    case "sql":
      return "--"
    case "json":
    case "markdown":
      return undefined
    default:
      return "//"
  }
}

function blockComments(language: string | undefined): boolean {
  return highlightFamily(language) === "c"
}

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------

const C_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do",
  "switch", "case", "default", "break", "continue", "new", "class", "extends",
  "implements", "import", "export", "from", "async", "await", "try", "catch",
  "finally", "throw", "typeof", "instanceof", "in", "of", "this", "super",
  "static", "public", "private", "protected", "interface", "type", "enum",
  "namespace", "using", "package", "void", "yield", "delete", "get", "set",
  "abstract", "as", "is", "foreach", "guard", "defer", "go", "select",
  "struct", "trait", "impl", "match", "fn", "mut", "pub", "mod", "where",
  "move", "ref", "dyn", "chan", "map", "range", "fallthrough", "func",
  "elif", "lambda", "with", "raise", "global", "nonlocal", "pass", "assert",
  "not", "and", "or", "del", "then", "fi", "esac", "elif", "until",
])

const C_TYPES = new Set([
  "string", "number", "boolean", "any", "unknown", "never", "object", "void",
  "bigint", "symbol", "int", "float", "double", "char", "byte", "long", "short",
  "uint", "bool", "ubyte", "ushort", "uint", "i8", "i16", "i32", "i64", "u8",
  "u16", "u32", "u64", "f32", "f64", "isize", "usize", "str", "Vec", "Option",
  "Result", "Box", "Rc", "Arc", "String", "Self", "self", "List", "Dict",
  "Set", "Tuple", "Promise", "Array", "Map", "Record", "Readonly",
])

const C_LITERALS = new Set([
  "true", "false", "null", "undefined", "nil", "none", "none", "nan", "inf",
])

const KEYWORDS: Record<string, Set<string>> = {
  c: C_KEYWORDS,
  python: new Set([
    "def", "class", "return", "if", "elif", "else", "for", "while", "import",
    "from", "as", "with", "try", "except", "finally", "raise", "lambda",
    "yield", "global", "nonlocal", "pass", "break", "continue", "in", "is",
    "not", "and", "or", "del", "assert", "async", "await", "match", "case",
  ]),
  rust: new Set([
    "fn", "let", "mut", "pub", "use", "mod", "struct", "enum", "impl", "trait",
    "match", "if", "else", "for", "while", "loop", "return", "self", "where",
    "async", "await", "move", "ref", "dyn", "as", "in", "of", "type",
  ]),
  go: new Set([
    "func", "package", "import", "var", "const", "type", "struct", "interface",
    "map", "chan", "go", "defer", "return", "if", "else", "for", "range",
    "switch", "case", "break", "continue", "select", "fallthrough", "default",
  ]),
  shell: new Set([
    "if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case",
    "esac", "function", "in", "of", "select", "until",
  ]),
  sql: new Set([
    "select", "from", "where", "insert", "into", "values", "update", "set",
    "delete", "create", "table", "drop", "alter", "join", "left", "right",
    "inner", "outer", "on", "group", "by", "order", "having", "limit", "as",
    "and", "or", "not", "null", "is", "in", "distinct", "count", "sum", "avg",
    "min", "max",
  ]),
}

function keywordSet(family: string): Set<string> {
  return KEYWORDS[family] ?? C_KEYWORDS
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9"
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$"
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

const OPERATOR_CHARS = new Set(["=", "+", "-", "*", "/", "%", "&", "|", "^", "!", "?", ":", "~", "<", ">"])

function isPunct(ch: string): boolean {
  return ch === "{" || ch === "}" || ch === "(" || ch === ")" || ch === "[" || ch === "]" ||
    ch === ";" || ch === "," || ch === "." || ch === "@" || ch === "#" || ch === "\\"
}

function peekNonSpace(line: string, from: number): string | undefined {
  let i = from
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++
  return line[i]
}

function classifyIdentifier(word: string, family: string): FilePreviewTokenKind {
  const lower = word.toLowerCase()
  if (C_LITERALS.has(lower)) return "keyword"
  const keywords = keywordSet(family)
  if (keywords.has(word) || (family === "c" && C_KEYWORDS.has(word))) return "keyword"
  // Heuristic type detection: capitalized identifiers are almost always types
  // or constructors in the languages we support.
  if (/^[A-Z]/.test(word)) return "type"
  return "variable"
}

function scanString(line: string, start: number, quote: string): { text: string; end: number } {
  let i = start + 1
  while (i < line.length) {
    const ch = line[i]!
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === quote) {
      i++
      break
    }
    i++
  }
  return { text: line.slice(start, i), end: i }
}

function scanNumber(line: string, start: number): { text: string; end: number } {
  let i = start
  if (line[i] === "0" && (line[i + 1] === "x" || line[i + 1] === "X" || line[i + 1] === "b" || line[i + 1] === "o")) {
    i += 2
    while (i < line.length && /[0-9a-fA-F_]/.test(line[i]!)) i++
    return { text: line.slice(start, i), end: i }
  }
  while (i < line.length && (isDigit(line[i]!) || line[i] === "_")) i++
  if (line[i] === "." && isDigit(line[i + 1] ?? "")) {
    i++
    while (i < line.length && (isDigit(line[i]!) || line[i] === "_")) i++
  }
  if (line[i] === "e" || line[i] === "E") {
    let j = i + 1
    if (line[j] === "+" || line[j] === "-") j++
    if (isDigit(line[j] ?? "")) {
      i = j + 1
      while (i < line.length && isDigit(line[i]!)) i++
    }
  }
  if (line[i] === "n" || line[i] === "f" || line[i] === "u" || line[i] === "l" || line[i] === "i" || line[i] === "d") i++
  return { text: line.slice(start, i), end: i }
}

function scanIdentifier(line: string, start: number): { text: string; end: number } {
  let i = start
  while (i < line.length && isIdentPart(line[i]!)) i++
  return { text: line.slice(start, i), end: i }
}

/** Tokenize a single line of source into styled tokens. */
export function tokenizeLine(line: string, language: string | undefined): FilePreviewToken[] {
  const family = highlightFamily(language)
  const comment = lineComment(language)
  const block = blockComments(language)
  const tokens: FilePreviewToken[] = []
  const n = line.length
  let i = 0

  while (i < n) {
    const ch = line[i]!

    if (comment && line.startsWith(comment, i)) {
      tokens.push({ text: line.slice(i), kind: "comment" })
      return tokens
    }

    if (block && line.startsWith("/*", i)) {
      const end = line.indexOf("*/", i + 2)
      if (end === -1) {
        tokens.push({ text: line.slice(i), kind: "comment" })
        return tokens
      }
      tokens.push({ text: line.slice(i, end + 2), kind: "comment" })
      i = end + 2
      continue
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const str = scanString(line, i, ch)
      tokens.push({ text: str.text, kind: "string" })
      i = str.end
      continue
    }

    if (isDigit(ch) || (ch === "." && isDigit(line[i + 1] ?? ""))) {
      const num = scanNumber(line, i)
      tokens.push({ text: num.text, kind: "number" })
      i = num.end
      continue
    }

    if (isIdentStart(ch)) {
      const id = scanIdentifier(line, i)
      let kind = classifyIdentifier(id.text, family)
      const after = peekNonSpace(line, id.end)
      if (kind === "variable" && after === "(") kind = "function"
      tokens.push({ text: id.text, kind })
      i = id.end
      continue
    }

    if (OPERATOR_CHARS.has(ch)) {
      tokens.push({ text: ch, kind: "operator" })
      i++
      continue
    }

    if (isPunct(ch)) {
      tokens.push({ text: ch, kind: "punctuation" })
      i++
      continue
    }

    // Whitespace and any other character: consume a run as plain text.
    let j = i
    while (j < n) {
      const c = line[j]!
      if (
        (comment && line.startsWith(comment, j)) ||
        (block && line.startsWith("/*", j)) ||
        c === '"' || c === "'" || c === "`" ||
        isDigit(c) || isIdentStart(c) || OPERATOR_CHARS.has(c) || isPunct(c)
      ) {
        break
      }
      j++
    }
    if (j === i) j = i + 1
    tokens.push({ text: line.slice(i, j), kind: "plain" })
    i = j
  }

  if (tokens.length === 0) tokens.push({ text: line, kind: "plain" })
  return tokens
}

/** Tokenize a whole file, capped at `limit` lines (keeps large files cheap). */
export function tokenizeFile(
  lines: readonly string[],
  language: string | undefined,
  limit = Number.POSITIVE_INFINITY,
): FilePreviewToken[][] {
  const count = Math.min(lines.length, limit)
  const result: FilePreviewToken[][] = new Array(count)
  for (let index = 0; index < count; index++) {
    result[index] = tokenizeLine(lines[index]!, language)
  }
  return result
}

// ---------------------------------------------------------------------------
// Selection model
// ---------------------------------------------------------------------------

export type FilePreviewSelection = {
  readonly start: number
  readonly end: number
}

export function normalizeSelection(selection: FilePreviewSelection | null | undefined): FilePreviewSelection | null {
  if (!selection) return null
  const start = Math.min(selection.start, selection.end)
  const end = Math.max(selection.start, selection.end)
  if (start < 1 || end < start) return null
  return { start, end }
}

export function lineInSelection(selection: FilePreviewSelection | null | undefined, line: number): boolean {
  const normalized = normalizeSelection(selection)
  if (!normalized) return false
  return line >= normalized.start && line <= normalized.end
}

// ---------------------------------------------------------------------------
// References model
// ---------------------------------------------------------------------------

export type FilePreviewReference = {
  /** 1-based line number the reference points at. */
  readonly line: number
  /** Human-readable label shown in the references gutter/list. */
  readonly label: string
  /** Optional extra context shown alongside the label. */
  readonly detail?: string
}

/** References that target a given line (used to mark the gutter). */
export function referencesForLine(references: readonly FilePreviewReference[], line: number): FilePreviewReference[] {
  return references.filter((reference) => reference.line === line)
}

/**
 * Scan a single file's contents for a query and return references (one per
 * matching line with a trimmed snippet). Pure and bounded.
 */
export function scanReferences(
  contents: string | readonly string[] | undefined,
  query: string,
): FilePreviewReference[] {
  const needle = query.trim()
  if (needle === "") return []
  const lines = splitFileLines(normalizeFileContents(contents))
  const references: FilePreviewReference[] = []
  lines.forEach((line, index) => {
    const at = line.indexOf(needle)
    if (at === -1) return
    references.push({
      line: index + 1,
      label: needle,
      detail: line.trim().slice(0, 120),
    })
  })
  return references
}

export type FilePreviewCorpusEntry = {
  readonly path: string
  readonly contents: string | readonly string[] | undefined
}

/** Scan a corpus of files for a query, returning only files with matches. */
export function scanReferencesInCorpus(
  files: readonly FilePreviewCorpusEntry[],
  query: string,
): { path: string; references: FilePreviewReference[] }[] {
  const needle = query.trim()
  if (needle === "") return []
  const result: { path: string; references: FilePreviewReference[] }[] = []
  for (const file of files) {
    const references = scanReferences(file.contents, needle)
    if (references.length > 0) result.push({ path: file.path, references })
  }
  return result
}

// ---------------------------------------------------------------------------
// Language resolution helper (re-exported for callers)
// ---------------------------------------------------------------------------

export function languageFromFile(path: string | undefined): string | undefined {
  return filetype(path)
}
