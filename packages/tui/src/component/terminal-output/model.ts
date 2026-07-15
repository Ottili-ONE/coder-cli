/**
 * Terminal output domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of rendering or SDK dependencies so the
 * terminal output logic can be unit tested in isolation and reused by the
 * Solid component in `./index.tsx`. Every transition is pure: it takes inputs
 * and returns new values, which keeps the data flow deterministic and
 * snapshot-free in tests.
 *
 * The model is the single source of truth for the redesigned terminal output:
 * ANSI-safe streaming logs, folding of long output, substring search, copy of
 * the focused line, failure emphasis and the lifecycle state transitions
 * (empty → streaming → complete, plus the failure path).
 */

import stripAnsi from "strip-ansi"
import { redactSensitive } from "../agent-roster/model"

/** Severity of a single streamed line, used for failure emphasis. */
export type LineLevel = "info" | "warn" | "error"

/**
 * A single rendered line of terminal output. `raw` may still contain ANSI
 * escapes (it is what the stream produced); `text` is the ANSI-stripped,
 * display-safe form. Keeping both lets the model strip escapes once and the
 * view stay faithful to the original content.
 */
export interface TerminalLine {
  id: number
  raw: string
  text: string
  level: LineLevel
  /** Internal fold marker inserted between the head and tail when folded. */
  isFoldMarker?: boolean
}

/** Lifecycle of the terminal output pane. */
export type TerminalOutputStatus =
  | "empty"
  | "streaming"
  | "complete"
  | "failure"

/** Environmental context that decides which top-level state the pane is in. */
export interface TerminalOutputContext {
  complete: boolean
  failure?: string
}

/** Derivable, memoizable terminal output state consumed by the component. */
export interface TerminalOutputState {
  lines: TerminalLine[]
  status: TerminalOutputStatus
  query: string
  searching: boolean
  folded: boolean
  selectedId: number | null
  currentMatch: number | null
  context: TerminalOutputContext
}

export interface TerminalOutputOverrides {
  query?: string
  searching?: boolean
  folded?: boolean
  selectedId?: number | null
  currentMatch?: number | null
}

/** Default number of lines kept at the top when output is folded. */
export const FOLD_HEAD_DEFAULT = 8

/** Default number of lines kept at the bottom when output is folded. */
export const FOLD_TAIL_DEFAULT = 4

/** Terminal width below which lines are truncated to preserve layout. */
export const NARROW_WIDTH_DEFAULT = 60

/** Marker substituted for redacted secrets in failure messages. */
export const REDACTION_MARKER = "••••"

const WARN_PATTERN = /\b(warn|warning|deprecated|caution|attempt|retry)\b/i
const ERROR_PATTERN =
  /\b(error|err|failed|failure|exception|traceback|fatal|panic|denied|refused|abort|timed?\s*out|✗|✘|cannot|unable|undefined is not)\b/i

/** Strip ANSI escape sequences so the displayed text is always safe to render. */
export function stripAnsiLine(raw: string): string {
  return stripAnsi(raw ?? "")
}

/**
 * Classify a line's severity from its ANSI-stripped text. Detection is
 * conservative: it matches explicit error/warn vocabulary and a few symbolic
 * markers. Pure and total — never throws.
 */
export function classifyLine(text: string): LineLevel {
  const clean = stripAnsiLine(text)
  if (ERROR_PATTERN.test(clean)) return "error"
  if (WARN_PATTERN.test(clean)) return "warn"
  return "info"
}

/** Build a presentable line from a raw stream chunk, stripping and classifying it. */
export function buildTerminalLine(id: number, raw: string): TerminalLine {
  const text = stripAnsiLine(raw)
  return { id, raw, text, level: classifyLine(text) }
}

/** Build a synthetic fold marker line shown between the head and tail. */
export function foldMarkerLine(hidden: number): TerminalLine {
  return {
    id: -1,
    raw: "",
    text: `${hidden} lines hidden — press space to expand`,
    level: "info",
    isFoldMarker: true,
  }
}

/**
 * Classify the pane's top-level state. A failure message wins over everything
 * (the user must see why the stream died); otherwise streaming/complete depend
 * on whether more output is expected, and empty is the resting state.
 */
export function deriveStatus(lines: TerminalLine[], context: TerminalOutputContext): TerminalOutputStatus {
  if (context.failure) return "failure"
  if (lines.length === 0) return "empty"
  if (context.complete) return "complete"
  return "streaming"
}

/** Count of lines matching a case-insensitive substring query. */
export function matchCount(lines: TerminalLine[], query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  return lines.filter((line) => line.text.toLowerCase().includes(q)).length
}

