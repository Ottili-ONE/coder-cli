// Multi-pane workspace layout decisions (T-CLI-0201).
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

export type PaneID = "transcript" | "files" | "diff" | "tasks" | "terminal"

// Visibility state for each pane. Always exists in the model so open/close
// transitions are pure signal updates without structural DOM changes.
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
}

// Minimum width a pane must retain to remain functional.
const MIN_PANE_WIDTH = 20
// Default transcript share: 60% of terminal width (Claude Code-inspired ratio).
const TRANSCRIPT_DEFAULT_FRACTION = 0.6

// Legacy single-pane output — exactly the current rendering behavior.
function legacyLayout(): MultiPaneState {
  return {
    axis: "y",
    panes: [{ id: "transcript", visible: true, size: 1, resizable: false, label: "Transcript" }],
    showSeparators: false,
    diffSplitView: false,
    active: false,
  }
}

export function computeMultiPaneLayout(input: MultiPaneInput): MultiPaneState {
  if (!input.enabled) return legacyLayout()

  const transcriptWide = input.width > 120

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
  if (secondaryPanes.length === 0) return legacyLayout()

  // Compute the transcript width: remaining space after secondary panes.
  const secondaryTotal = secondaryPanes.reduce((sum, p) => sum + p.size, 0)
  const transcriptSize = input.width - secondaryTotal

  // Guard minimum widths.
  const panes: PaneState[] = [
    {
      id: "transcript",
      visible: true,
      size: Math.max(transcriptSize, MIN_PANE_WIDTH),
      resizable: true,
      label: "Transcript",
    },
    ...secondaryPanes,
  ]

  return {
    axis: "x",
    panes,
    showSeparators: true,
    diffSplitView: transcriptWide,
    active: true,
  }
}