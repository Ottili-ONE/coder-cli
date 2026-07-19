// Compact mode view-state model (T-CLI-0210).
//
// Hardens Compact mode (T-CLI-0209) across its full lifecycle: loading, empty,
// populated, long-content, failure, denied, offline and degraded. The module is
// deliberately free of any Solid / OpenTUI / SDK dependency so the state
// machine can be unit tested in isolation and reused by the Solid component in
// `./compact-status-line.tsx`. Every transition is a pure function: it takes
// observable harness inputs and returns a derived view state, which keeps the
// data flow deterministic in tests.
//
// It mirrors the established `context-meter` / `file-tree` state-machine
// pattern: harness concerns (loading / error / offline / denied / degraded) are
// lifted above the raw transcript data so the same model serves live,
// streaming and failure states. On top of that it adds the Compact-specific
// guarantees this task requires: terminal fallbacks (narrow + no-color), a
// render budget for large / rapid streams, and secret redaction of any
// diagnostic text.

import { detectNoColor, redactText } from "../../util/redact"

/** Whole-transcript lifecycle derived from harness context + message data. */
export type CompactViewStatus =
  | "loading"
  | "empty"
  | "populated"
  | "long-content"
  | "failure"
  | "denied"
  | "offline"
  | "degraded"

/** Harness-level concerns lifted above the raw message data. */
export interface CompactViewContext {
  /** Session metadata + initial messages have resolved. */
  isReady: boolean
  /** A load / refresh (streaming) is currently in flight. */
  loading?: boolean
  /** Harness-level error (redacted on render). */
  error?: string
  /** The session/provider backend is unreachable. */
  offline?: boolean
  /** The caller is not permitted to read this transcript. */
  denied?: boolean
  /** Reduced-capability state: last-known data shown while reconnecting. */
  degraded?: boolean
}

/** Projection of the transcript used for classification + budgeting. */
export interface CompactViewData {
  messageCount: number
  /** At least one message carries visible text content. */
  hasContent: boolean
  /** Length (chars) of the longest single message. */
  longestMessageLength: number
  /** Total rendered character volume across the transcript. */
  totalChars: number
  /** Messages currently streaming (no completion timestamp). */
  runningCount: number
}

/** Performance budget for rendering the transcript in Compact mode. */
export interface CompactRenderBudget {
  /** Hard cap on messages rendered before the tail window is applied. */
  maxMessages: number
  /** Cap on a single streaming message's preview length. */
  streamPreviewChars: number
  /** Minimum cadence (ms) at which a live, streaming view re-samples its source. */
  resampleMs: number
  /** When true, the running stream has exceeded the preview char budget. */
  streamingOverBudget: boolean
}

// Terminal-fallback + performance-budget constants.
export const COMPACT_NARROW_WIDTH = 80
export const COMPACT_LONG_CONTENT_CHARS = 8_000
export const COMPACT_LONG_CONTENT_TOTAL_CHARS = 32_000
export const COMPACT_MAX_RENDERED_MESSAGES = 600
export const COMPACT_MAX_STREAM_PREVIEW = 2_000
export const COMPACT_RENDER_BUDGET_MS = 250
export const COMPACT_DIAGNOSTIC_MAX = 240

/** A single message crosses the long-content threshold by length or total volume. */
export function isLongContent(data: CompactViewData): boolean {
  return data.longestMessageLength >= COMPACT_LONG_CONTENT_CHARS || data.totalChars >= COMPACT_LONG_CONTENT_TOTAL_CHARS
}

/**
 * Classify the transcript into one lifecycle state. Harness failures take
 * precedence (offline > denied > failure) so a degraded connection never masks
 * a hard error; readiness and content drive the happy-path states.
 */
export function classifyCompactState(ctx: CompactViewContext, data: CompactViewData): CompactViewStatus {
  if (ctx.offline) return "offline"
  if (ctx.denied) return "denied"
  if (ctx.error) return "failure"
  if (ctx.loading && !ctx.isReady) return "loading"
  if (!ctx.isReady) return "empty"
  if (data.messageCount === 0) return "empty"
  if (ctx.degraded && data.hasContent) return "degraded"
  if (isLongContent(data)) return "long-content"
  if (data.hasContent) return "populated"
  return "empty"
}

/** Map a raw error string to a friendly, redacted message for display. */
function friendlyError(raw: string | undefined): string {
  const text = redactText(raw ?? "")
  if (/session not found|no such session|unknown session/i.test(text)) return "session not available"
  if (/forbidden|403|access denied|permission/i.test(text)) return "access denied"
  if (/rate limit|429/i.test(text)) return "rate limited"
  if (/network|econn|timeout|unreachable|etimedout/i.test(text)) return "connection error"
  return text || "unknown error"
}

/**
 * One-line status text. `noColor` leaves the string identical (color is a
 * secondary signal — the words carry the meaning), so limited-color terminals
 * read exactly what color terminals do.
 */
export function summarizeCompactState(
  status: CompactViewStatus,
  ctx: CompactViewContext,
  data: CompactViewData,
  _noColor = false,
): string {
  switch (status) {
    case "loading":
      return "Loading session…"
    case "empty":
      return "No messages yet"
    case "failure":
      return `Session unavailable — ${friendlyError(ctx.error)}`
    case "denied":
      return "Session — access denied"
    case "offline":
      return "Session — offline"
    case "degraded":
      return data
        ? `Session — limited · ${data.messageCount} message${data.messageCount === 1 ? "" : "s"}`
        : "Session — limited connectivity"
    case "long-content":
      return data
        ? `Session · ${data.messageCount} messages · long content`
        : "Session — long content"
    case "populated":
      return data
        ? `Session · ${data.messageCount} message${data.messageCount === 1 ? "" : "s"}`
        : "Session"
    default:
      return "Session"
  }
}

