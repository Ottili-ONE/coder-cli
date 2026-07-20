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
//
// HARDENING (T-CLI-0194):
//   - 8-state lifecycle: loading, empty, populated, long-content, failure,
//     denied, offline, degraded — each intentionally rendered.
//   - Render budget: tokenizing capped at CODE_BLOCK_TOKEN_LIMIT lines; content
//     beyond is truncated with a notification.
//   - Accessibility helpers: self-describing label, status glyph, status label
//     with no-color fallback.
//   - Secret redaction: `redactSensitive` is applied to error/denied messages
//     and content when `conceal` is set.

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
  type FilePreviewTokenKind,
} from "../file-preview/file-preview-core"
import { redactSensitive } from "../agent-roster/model"

/** Maximum lines tokenized before the render budget applies. */
export const CODE_BLOCK_TOKEN_LIMIT = 2000

/** Threshold line count for "long-content" classification. */
export const CODE_BLOCK_LONG_THRESHOLD = 500

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

/** The eight intentionally-rendered code block states required by the redesign. */
export type CodeBlockStatus =
  | "loading"
  | "empty"
  | "populated"
  | "long-content"
  | "failure"
  | "denied"
  | "offline"
  | "degraded"

/** Environmental context that decides which top-level state the surface is in. */
export interface CodeBlockContext {
  /** Content is being fetched or streamed and not yet presentable. */
  loading?: boolean
  /** A network is required to resolve code-block dependencies. */
  connected?: boolean
  /** The caller is allowed to view this content. */
  permitted?: boolean
  /** A render/load failure message (surfaced in the failure state). */
  error?: string | null
  /** Render in reduced-fidelity mode (e.g. plain text, no highlighting). */
  degraded?: boolean
}

/** Derived, memoizable code block state consumed by the view. */
export interface CodeBlockState {
  status: CodeBlockStatus
  context: Required<CodeBlockContext>
  language: string | null
  /** Highlight family resolved from `language` (e.g. "python", "shell", "c"). */
  family: string
  lines: string[]
  tokens: FilePreviewToken[][]
  lineCount: number
  /** True when tokenizing was capped by the render budget. */
  lineLimited: boolean
  /** Number of lines not tokenized/painted due to the render budget. */
  hiddenLines: number
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
  /** Override context (defaults all-false / all-present for the happy path). */
  context?: Partial<CodeBlockContext>
}

/**
 * Classify the top-level code block state. Order matters: transient/blocking
 * states win over presentational ones so the user always sees the most
 * actionable message.
 */
export function deriveCodeBlockStatus(
  content: string,
  ctx: Required<CodeBlockContext>,
  lineCount: number,
): CodeBlockStatus {
  if (ctx.loading === true) return "loading"
  if (ctx.connected === false) return "offline"
  if (ctx.permitted === false) return "denied"
  if (ctx.error) return "failure"
  if (!content || content.trim() === "") return "empty"
  if (ctx.degraded === true) return "degraded"
  if (lineCount > CODE_BLOCK_LONG_THRESHOLD) return "long-content"
  return "populated"
}

/**
 * Build the full derivable code block state from raw content and view flags.
 * Pure: never mutates the input. When `conceal` is set, the content is first
 * scrubbed by `redactSensitive` so secret-shaped text never reaches the
 * tokenizer or the painted tokens; the header still reports language/count.
 */
