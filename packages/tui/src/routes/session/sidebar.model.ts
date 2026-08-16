/**
 * Session sidebar lifecycle model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, or SDK
 * dependencies so the sidebar logic can be unit tested in isolation and reused
 * by the Solid component in `./sidebar.tsx`. Every transition is pure: it takes
 * inputs and returns new values, which keeps the data flow deterministic and
 * snapshot-free in tests.
 *
 * It mirrors the conventions established by `build-validation/model.ts` and
 * `file-tree/file-tree-core.ts`:
 *   - an eight-state lifecycle (loading, offline, denied, failure, empty,
 *     degraded, long-content, populated) projected from an environmental context,
 *   - a render budget that caps the rows painted for large / rapidly streaming
 *     content,
 *   - narrow-terminal and limited-color fallbacks so the view stays usable,
 *   - secret redaction for both visual output and any diagnostics.
 *
 * The sidebar is a non-interactive surface: it never takes keyboard focus, and
 * the host keeps its scroll container mounted across state changes so focus is
 * never lost or trapped during updates. The helpers here therefore only describe
 * *what* to render, never *how* to capture input.
 */

import stripAnsi from "strip-ansi"
import { redactSensitive, sanitizeForDiagnostics } from "../../component/agent-roster/model"

/** The eight intentionally-rendered lifecycle states of the session sidebar. */
export type SidebarStatus =
  | "loading"
  | "offline"
  | "denied"
  | "failure"
  | "empty"
  | "degraded"
  | "long-content"
  | "populated"

/** Environmental context that decides which top-level lifecycle state we are in. */
export interface SidebarContext {
  /** Bootstrap / initial load is in flight (sync not ready). */
  loading: boolean
  /** Network / account connection is available (`useConnected`). */
  connected: boolean
  /** The viewer is permitted to see this session (signed in for cloud shares). */
  permitted: boolean
  /** Bootstrap finished but some data could not be collected. */
  partial: boolean
  /** Session-level error or retry message, if any. */
  error?: string
  /** A session record exists in the store. */
  hasSession: boolean
  /** The session has a usable title. */
  hasTitle: boolean
  /** The session exposes workspace / share / agent / model metadata. */
  hasContent: boolean
}

/** Derivable, memoizable sidebar view state consumed by the component. */
export interface SidebarState {
  status: SidebarStatus
  context: SidebarContext
  contentCount: number
  showAll: boolean
  renderBudget: number
  narrowWidth: number
}

/** Default column width of the sidebar when docked (matches the route layout). */
export const SIDEBAR_WIDTH_DEFAULT = 42

/** Minimum column width for the floating overlay sidebar on small terminals. */
export const SIDEBAR_WIDTH_OVERLAY_MIN = 32

/** Terminal width (available content columns) below which secondary lines drop. */
export const NARROW_WIDTH_DEFAULT = 32

/** Maximum number of metadata rows painted before the budget "more" hint. */
export const RENDER_BUDGET_DEFAULT = 50

/** Hard cap on a single title before it is truncated to the available width. */
export const TITLE_MAX = 256

/** Hard cap on an error / diagnostic string before it is truncated. */
export const ERROR_MAX = 240

/**
 * Classify the sidebar's top-level state. Order matters: transient / blocking
 * states win over presentational ones so the user always sees the most
 * actionable message first.
 */
export function deriveSidebarStatus(
  context: SidebarContext,
  contentCount: number,
  renderBudget: number,
  showAll: boolean,
): SidebarStatus {
  if (context.loading || !context.hasSession) return "loading"
  if (!context.connected) return "offline"
  if (!context.permitted) return "denied"
  if (context.error) return "failure"
  if (!context.hasTitle && !context.hasContent) return "empty"
  if (context.partial) return "degraded"
  if (!showAll && contentCount > renderBudget) return "long-content"
  return "populated"
}

export interface SidebarOverrides {
  renderBudget?: number
  narrowWidth?: number
  showAll?: boolean
}

export function buildSidebarState(
  context: SidebarContext,
  contentCount: number,
  overrides: SidebarOverrides = {},
): SidebarState {
  const renderBudget = overrides.renderBudget ?? RENDER_BUDGET_DEFAULT
  const narrowWidth = overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT
  const showAll = overrides.showAll ?? false
  return {
    status: deriveSidebarStatus(context, contentCount, renderBudget, showAll),
    context,
    contentCount,
    showAll,
    renderBudget,
    narrowWidth,
  }
}

