/**
 * File preview domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of rendering or SDK dependencies so the
 * file preview logic can be unit tested in isolation and reused by the Solid
 * component in `./index.tsx`. Every transition is pure: it takes inputs and
 * returns new values, which keeps the data flow deterministic and
 * snapshot-free in tests.
 *
 * The model is the single source of truth for the redesigned file preview. It
 * owns the full lifecycle of states a file preview can be in:
 *
 *   loading    — content is still being read/streamed in
 *   empty      — loaded successfully but the file has no content
 *   populated  — normal, fully renderable content
 *   long       — content exceeds the render budget and is folded
 *   failure    — the read failed (message is redacted before display)
 *   denied     — the file exists but access was refused (permission)
 *   offline    — the file could not be fetched because the host is offline
 *   degraded   — content is shown at reduced fidelity (binary/limited color)
 *
 * plus accessibility semantics, terminal fallbacks (narrow / no-color) and the
 * performance-safe render budget (long content is folded, not dumped).
 */

import stripAnsi from "strip-ansi"
import { redactSensitive } from "../agent-roster/model"

/** Severity cue for an individual preview line, used for subtle emphasis. */
export type LineLevel = "info" | "warn" | "error"

/**
 * A single rendered line of a file preview. `text` is the ANSI-stripped,
 * display-safe form. Keeping the cleaned form lets the view stay faithful to
 * the original content without leaking escape sequences.
 */
export interface FilePreviewLine {
  id: number
  text: string
  level: LineLevel
  /** Internal fold marker inserted between the head and tail when folded. */
  isFoldMarker?: boolean
}

/** Lifecycle of the file preview pane. */
export type FilePreviewStatus =
  | "loading"
  | "empty"
  | "populated"
  | "long"
  | "failure"
  | "denied"
  | "offline"
  | "degraded"

/** Environmental context that decides which top-level state the pane is in. */
export interface FilePreviewContext {
  /** True while content is still being read/streamed. */
  loading?: boolean
  /** A read failure reason; present => the failure path is rendered. */
  failure?: string
  /** Access was refused by the filesystem/permission layer. */
  denied?: boolean
  /** The source is unreachable (host offline / remote fetch failed to connect). */
  offline?: boolean
  /** Content is shown at reduced fidelity and cannot be displayed fully. */
  degraded?: boolean
  /** Human-readable reason the preview is degraded (binary, limited terminal…). */
  degradedReason?: string
}

/** Derivable, memoizable file preview state consumed by the component. */
export interface FilePreviewState {
  /** Lines after the safety cap is applied (never more than the budget). */
  lines: FilePreviewLine[]
  /** Raw line count before the safety cap, for accurate summaries. */
  totalRaw: number
  /** True when the original content exceeded the safety cap. */
  capped: boolean
  status: FilePreviewStatus
  query: string
  searching: boolean
  folded: boolean
  selectedId: number | null
  currentMatch: number | null
  context: FilePreviewContext
}

export interface FilePreviewOverrides {
  query?: string
  searching?: boolean
  folded?: boolean
  selectedId?: number | null
  currentMatch?: number | null
}

/** Default number of lines kept at the top when content is folded. */
export const PREVIEW_HEAD_DEFAULT = 12

/** Default number of lines kept at the bottom when content is folded. */
export const PREVIEW_TAIL_DEFAULT = 6

/** Hard safety cap: never hand the renderer more than this many lines. */
export const PREVIEW_MAX_LINES_DEFAULT = 5000

/** Line count above which content is considered "long" and folded by default. */
export const PREVIEW_LONG_THRESHOLD = PREVIEW_HEAD_DEFAULT + PREVIEW_TAIL_DEFAULT + 1

/** Terminal width below which lines are truncated to preserve layout. */
export const NARROW_WIDTH_DEFAULT = 60

/** Marker substituted for redacted secrets in failure/denied messages. */
export const REDACTION_MARKER = "••••"