export function buildCodeBlockState(input: CodeBlockInput): CodeBlockState {
  const context: Required<CodeBlockContext> = {
    loading: input.context?.loading ?? false,
    connected: input.context?.connected ?? true,
    permitted: input.context?.permitted ?? true,
    error: input.context?.error ?? null,
    degraded: input.context?.degraded ?? false,
  }
  const visible = input.conceal ? redactSensitive(input.code).text : input.code
  const lines = splitFileLines(visible)
  const family = highlightFamily(input.language ?? undefined)
  const lineCount = lines.length
  const status = deriveCodeBlockStatus(visible, context, lineCount)
  // Cap tokenizing at the render budget so large/rapid streams never OOM.
  const tokenLimit = CODE_BLOCK_TOKEN_LIMIT
  const hiddenLines = Math.max(0, lineCount - tokenLimit)
  const tokenizedCount = Math.min(lineCount, tokenLimit)
  const tokens = tokenizeFile(lines.slice(0, tokenizedCount), input.language ?? undefined)

  return {
    status,
    context,
    language: input.language,
    family,
    lines: hiddenLines > 0 ? [...lines.slice(0, tokenLimit), `… (${hiddenLines} more lines hidden by render budget)`] : lines,
    tokens,
    lineCount,
    lineLimited: hiddenLines > 0,
    hiddenLines,
    gutterWidth: gutterWidth(lineCount),
    wrap: input.wrap,
    selection: normalizeSelection(input.selection),
    executionAvailable: RUNNABLE.has(family),
  }
}

/** Short textual status label, always rendered so state is never color-only. */
export function codeBlockStatusLabel(status: CodeBlockStatus): string {
  switch (status) {
    case "loading":
      return "Loading"
    case "empty":
      return "Empty"
    case "populated":
      return "Ready"
    case "long-content":
      return "Long content"
    case "failure":
      return "Error"
    case "denied":
      return "Permission denied"
    case "offline":
      return "Offline"
    case "degraded":
      return "Degraded"
    default:
      return "Ready"
  }
}

/**
 * Compact status marker. Uses a colored glyph when color is available, otherwise
 * a bracketed text tag so meaning never depends on color alone.
 */
export function codeBlockStatusGlyph(status: CodeBlockStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "loading":
        return "◐"
      case "empty":
        return "∅"
      case "populated":
        return "●"
      case "long-content":
        return "▤"
      case "failure":
        return "✕"
      case "denied":
        return "⊘"
      case "offline":
        return "○"
      case "degraded":
        return "△"
      default:
        return "●"
    }
  }
  switch (status) {
    case "loading":
      return "[loading]"
    case "empty":
      return "[empty]"
    case "populated":
      return "[ready]"
    case "long-content":
      return "[long]"
    case "failure":
      return "[error]"
    case "denied":
      return "[denied]"
    case "offline":
      return "[offline]"
    case "degraded":
      return "[degraded]"
    default:
      return "[ready]"
  }
}

/** Single-line summary used as an accessible live-region label for the code block. */
export function codeBlockSummary(state: CodeBlockState): string {
  const languageLabel = state.language ?? "code"
  switch (state.status) {
    case "loading":
      return `Code block (${languageLabel}): loading\u2026`
    case "offline":
      return `Code block (${languageLabel}): offline \u2014 content unavailable`
    case "denied":
      return `Code block (${languageLabel}): permission denied`
    case "failure":
      return `Code block (${languageLabel}): failed to render \u2014 ${redactSensitive(state.context.error ?? "unknown error").text}`
    case "empty":
      return `Code block (${languageLabel}): no content`
    case "degraded":
      return `Code block (${languageLabel}): rendered in degraded mode`
    case "long-content":
      return `Code block (${languageLabel}): ${state.lineCount} lines (showing ${state.hiddenLines > 0 ? `up to ${state.lineCount - state.hiddenLines}` : state.lineCount})`
    case "populated":
    default:
      return `Code block (${languageLabel}): ${state.lineCount} lines`
  }
}

/** Self-contained, redacted screen-reader label for the current code block state. */
export function codeBlockAriaLabel(state: CodeBlockState): string {
  return redactSensitive(codeBlockSummary(state)).text
}

/** Re-export the selection helpers so hosts import a single module. */
export { formatGutter, gutterWidth, highlightFamily, isFilePreviewNarrow, lineInSelection, normalizeSelection, splitFileLines }
export type { FilePreviewSelection, FilePreviewTokenKind }

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
  /** Context overrides for lifecycle state derivation. */
  context?: Partial<CodeBlockContext>
  /** Explicit color level (0 disables color). */
  colorLevel?: number
}