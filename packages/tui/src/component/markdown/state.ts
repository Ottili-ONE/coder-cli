/**
 * Markdown renderer — state machine and render-budget hardening.
 *
 * Pure, render-agnostic logic for the redesigned TUI Markdown surface. It
 * classifies the surface into the eight intentionally-rendered states required by
 * the redesign (loading, empty, populated, long-content, failure, denied,
 * offline, degraded) and provides the building blocks for accessibility,
 * terminal fallbacks and render budgets.
 *
 * The markdown parser in `./model` is deliberately tolerant (a partial stream
 * never throws); this module decides *which* state to present and how to keep
 * that presentation within the render budget. All helpers are pure so they can be
 * unit tested without any terminal, engine or SDK dependency.
 */

import {
  NARROW_WIDTH_DEFAULT,
  isNarrow,
  redactSensitive,
  truncate,
} from "../agent-roster/model"

/** The eight intentionally-rendered markdown states required by the redesign. */
export type MarkdownStatus =
  | "loading"
  | "empty"
  | "populated"
  | "long-content"
  | "failure"
  | "denied"
  | "offline"
  | "degraded"

/** Environmental context that decides which top-level state the surface is in. */
export interface MarkdownContext {
  /** Content is being fetched or streamed and not yet presentable. */
  loading?: boolean
  /** A network is required to resolve linked/embedded content. */
  connected?: boolean
  /** The caller is allowed to view this content. */
  permitted?: boolean
  /** A render/load failure message (surfaced in the failure state). */
  error?: string | null
  /** Render in reduced-fidelity mode (e.g. no callouts/highlight). */
  degraded?: boolean
}

/** Derivable, memoizable markdown state consumed by the component. */
export interface MarkdownState {
  status: MarkdownStatus
  context: Required<MarkdownContext>
  /** Budget-safe content (already truncated by {@link truncateToBudget}). */
  content: string
  renderBudget: number
  narrowWidth: number
  /** True when the raw content exceeded the hard safety cap. */
  truncated: boolean
  /** Characters dropped by the hard safety cap. */
  droppedChars: number
  /** True when the raw content contained redactable secrets. */
  redacted: boolean
}

/** Render budget (characters) before the markdown switches to long-content. */
export const MARKDOWN_RENDER_BUDGET = 20000

/** Hard safety cap; content beyond this is truncated before parsing. */
export const MARKDOWN_MAX_LEN = 50000

/** Terminal width at or below which we use the compact markdown layout. */
export const MARKDOWN_NARROW_WIDTH = NARROW_WIDTH_DEFAULT

/** Minimum gap (ms) between committed reparses during a rapid stream. */
export const MARKDOWN_COMMIT_INTERVAL_MS = 120

/**
 * Classify the top-level state. Order matters: transient/blocking states win
 * over presentational ones so the user always sees the most actionable message.
 */
export function deriveMarkdownStatus(
  content: string,
  ctx: MarkdownContext,
  budget = MARKDOWN_RENDER_BUDGET,
): MarkdownStatus {
  if (ctx.loading === true) return "loading"
  if (ctx.connected === false) return "offline"
  if (ctx.permitted === false) return "denied"
  if (ctx.error) return "failure"
  if (!content || content.trim() === "") return "empty"
  if (ctx.degraded === true) return "degraded"
  if (content.length > budget) return "long-content"
  return "populated"
}

/**
 * Truncate runaway content to the hard safety cap so a long/rapid stream can
 * never OOM the renderer. Pure: never mutates the input.
 */
export function truncateToBudget(
  content: string,
  max = MARKDOWN_MAX_LEN,
): { text: string; truncated: boolean; dropped: number } {
  if (content.length <= max) return { text: content, truncated: false, dropped: 0 }
  return {
    text: `${content.slice(0, max)}\n\n… (content truncated to ${max} characters)`,
    truncated: true,
    dropped: content.length - max,
  }
}

