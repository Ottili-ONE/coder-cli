// Multi-pane workspace layout decisions (T-CLI-0201) and pane lifecycle model
// (T-CLI-0202).
//
// Pure layout math for the resizable transcript, files, diff, tasks and
// terminal panes. Kept Solid/engine-free so the model can be unit-tested
// without mounting the TUI, mirroring the existing focus.ts / compact.ts
// pattern.
//
// The model decides which panes are visible and what width each pane
// occupies based on the terminal dimensions, session state, and active
// tool context. The render layer maps these decisions onto PanelGroup/Panel
// components from diff-viewer-ui.tsx.
//
// Each pane follows the eight-state lifecycle (loading, offline, denied,
// failure, empty, degraded, long-content, populated) established by the
// codebase pattern. The model provides render-budget caps, narrow-terminal
// and limited-color fallbacks, accessibility summaries, and secret redaction.

import { redactSensitive } from "../../component/agent-roster/model"

export type PaneID = "transcript" | "files" | "diff" | "tasks" | "terminal"

// ---------------------------------------------------------------------------
// Eight-state pane lifecycle
// ---------------------------------------------------------------------------

export type PaneStatus =
  | "loading"
  | "offline"
  | "denied"
  | "failure"
  | "empty"
  | "degraded"
  | "long-content"
  | "populated"

/** Environmental context that decides the pane lifecycle state. */
export interface PaneContext {
  /** Content is still being fetched / streamed. */
  loading: boolean
  /** Network / backend connection is available. */
  connected: boolean
  /** The viewer is permitted to access this pane's data. */
  permitted: boolean
  /** A recoverable error or partial load condition. */
  partial: boolean
  /** Unrecoverable error message, if any. */
  error?: string
  /** Any content exists in the pane. */
  hasContent: boolean
  /** Approximate number of content rows / items in the pane. */
  contentCount: number
}

export const MAX_PANE_CONTENT = 500
export const MAX_PANE_TEXT_LEN = 2000

export interface PaneRenderBudget {
  /** Hard cap on rendered content rows (tail window). */
  maxContent: number
  /** Hard cap on single text preview length in chars. */
  maxTextLen: number
  /** True when content exceeds the maxContent budget. */
  overBudget: boolean
}

export interface PaneView {
  id: PaneID
  status: PaneStatus
  context: PaneContext
  renderBudget: PaneRenderBudget
}

export interface PaneAccessibility {
  /** Self-describing aria-label for the pane region. */
  ariaLabel: string
  /** Short textual label (never color-only) for the status. */
  statusLabel: string
  /** ASCII-safe marker when color is unavailable. */
  statusMarker: string
}

// ---------------------------------------------------------------------------
// Visibility state for each pane in the layout model.
// ---------------------------------------------------------------------------

export interface PaneState {
  id: PaneID
  visible: boolean
  /** Width/height fraction or absolute size constraint. */
  size: number
  /** Whether this pane can be resized interactively. */
  resizable: boolean
  /** Human-readable label shown in the pane header. */
  label: string
}

export interface MultiPaneInput {
  width: number
  height: number
  /** True when a diff tool call is visible in the current session. */
  hasActiveDiff: boolean
  /** True when a file-read or write tool call is visible. */
  hasActiveFile: boolean
  /** True when a running foreground task or subagent exists. */
  hasActiveTask: boolean
  /** True when a shell tool call is running. */
  hasActiveTerminal: boolean
  /** Whether the redesign flag is enabled. */
  enabled: boolean
  /** Per-pane lifecycle contexts for state-aware rendering. */
  paneContexts?: Partial<Record<PaneID, PaneContext>>
  /** Whether the terminal supports color. */
  useColor?: boolean
}

export interface MultiPaneState {
  /** Which layout axis the pane group uses ("x" for row, "y" for column). */
  axis: "x" | "y"
  /** Ordered list of visible panes (subset of all panes). */
  panes: PaneState[]
  /** Whether a vertical separator is shown between panes. */
  showSeparators: boolean
  /** Whether the diff pane is in split-view mode. */
  diffSplitView: boolean
  /** Whether the multi-pane layout is active at all. */
  active: boolean
  /** Per-pane lifecycle views for state-aware rendering. */
  paneViews: Partial<Record<PaneID, PaneView>>
  /** Per-pane accessibility labels. */
  paneAria: Partial<Record<PaneID, PaneAccessibility>>
  /** Whether narrow-terminal fallbacks should apply. */
  narrow: boolean
  /** Whether color is available. */
  useColor: boolean
}

// Minimum width a pane must retain to remain functional.
const MIN_PANE_WIDTH = 20

// Terminal width below which secondary panes collapse.
const NARROW_WIDTH_THRESHOLD = 80

// ---------------------------------------------------------------------------
// Pane lifecycle classification
// ---------------------------------------------------------------------------

/** Status precedence: blocking states win over content states. */
export function derivePaneStatus(context: PaneContext): PaneStatus {
  if (context.loading) return "loading"
  if (!context.connected) return "offline"
  if (!context.permitted) return "denied"
  if (context.error) return "failure"
  if (!context.hasContent) return "empty"
  if (context.partial) return "degraded"
  if (context.contentCount > MAX_PANE_CONTENT) return "long-content"
  return "populated"
}

