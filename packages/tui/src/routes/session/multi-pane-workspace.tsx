/** @jsxImportSource @opentui/solid */
import { createMemo, Show, For, type Accessor } from "solid-js"
import { Panel, PanelGroup, Separator } from "../../feature-plugins/system/diff-viewer-ui"
import { useTheme } from "../../context/theme"
import { computeMultiPaneLayout, type MultiPaneInput, type PaneState } from "./multi-pane"
import type { JSX } from "@opentui/solid"

export interface MultiPaneWorkspaceProps {
  input: MultiPaneInput
  transcript: JSX.Element
  diff: JSX.Element
  files: JSX.Element
  tasks: JSX.Element
  terminal: JSX.Element
}

/**
 * Renders the multi-pane workspace layout.
 *
 * Layout tree:
 * ```
 * PanelGroup (axis "x")
 * ├── Panel (transcript pane)
 * │   └── {transcript slot}
 * ├── Separator (vertical, if showSeparators)
 * ├── Panel (secondary pane — diff/files/tasks/terminal)
 * └── Separator (horizontal bottom, if needed)
 * ```
 *
 * When the redesign flag is off, `computeMultiPaneLayout` returns the
 * single-pane legacy state and this component renders only the transcript,
 * matching today's behavior exactly (zero regression).
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

  return (
    <Show
      when={layout().active}
      fallback={<>{props.transcript}</>}
    >
      <PanelGroup axis={layout().axis} flexGrow={1} minHeight={0}>
        <For each={layout().panes}>
          {(pane, index) => (
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
              >
                <Show when={layout().panes.length > 1}>
                  <box
                    flexShrink={0}
                    paddingLeft={1}
                    paddingRight={1}
                    border={["bottom"]}
                    borderColor={theme.borderSubtle}
                  >
                    <text fg={theme.textMuted}>{paneLabel(pane)}</text>
                  </box>
                </Show>
                <box flexGrow={1} minHeight={0}>
                  {paneContent(pane)}
                </box>
              </Panel>
            </>
          )}
        </For>
      </PanelGroup>
    </Show>
  )
}

/**
 * Placeholder pane content shown when there is no real content yet.
 * Uses the Ottili palette consistently.
 */
export function PanePlaceholder(props: { label: string }) {
  const { theme } = useTheme()
  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      padding={2}
    >
      <text fg={theme.textMuted}>{props.label}</text>
    </box>
  )
}