/**
 * Build the full derivable markdown state from raw content and context. The
 * content is first capped by the safety budget, then classified. Pure.
 */
export function buildMarkdownState(
  content: string,
  ctx: Partial<MarkdownContext> = {},
  overrides: { renderBudget?: number; narrowWidth?: number } = {},
): MarkdownState {
  const context: Required<MarkdownContext> = {
    loading: ctx.loading ?? false,
    connected: ctx.connected ?? true,
    permitted: ctx.permitted ?? true,
    error: ctx.error ?? null,
    degraded: ctx.degraded ?? false,
  }
  const budget = overrides.renderBudget ?? MARKDOWN_RENDER_BUDGET
  const safe = truncateToBudget(content)
  const status = deriveMarkdownStatus(safe.text, context, budget)
  return {
    status,
    context,
    content: safe.text,
    renderBudget: budget,
    narrowWidth: overrides.narrowWidth ?? MARKDOWN_NARROW_WIDTH,
    truncated: safe.truncated,
    droppedChars: safe.dropped,
    redacted: redactSensitive(content).redacted,
  }
}

/** Short textual status label, always rendered so state is never color-only. */
export function markdownStatusLabel(status: MarkdownStatus): string {
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
export function markdownStatusGlyph(status: MarkdownStatus, useColor: boolean): string {
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

/** Single-line summary used as the accessible live-region label and header. */
export function markdownSummary(state: MarkdownState): string {
  switch (state.status) {
    case "loading":
      return "Markdown: loading…"
    case "offline":
      return "Markdown: offline — content unavailable"
    case "denied":
      return "Markdown: permission denied"
    case "failure":
      return `Markdown: failed to render — ${redactSensitive(state.context.error ?? "unknown error").text}`
    case "empty":
      return "Markdown: no content"
    case "degraded":
      return "Markdown: rendered in degraded mode"
    case "long-content": {
      const shown = state.content.length
      const dropped = state.droppedChars
      return `Markdown: long content — showing ${shown} characters${
        dropped > 0 ? `, ${dropped} truncated` : ""
      }`
    }
    case "populated":
    default:
      return `Markdown: ${state.content.length} characters`
  }
}

/** Self-contained, redacted screen-reader label for the current state. */
export function markdownAriaLabel(state: MarkdownState): string {
  return redactSensitive(markdownSummary(state)).text
}

/** Is the available width too small for the side-by-side markdown layout? */
export function isMarkdownNarrow(width: number, narrowWidth = MARKDOWN_NARROW_WIDTH): boolean {
  return isNarrow(width, narrowWidth)
}

/** Clamp a long-content body to the render budget, appending a marker. Pure. */
export function withinBudget(content: string, budget = MARKDOWN_RENDER_BUDGET): string {
  if (content.length <= budget) return content
  return `${content.slice(0, Math.max(0, budget - 1))}…`
}

// ---------------------------------------------------------------------------
// Rapid-stream coalescing
// ---------------------------------------------------------------------------

export type MarkdownCommit<T> = (value: T) => void

/**
 * Leading+trailing throttle over markdown content commits. The first push in a
 * quiet period commits immediately (snappy streaming), while any pushes arriving
 * within `interval` are buffered and flushed together as one trailing commit so
 * a rapid stream never reparses on every keystroke. Latest value wins.
 * `flush()` forces the pending buffer out synchronously.
 */
export function createMarkdownThrottle<T>(
  commit: MarkdownCommit<T>,
  interval = MARKDOWN_COMMIT_INTERVAL_MS,
) {
  let pending: T | undefined
  let hasPending = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush() {
    if (!hasPending) return
    const value = pending!
    pending = undefined
    hasPending = false
    commit(value)
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, interval)
    if (typeof timer.unref === "function") timer.unref()
  }

  return {
    push(value: T) {
      const hadPending = hasPending
      pending = value
      hasPending = true
      if (hadPending) return
      commit(value)
      schedule()
    },
    flush,
    pending: () => (hasPending ? 1 : 0),
  }
}
