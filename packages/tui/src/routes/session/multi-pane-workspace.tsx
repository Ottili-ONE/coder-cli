/** @jsxImportSource @opentui/solid */
import { createMemo, Show, For } from "solid-js"
import { Panel, PanelGroup, Separator } from "../../feature-plugins/system/diff-viewer-ui"
import { useTheme } from "../../context/theme"
import type { Theme } from "../../theme"
import {
  computeMultiPaneLayout,
  type MultiPaneInput,
  type PaneState,
  type PaneView,
  type PaneAccessibility,
  type PaneStatus,
  statusMarker,
  paneStatusLabel,
} from "./multi-pane"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"

export interface MultiPaneWorkspaceProps {
  input: MultiPaneInput
  transcript: JSX.Element
  diff: JSX.Element
  files: JSX.Element
  tasks: JSX.Element
  terminal: JSX.Element
}

const STATUS_HEADING: Record<PaneStatus, string> = {
  loading: "Loading…",
  offline: "Unavailable — offline",
  denied: "Access denied",
  failure: "Failed to load",
  empty: "No content yet",
  degraded: "Partial data",
  "long-content": "Large content — truncated",
  populated: "",
}

/**
 * Pane status foreground color keyed to status severity.
 */
function statusColor(status: PaneStatus, theme: Theme): RGBA {
  switch (status) {
    case "failure":
    case "offline":
      return theme.error
    case "denied":
      return theme.warning
    case "degraded":
      return theme.warning
    case "long-content":
      return theme.info
    case "loading":
      return theme.textMuted
    case "empty":
      return theme.textMuted
    case "populated":
      return theme.success
  }
}

/**
 * Renders the state-aware content for a pane based on its lifecycle view.
 * Never color-only: every state includes an explicit marker and text label.
 */
function PaneStateContent(props: {
  pane: PaneView
  content: JSX.Element
  narrow: boolean
  useColor: boolean
  theme: Theme
}) {
  const headingText = () => STATUS_HEADING[props.pane.status]

  // Populated state: render the actual content directly.
  if (props.pane.status === "populated") {
    return <box flexGrow={1} minHeight={0}>{props.content}</box>
  }

  // All non-populated states render a centered status message.
  const marker = () => statusMarker(props.pane.status, props.useColor)
  const label = () => paneStatusLabel(props.pane.status)
  const color = () => statusColor(props.pane.status, props.theme)
  const heading = () => headingText()

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      padding={1}
    >
      <text fg={color()}>
        {marker()} {heading()}
      </text>
      <Show when={!props.narrow}>
        <text fg={props.theme.textMuted}>({label()})</text>
      </Show>
    </box>
  )
}

/**
 * Renders the multi-pane workspace layout.
 *
 * Layout tree:
 * ```
 * PanelGroup (axis "x")
 * ├── Panel (transcript pane)
 * │   └── {transcript slot}  or state-aware fallback
 * ├── Separator (vertical, if showSeparators)
 * ├── Panel (secondary pane — diff/files/tasks/terminal)
 * │   └── {content slot} or state-aware fallback
 * ```
 *
 * When the redesign flag is off, `computeMultiPaneLayout` returns the
 * single-pane legacy state and this component renders only the transcript,
 * matching today's behavior exactly (zero regression).
 *
 * Each pane is rendered with:
 * - State-aware content (loading/empty/failure/denied/offline/degraded/long/populated)
 * - aria-label for accessibility
 * - Narrow-terminal fallbacks when width < 80
 * - Color fallback: ASCII markers when color is unavailable
 * - Redaction: sensitive data never reaches rendered output
 */
export function MultiPaneWorkspace(props: MultiPaneWorkspaceProps) {
  const { theme } = useTheme()
  const layout = createMemo(() => computeMultiPaneLayout(props.input))

  const paneContent = (pane: PaneState): JSX.Element => {
    switch (pane.id) {
      case "transcript":
        return props.transcript
      case "diff":
        return props.diff
      case "files":
        return props.files
      case "tasks":
        return props.tasks
      case "terminal":
        return props.terminal
    }
  }

  const paneLabel = (pane: PaneState): string => {
    switch (pane.id) {
      case "transcript":
        return "Transcript"
      case "diff":
        return "Diff"
      case "files":
        return "Files"
      case "tasks":
        return "Tasks"
      case "terminal":
        return "Terminal"
    }
  }

  const paneInfo = (pane: PaneState): { view: PaneView; aria: PaneAccessibility } | undefined => {
    const view = layout().paneViews[pane.id]
    const aria = layout().paneAria[pane.id]
    if (view && aria) return { view, aria }
    return undefined
  }

  return (
    <Show
      when={layout().active}
      fallback={<>{props.transcript}</>}
    >
      <PanelGroup axis={layout().axis} flexGrow={1} minHeight={0}>
        <For each={layout().panes}>
          {(pane, index) => {
            const info = paneInfo(pane)
            return (
              <>
                <Show when={index() > 0 && layout().showSeparators}>
                  <Separator
                    axis={layout().axis === "x" ? "y" : "x"}
                    start={index() === 1 ? "edge" : undefined}
                    end={index() === layout().panes.length - 1 ? "edge" : undefined}
                  />
                </Show>
                <Panel
                  border="start"
                  flexGrow={1}
                  minWidth={20}
                  minHeight={0}
                  flexDirection="column"
                  aria-label={info?.aria.ariaLabel ?? `${pane.id} pane`}
                >
                  <Show when={layout().panes.length > 1}>
                    <box
                      flexShrink={0}
                      paddingLeft={1}
                      paddingRight={1}
                      border={["bottom"]}
                      borderColor={theme.borderSubtle}
                    >
                      <Show when={info && layout().panes.length > 1} fallback={<text fg={theme.textMuted}>{paneLabel(pane)}</text>}>
                        <text fg={theme.textMuted}>
                          {info!.aria.statusMarker} {paneLabel(pane)}
                        </text>
                      </Show>
                    </box>
                  </Show>
                  <box flexGrow={1} minHeight={0}>
                    <Show when={info} fallback={paneContent(pane)}>
                      {(info) => (
                        <PaneStateContent
                          pane={info().view}
                          content={paneContent(pane)}
                          narrow={layout().narrow}
                          useColor={layout().useColor}
                          theme={theme}
                        />
                      )}
                    </Show>
                  </box>
                </Panel>
              </>
            )
          }}
        </For>
      </PanelGroup>
    </Show>
  )
}