export function buildPaneView(
  id: PaneID,
  context: PaneContext | undefined,
  overBudgetOverride?: boolean,
): PaneView {
  const ctx: PaneContext = context ?? {
    loading: false,
    connected: true,
    permitted: true,
    partial: false,
    hasContent: false,
    contentCount: 0,
  }
  const status = derivePaneStatus(ctx)
  const overBudget = overBudgetOverride ?? ctx.contentCount > MAX_PANE_CONTENT
  return {
    id,
    status,
    context: ctx,
    renderBudget: {
      maxContent: MAX_PANE_CONTENT,
      maxTextLen: MAX_PANE_TEXT_LEN,
      overBudget,
    },
  }
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

const STATUS_COLOR_GLYPH: Record<PaneStatus, string> = {
  loading: "…",
  offline: "✕",
  denied: "⊘",
  failure: "✕",
  empty: "∅",
  degraded: "△",
  "long-content": "▾",
  populated: "●",
}

const STATUS_ASCII_MARKER: Record<PaneStatus, string> = {
  loading: "[loading]",
  offline: "[offline]",
  denied: "[denied]",
  failure: "[error]",
  empty: "[empty]",
  degraded: "[partial]",
  "long-content": "[long]",
  populated: "[ok]",
}

export function statusMarker(status: PaneStatus, useColor: boolean): string {
  return useColor ? STATUS_COLOR_GLYPH[status] : STATUS_ASCII_MARKER[status]
}

export function paneStatusLabel(status: PaneStatus): string {
  switch (status) {
    case "loading":
      return "loading"
    case "offline":
      return "offline"
    case "denied":
      return "denied"
    case "failure":
      return "error"
    case "empty":
      return "empty"
    case "degraded":
      return "degraded"
    case "long-content":
      return "long content"
    case "populated":
      return "ready"
  }
}

export function paneAriaLabel(pane: PaneView): string {
  const safe = redactSensitive(paneStatusLabel(pane.status)).text
  return `${pane.id} pane: ${safe}`
}

export function buildPaneAccessibility(pane: PaneView, useColor: boolean): PaneAccessibility {
  return {
    ariaLabel: paneAriaLabel(pane),
    statusLabel: paneStatusLabel(pane.status),
    statusMarker: statusMarker(pane.status, useColor),
  }
}

// ---------------------------------------------------------------------------
// Narrow terminal helpers
// ---------------------------------------------------------------------------

export function isNarrowTerminal(width: number): boolean {
  return width < NARROW_WIDTH_THRESHOLD
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

// Legacy single-pane output — exactly the current rendering behavior.
function legacyLayout(useColor: boolean): MultiPaneState {
  return {
    axis: "y",
    panes: [{ id: "transcript", visible: true, size: 1, resizable: false, label: "Transcript" }],
    showSeparators: false,
    diffSplitView: false,
    active: false,
    paneViews: {},
    paneAria: {},
    narrow: false,
    useColor,
  }
}

export function computeMultiPaneLayout(input: MultiPaneInput): MultiPaneState {
  const useColor = input.useColor ?? true
  if (!input.enabled) return legacyLayout(useColor)

  const transcriptWide = input.width > 120
  const narrow = isNarrowTerminal(input.width)

  // Build secondary panes based on available tool context.
  const secondaryPanes: PaneState[] = []

  if (input.hasActiveDiff && transcriptWide) {
    secondaryPanes.push({
      id: "diff",
      visible: true,
      size: Math.round(input.width * 0.35),
      resizable: true,
      label: "Diff",
    })
  }

  if (input.hasActiveFile && secondaryPanes.length < 2) {
    secondaryPanes.push({
      id: "files",
      visible: true,
      size: Math.round(input.width * 0.3),
      resizable: true,
      label: "Files",
    })
  }

  if (input.hasActiveTask && secondaryPanes.length < 2) {
    secondaryPanes.push({
      id: "tasks",
      visible: true,
      size: Math.round(input.width * 0.3),
      resizable: true,
      label: "Tasks",
    })
  }

  if (input.hasActiveTerminal && secondaryPanes.length < 2) {
    secondaryPanes.push({
      id: "terminal",
      visible: true,
      size: Math.round(input.width * 0.3),
      resizable: true,
      label: "Terminal",
    })
  }

  // If no secondary context exists, fall back to the single-pane legacy layout.
  if (secondaryPanes.length === 0) return legacyLayout(useColor)

  // Compute the transcript width: remaining space after secondary panes.
  const secondaryTotal = secondaryPanes.reduce((sum, p) => sum + p.size, 0)
  const transcriptSize = input.width - secondaryTotal

  // Guard minimum widths.
  const allPanes: PaneState[] = [
    {
      id: "transcript",
      visible: true,
      size: Math.max(transcriptSize, MIN_PANE_WIDTH),
      resizable: true,
      label: "Transcript",
    },
    ...secondaryPanes,
  ]

  // Build per-pane lifecycle views from contexts.
  const paneViews: MultiPaneState["paneViews"] = {}
  const paneAria: MultiPaneState["paneAria"] = {}
  for (const pane of allPanes) {
    const view = buildPaneView(pane.id, input.paneContexts?.[pane.id])
    paneViews[pane.id] = view
    paneAria[pane.id] = buildPaneAccessibility(view, useColor)
  }

  return {
    axis: "x",
    panes: allPanes,
    showSeparators: true,
    diffSplitView: transcriptWide,
    active: true,
    paneViews,
    paneAria,
    narrow,
    useColor,
  }
}