/** Count of rows painted when the render budget is applied (all once expanded). */
export function visibleContentCount(state: SidebarState): number {
  if (state.showAll) return state.contentCount
  return Math.min(state.contentCount, state.renderBudget)
}

/** Count of rows hidden by the render budget (0 once expanded). */
export function hiddenContentCount(state: SidebarState): number {
  if (state.showAll) return 0
  return Math.max(0, state.contentCount - state.renderBudget)
}

/** A terminal is "narrow" when secondary columns must be dropped to fit. */
export function isNarrowTerminal(width: number, threshold = NARROW_WIDTH_DEFAULT): boolean {
  return width < threshold
}

/** True when the environment cannot render color (NO_COLOR or a dumb terminal). */
export function detectNoColor(): boolean {
  if (typeof process !== "undefined" && process.env.NO_COLOR) return true
  if (typeof process !== "undefined" && process.env.TERM === "dumb") return true
  return false
}

/** Resolve whether color may be used for an optional color-level (0 disables it). */
export function supportsColor(level?: number): boolean {
  return (level ?? 3) > 0
}

/**
 * Truncate a string to `width` visible columns, appending an ellipsis when it
 * overflows. ANSI styling is stripped first so the budget is measured on the
 * rendered glyphs, never on escape sequences.
 */
export function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return ""
  const clean = stripAnsi(text ?? "").trim()
  if (clean.length <= width) return clean
  if (width === 1) return `${clean.slice(0, 1)}…`
  return `${clean.slice(0, width - 1)}…`
}

/** Redact secrets from a single string for safe visual output. */
export function redact(text: string): { text: string; redacted: boolean } {
  return redactSensitive(text)
}

/** Redact secrets recursively from a value for safe diagnostics / logging. */
export function sanitizeDiagnostic<T>(value: T): T {
  return sanitizeForDiagnostics(value)
}

/** Short textual status label, always rendered so state is never color-only. */
export function statusLabel(status: SidebarStatus): string {
  switch (status) {
    case "loading":
      return "loading"
    case "offline":
      return "offline"
    case "denied":
      return "permission denied"
    case "failure":
      return "failed to load"
    case "empty":
      return "empty"
    case "degraded":
      return "partial"
    case "long-content":
      return "long"
    case "populated":
      return "ready"
  }
}

/**
 * Glyph / marker shown ahead of the status line. In color terminals a compact
 * symbol is used; in limited-color terminals an explicit ASCII bracket carries
 * the same meaning so the state is never conveyed by color alone.
 */
const COLOR_GLYPH: Record<SidebarStatus, string> = {
  loading: "…",
  offline: "✕",
  denied: "⊘",
  failure: "✕",
  empty: "∅",
  degraded: "△",
  "long-content": "▾",
  populated: "●",
}

const ASCII_MARKER: Record<SidebarStatus, string> = {
  loading: "[loading]",
  offline: "[offline]",
  denied: "[denied]",
  failure: "[error]",
  empty: "[empty]",
  degraded: "[partial]",
  "long-content": "[more]",
  populated: "[ok]",
}

export function statusMarker(status: SidebarStatus, useColor: boolean): string {
  return useColor ? COLOR_GLYPH[status] : ASCII_MARKER[status]
}

/** Single-line summary used as the accessible live-region label and header. */
export function sidebarSummary(state: SidebarState): string {
  switch (state.status) {
    case "loading":
      return "Session sidebar: loading…"
    case "offline":
      return "Session sidebar: offline — unavailable"
    case "denied":
      return "Session sidebar: permission denied"
    case "failure":
      return `Session sidebar: failed to load — ${redact(state.context.error ?? "unknown error").text}`
    case "empty":
      return "Session sidebar: no session content"
    case "degraded":
      return "Session sidebar: partial session info"
    case "long-content":
      return `Session sidebar: ${state.contentCount} entries (showing ${state.renderBudget})`
    case "populated":
    default:
      return "Session sidebar: session ready"
  }
}

/**
 * Responsive sidebar width. Docked, it keeps the fixed `42` column so the
 * route's content-width accounting stays correct. As an overlay on a small
 * terminal it shrinks to fit while never dropping below a usable minimum.
 */
export function sidebarWidth(totalWidth: number, overlay = false): number {
  if (!overlay) return SIDEBAR_WIDTH_DEFAULT
  const desired = totalWidth - 4
  return Math.max(SIDEBAR_WIDTH_OVERLAY_MIN, Math.min(SIDEBAR_WIDTH_DEFAULT, desired))
}
