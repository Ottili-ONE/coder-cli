/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import { useDialog } from "../../ui/dialog"
import { useTheme } from "../../context/theme"
import { useCheckpointTimeline } from "../../context/checkpoint"

/** Compact session-header indicator for the checkpoint timeline. */
export function CheckpointStatusIndicator(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const controller = useCheckpointTimeline(props.sessionID)

  const open = () => dialog.replace(() => <CheckpointTimelineDialog sessionID={props.sessionID} />)

  return (
    <Show when={controller.state().status !== "loading"}>
      <box
        flexDirection="row"
        gap={1}
        flexShrink={0}
        alignItems="center"
        onMouseDown={open}
        title={controller.state().accessibleSummary}
      >
        <text fg={theme.textMuted}>checkpoint</text>
        <text fg={theme.text}>{controller.state().summaryText}</text>
      </box>
    </Show>
  )
}