const WARN_PATTERN = /\b(warn|warning|deprecated|caution|todo|fixme|attempt|retry)\b/i
const ERROR_PATTERN =
  /\b(error|err|failed|failure|exception|traceback|fatal|panic|denied|refused|abort|timed?\s*out|✗|✘|cannot|unable|cannot read)\b/i

/** Strip ANSI escape sequences so the displayed text is always safe to render. */
export function stripAnsiLine(raw: string): string {
  return stripAnsi(raw ?? "")
}

/**
 * Classify a line's severity from its ANSI-stripped text. Detection is
 * conservative and mirrors the terminal-output model so log-like file content
 * is emphasized consistently. Pure and total — never throws.
 */
export function classifyLine(text: string): LineLevel {
  const clean = stripAnsiLine(text)
  if (ERROR_PATTERN.test(clean)) return "error"
  if (WARN_PATTERN.test(clean)) return "warn"
  return "info"
}

/** Build a presentable line from a raw chunk, stripping and classifying it. */
export function buildPreviewLine(id: number, raw: string): FilePreviewLine {
  const text = stripAnsiLine(raw)
  return { id, text, level: classifyLine(text) }
}

/** Build a synthetic fold marker line shown between the head and tail. */
export function foldMarkerLine(hidden: number): FilePreviewLine {
  return {
    id: -1,
    text: `${hidden} lines hidden — press space to expand`,
    level: "info",
    isFoldMarker: true,
  }
}

/**
 * Cap the number of lines handed to the renderer. Above the safety cap we keep
 * the head and tail and replace the middle with a single marker so a malicious
 * or accidental multi-megabyte dump cannot stall the UI (render budget).
 */
export function capLines(
  lines: FilePreviewLine[],
  maxLines = PREVIEW_MAX_LINES_DEFAULT,
): { lines: FilePreviewLine[]; capped: boolean; dropped: number } {
  if (lines.length <= maxLines) return { lines, capped: false, dropped: 0 }
  // Reserve one slot for the fold marker so the result stays within the budget.
  const budget = maxLines - 1
  const head = lines.slice(0, Math.ceil(budget / 2))
  const tail = lines.slice(lines.length - Math.floor(budget / 2))
  const dropped = lines.length - head.length - tail.length
  return { lines: [...head, foldMarkerLine(dropped), ...tail], capped: true, dropped }
}

/**
 * Classify the pane's top-level state. Blockers win in priority order
 * (denied → offline → failure → loading) so the user always sees why content
 * is missing before any content. Once blockers are clear, the content state is
 * picked by emptiness, degradation, or render-budget length.
 */
export function deriveStatus(lines: FilePreviewLine[], context: FilePreviewContext): FilePreviewStatus {
  if (context.denied) return "denied"
  if (context.offline) return "offline"
  if (context.failure) return "failure"
  if (context.loading) return "loading"
  if (lines.length === 0) return "empty"
  if (context.degraded) return "degraded"
  if (lines.length > PREVIEW_LONG_THRESHOLD) return "long"
  return "populated"
}

/** Count of lines matching a case-insensitive substring query. */
export function matchCount(lines: FilePreviewLine[], query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  return lines.filter((line) => line.text.toLowerCase().includes(q)).length
}

/**
 * Fold long content: keep the first `headLines` and last `tailLines` lines and
 * collapse the middle behind a marker. Returns the visible lines, the number of
 * hidden lines, and whether folding is even applicable. This is the primary
 * render-budget safeguard for large files.
 */