/**
 * Fold long output: keep the first `headLines` and last `tailLines` lines and
 * collapse the middle behind a marker. Returns the visible lines, the number of
 * hidden lines, and whether folding is even applicable.
 */
export function foldLines(
  lines: TerminalLine[],
  opts: { folded: boolean; headLines?: number; tailLines?: number },
): { lines: TerminalLine[]; hidden: number; collapsible: boolean } {
  const headLines = opts.headLines ?? FOLD_HEAD_DEFAULT
  const tailLines = opts.tailLines ?? FOLD_TAIL_DEFAULT
  const collapsible = lines.length > headLines + tailLines + 1
  if (!opts.folded || !collapsible) {
    return { lines, hidden: 0, collapsible }
  }
  const head = lines.slice(0, headLines)
  const tail = lines.slice(lines.length - tailLines)
  const hidden = lines.length - head.length - tail.length
  return { lines: [...head, foldMarkerLine(hidden), ...tail], hidden, collapsible }
}

/** Resolve the lines the user should currently see (search narrows, then fold). */
export function visibleLines(
  state: TerminalOutputState,
  opts: { headLines?: number; tailLines?: number; narrowWidth?: number } = {},
): { lines: TerminalLine[]; hidden: number; total: number; matched: number } {
  const total = state.lines.length
  const matched = matchCount(state.lines, state.query)
  // While searching we never fold — the user wants every match in order.
  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase()
    const lines = state.lines.filter((line) => line.text.toLowerCase().includes(q))
    return { lines, hidden: 0, total, matched }
  }
  const folded = foldLines(state.lines, {
    folded: state.folded,
    headLines: opts.headLines,
    tailLines: opts.tailLines,
  })
  return { lines: folded.lines, hidden: folded.hidden, total, matched }
}

export function buildState(
  inputs: TerminalLine[],
  context: TerminalOutputContext,
  overrides: TerminalOutputOverrides = {},
): TerminalOutputState {
  return {
    lines: inputs,
    status: deriveStatus(inputs, context),
    query: overrides.query ?? "",
    searching: overrides.searching ?? false,
    folded: overrides.folded ?? true,
    selectedId: overrides.selectedId ?? null,
    currentMatch: overrides.currentMatch ?? null,
    context,
  }
}

/** Visible line ids, in display order, used for selection clamping. */
export function visibleIds(state: TerminalOutputState, opts: { headLines?: number; tailLines?: number } = {}): number[] {
  return visibleLines(state, opts).lines
    .filter((line) => !line.isFoldMarker)
    .map((line) => line.id)
}

/**
 * Selection that stays valid across streaming updates and folding. If the stored
 * selection is no longer visible, it falls back to the first visible row. This
 * keeps focus from being lost or trapped as output streams in.
 */
export function effectiveSelection(state: TerminalOutputState, opts: { headLines?: number; tailLines?: number } = {}): number | null {
  const ids = visibleIds(state, opts)
  if (ids.length === 0) return null
  if (state.selectedId !== null && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

/** Move the selection by `direction` (-1 up, 1 down), clamped to visible rows. */
export function moveSelection(
  state: TerminalOutputState,
  direction: 1 | -1,
  opts: { headLines?: number; tailLines?: number } = {},
): number | null {
  const ids = visibleIds(state, opts)
  if (ids.length === 0) return null
  const current = effectiveSelection(state, opts)
  const index = current !== null ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

/** A terminal is "narrow" when long lines must be truncated to preserve layout. */
export function isNarrow(width: number, threshold = NARROW_WIDTH_DEFAULT): boolean {
  return width < threshold
}

/** Truncate a single line to fit a narrow terminal without dropping its meaning. */
export function truncateLine(line: TerminalLine, max: number): TerminalLine {
  if (line.isFoldMarker) return line
  if (line.text.length <= max) return line
  if (max <= 1) return { ...line, text: line.text.slice(0, Math.max(0, max)) }
  return { ...line, text: line.text.slice(0, max - 1) + "…" }
}

/** Single-line summary used as the accessible live-region label and header. */
export function terminalSummary(state: TerminalOutputState): string {
  const total = state.lines.length
  const matched = matchCount(state.lines, state.query)
  switch (state.status) {
    case "empty":
      return "Terminal output: no output yet"
    case "streaming":
      return `Terminal output: streaming (${total} lines)`
    case "complete":
      if (state.query.trim()) return `Terminal output: ${matched} of ${total} lines match “${state.query.trim()}”`
      return `Terminal output: ${total} ${total === 1 ? "line" : "lines"}`
    case "failure":
      return `Terminal output: stream failed — ${redactSensitive(state.context.failure ?? "unknown error").text}`
  }
}

/** Redact secrets from a failure message so it can be shown safely. */
export function redactFailure(message: string): string {
  return redactSensitive(message).text
}