/** Spoken form for screen readers / aria-labels; never color-only. */
export function accessibleCompactSummary(
  status: CompactViewStatus,
  ctx: CompactViewContext,
  data: CompactViewData,
): string {
  const base = summarizeCompactState(status, ctx, data, true)
  if ((status === "populated" || status === "long-content" || status === "degraded") && data) {
    const parts = [
      `${data.messageCount} message${data.messageCount === 1 ? "" : "s"}`,
      data.runningCount > 0 ? `${data.runningCount} streaming` : undefined,
      data.longestMessageLength >= COMPACT_LONG_CONTENT_CHARS ? "long content" : undefined,
    ].filter(Boolean)
    return `${base}. ${parts.join(". ")}.`
  }
  return base
}

export interface CompactViewInput {
  ctx: CompactViewContext
  data: CompactViewData
  opts?: {
    width?: number
    narrowWidth?: number
    noColor?: boolean
    maxRenderedMessages?: number
    longContentChars?: number
    streamPreviewChars?: number
    resampleMs?: number
  }
}

/** Derived view state consumed by the Solid component. */
export interface CompactViewState {
  status: CompactViewStatus
  data: CompactViewData
  narrow: boolean
  noColor: boolean
  /** A refresh is in flight over a live (populated/long-content/degraded) view. */
  stale: boolean
  renderBudget: CompactRenderBudget
  /** Full status line text (color is a secondary signal). */
  summaryText: string
  /** Spoken form, suitable for an aria-label. */
  accessibleSummary: string
  /** Compact inline indicator (glyph + short word) for narrow terminals. */
  meterText: string
  /** True when streaming messages may arrive out of order relative to their index. */
  streamingHazard: boolean
  /** True when the degraded state has redirected to a more specific status. */
  degradedRedirected: boolean
}

/**
 * Build the Compact-mode view state from observable inputs. Pure: identical
 * inputs always yield an identical state, and it never reads streaming content
 * directly (only the pre-projected `data`), so the surface stays fixed while
 * the assistant streams.
 */
export function compactViewState(input: CompactViewInput): CompactViewState {
  const narrowWidth = input.opts?.narrowWidth ?? COMPACT_NARROW_WIDTH
  const width = input.opts?.width ?? narrowWidth
  const narrow = width > 0 && width <= narrowWidth
  const noColor = input.opts?.noColor ?? detectNoColor()
  const maxMessages = input.opts?.maxRenderedMessages ?? COMPACT_MAX_RENDERED_MESSAGES
  const streamPreviewChars = input.opts?.streamPreviewChars ?? COMPACT_MAX_STREAM_PREVIEW
  const resampleMs = input.opts?.resampleMs ?? COMPACT_RENDER_BUDGET_MS

  // Detect streaming-order hazard: many running messages with a large total char
  // volume means the stream may be delivering chunks out of order relative to
  // their message index (common with parallel tool calls streaming back).
  const streamingHazard = input.data.runningCount > 3 && input.data.totalChars > COMPACT_LONG_CONTENT_TOTAL_CHARS

  // Enhanced degraded handling: empty degraded resolves to empty, not degraded,
  // so the surface never says "limited" when there is nothing to limit.
  const degradedRedirected = !!(input.ctx.degraded && input.data.messageCount === 0)
  const effectiveContext: CompactViewContext = degradedRedirected
    ? { ...input.ctx, degraded: false }
    : input.ctx

  const status = classifyCompactState(effectiveContext, input.data)
  const stale =
    !!input.ctx.loading && (status === "populated" || status === "long-content" || status === "degraded")
  const streamingOverBudget = input.data.runningCount > 0 && input.data.longestMessageLength > streamPreviewChars

  return {
    status,
    data: input.data,
    narrow,
    noColor,
    stale,
    streamingHazard,
    degradedRedirected,
    renderBudget: { maxMessages, streamPreviewChars, resampleMs, streamingOverBudget },
    summaryText: summarizeCompactState(status, effectiveContext, input.data, noColor),
    accessibleSummary: accessibleCompactSummary(status, effectiveContext, input.data),
    meterText: compactMeterText(status, noColor),
  }
}

const METER_WORD: Record<CompactViewStatus, string> = {
  loading: "loading",
  empty: "empty",
  populated: "live",
  "long-content": "long",
  failure: "error",
  denied: "denied",
  offline: "offline",
  degraded: "limited",
}

/** Compact inline indicator: a short word the component prefixes with a glyph. */
function compactMeterText(status: CompactViewStatus, _noColor: boolean): string {
  return METER_WORD[status]
}

/**
 * Apply the render budget to the message list. When disabled (or under budget)
 * the full list is returned unchanged. When enabled and over budget, the tail
 * window is kept so the newest content stays visible and the oldest is dropped
 * — this bounds both DOM nodes and re-render cost for very large transcripts
 * without re-sorting or losing the live edge.
 */
export function windowMessages<T>(messages: T[], maxMessages: number, enabled: boolean): T[] {
  if (!enabled) return messages
  if (messages.length <= maxMessages) return messages
  return messages.slice(messages.length - maxMessages)
}

/** Bound a single streaming message's preview to the render budget. */
export function truncateStreamPreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars - 1) + "…"
}