export function foldLines(
  lines: FilePreviewLine[],
  opts: { folded: boolean; headLines?: number; tailLines?: number },
): { lines: FilePreviewLine[]; hidden: number; collapsible: boolean } {
  const headLines = opts.headLines ?? PREVIEW_HEAD_DEFAULT
  const tailLines = opts.tailLines ?? PREVIEW_TAIL_DEFAULT
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
  state: FilePreviewState,
  opts: { headLines?: number; tailLines?: number; narrowWidth?: number } = {},
): { lines: FilePreviewLine[]; hidden: number; total: number; matched: number; capped: boolean } {
  const total = state.totalRaw
  const matched = matchCount(state.lines, state.query)
  const headLines = opts.headLines ?? PREVIEW_HEAD_DEFAULT
  const tailLines = opts.tailLines ?? PREVIEW_TAIL_DEFAULT
  // While searching we never fold — the user wants every match in order.
  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase()
    const filtered = state.lines.filter((line) => line.text.toLowerCase().includes(q))
    // Even while searching, an expanded view of a huge file stays bounded.
    const safe = state.folded ? filtered : capLines(filtered).lines
    return { lines: safe, hidden: 0, total, matched, capped: state.capped }
  }
  if (state.folded) {
    const folded = foldLines(state.lines, { folded: true, headLines, tailLines })
    return { lines: folded.lines, hidden: folded.hidden, total, matched, capped: state.capped }
  }
  // Expanded: enforce the hard safety cap so a giant file still renders.
  const safe = capLines(state.lines)
  return { lines: safe.lines, hidden: safe.capped ? safe.dropped : 0, total, matched, capped: state.capped }
}

export function buildState(
  inputs: FilePreviewLine[],
  context: FilePreviewContext,
  overrides: FilePreviewOverrides = {},
): FilePreviewState {
  return {
    lines: inputs,
    totalRaw: inputs.length,
    capped: inputs.length > PREVIEW_MAX_LINES_DEFAULT,
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
export function visibleIds(state: FilePreviewState, opts: { headLines?: number; tailLines?: number } = {}): number[] {
  return visibleLines(state, opts).lines
    .filter((line) => !line.isFoldMarker)
    .map((line) => line.id)
}

/**
 * Selection that stays valid across streaming updates and folding. If the stored
 * selection is no longer visible, it falls back to the first visible row. This
 * keeps focus from being lost or trapped as content streams in.
 */
export function effectiveSelection(state: FilePreviewState, opts: { headLines?: number; tailLines?: number } = {}): number | null {
  const ids = visibleIds(state, opts)
  if (ids.length === 0) return null
  if (state.selectedId !== null && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

/** Move the selection by `direction` (-1 up, 1 down), clamped to visible rows. */
export function moveSelection(
  state: FilePreviewState,
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
export function truncateLine(line: FilePreviewLine, max: number): FilePreviewLine {
  if (line.isFoldMarker) return line
  if (line.text.length <= max) return line
  if (max <= 1) return { ...line, text: line.text.slice(0, Math.max(0, max)) }
  return { ...line, text: line.text.slice(0, max - 1) + "…" }
}

/**
 * Redact secrets from a message (failure/denied/offline) so it can be shown in
 * the terminal and surfaced in diagnostics without leaking credentials.
 */
export function redactMessage(message: string): string {
  return redactSensitive(message ?? "").text
}

/** Single-line summary used as the accessible live-region label and header. */
export function filePreviewSummary(state: FilePreviewState, path?: string): string {
  const where = path ? ` (${path})` : ""
  const matched = matchCount(state.lines, state.query)
  switch (state.status) {
    case "loading":
      return `File preview${where}: loading…`
    case "empty":
      return `File preview${where}: empty — no content`
    case "populated":
      if (state.query.trim()) return `File preview${where}: ${matched} of ${state.lines.length} lines match “${state.query.trim()}”`
      return `File preview${where}: ${state.lines.length} ${state.lines.length === 1 ? "line" : "lines"}`
    case "long":
      return `File preview${where}: large file — ${state.lines.length} lines, folded`
    case "failure":
      return `File preview${where}: failed to read — ${redactMessage(state.context.failure ?? "unknown error")}`
    case "denied":
      return `File preview${where}: access denied`
    case "offline":
      return `File preview${where}: offline — source unreachable`
    case "degraded":
      return `File preview${where}: limited preview — ${state.context.degradedReason ?? "reduced fidelity"}`
  }
}
