// Reusable, framework-free code block renderer model for Ottili Coder.
//
// This is the shared surface that paints a single fenced code block across every
// Ottili surface: the TUI chat (hand-rolled `component/markdown` path), the web
// app, and the desktop wrapper. It reuses the dependency-free tokenizer and
// line/selection model from `file-preview-core` so code color is controlled by
// the Ottili `theme.syntax*` palette in exactly one place.
//
// All the logic here is pure (no opentui / Solid / engine imports) so it can be
// unit tested with zero terminal, engine or network access — the same property
// that makes `file-preview-core` testable.

import {
  formatGutter,
  gutterWidth,
  highlightFamily,
  isFilePreviewNarrow,
  lineInSelection,
  normalizeSelection,
  splitFileLines,
  tokenizeFile,
  type FilePreviewSelection,
  type FilePreviewToken,
} from "../file-preview/file-preview-core"
import { redactSensitive } from "../agent-roster/model"

/** Allow-list of highlighter families that may be executed from a code block. */
export const RUNNABLE = new Set(["shell", "bash", "sh", "shellscript", "zsh"])

/**
 * Pure predicate: is a code block with this language execution-eligible?
 * Never auto-runs; the host decides what "execute" means (e.g. pre-fill the
 * prompt so the normal permission flow applies). Unknown/null languages are
 * never eligible.
 */
export function executionAvailable(language: string | null | undefined): boolean {
  if (!language) return false
  return RUNNABLE.has(highlightFamily(language))
}

export type CodeBlockStatus = "populated" | "empty"

/** Derived, memoizable code block state consumed by the view. */
export interface CodeBlockState {
  status: CodeBlockStatus
  language: string | null
  /** Highlight family resolved from `language` (e.g. "python", "shell", "c"). */
  family: string
  lines: string[]
  tokens: FilePreviewToken[][]
  lineCount: number
  gutterWidth: number
  wrap: boolean
  selection: FilePreviewSelection | null
  executionAvailable: boolean
}

export interface CodeBlockInput {
  code: string
  language: string | null
  wrap: boolean
  selection: FilePreviewSelection | null
  /** When true, secret-shaped content is redacted before tokenizing. */
  conceal?: boolean
}

/**
 * Build the full derivable code block state from raw content and view flags.
 * Pure: never mutates the input. When `conceal` is set, the content is first
 * scrubbed by `redactSensitive` so secret-shaped text never reaches the
 * tokenizer or the painted tokens; the header still reports language/count.
 */
export function buildCodeBlockState(input: CodeBlockInput): CodeBlockState {
  const visible = input.conceal ? redactSensitive(input.code).text : input.code
  const lines = splitFileLines(visible)
  const family = highlightFamily(input.language ?? undefined)
  const status: CodeBlockStatus = lines.length === 1 && lines[0] === "" ? "empty" : "populated"
  return {
    status,
    language: input.language,
    family,
    lines,
    tokens: tokenizeFile(lines, input.language ?? undefined),
    lineCount: lines.length,
    gutterWidth: gutterWidth(lines.length),
    wrap: input.wrap,
    selection: normalizeSelection(input.selection),
    executionAvailable: RUNNABLE.has(family),
  }
}

/** Re-export the selection helpers so hosts import a single module. */
export { formatGutter, gutterWidth, highlightFamily, isFilePreviewNarrow, lineInSelection, normalizeSelection, splitFileLines }

/** Public props for the `CodeBlockView` surface. */
export interface CodeBlockProps {
  code: string
  /** Fence language id (e.g. "ts", "python", "bash"). May be null. */
  language?: string | null
  /** When true, secret-shaped content is redacted before painting. */
  conceal?: boolean
  /** Initial wrap state (overridable by the in-block toggle). */
  wrap?: boolean
  /** Initial line selection (1-based range). */
  selection?: FilePreviewSelection | null
  /** Called when the run affordance is activated on a shell-eligible block. */
  onExecute?: (code: string, language: string | null) => void
  /** Accessible label override (defaults to a self-describing label). */
  ariaLabel?: string
}
