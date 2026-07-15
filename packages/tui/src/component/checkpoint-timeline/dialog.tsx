/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { Show } from "solid-js"
import { useDialog } from "../../ui/dialog"
import { useTheme } from "../../context/theme"
import { useCheckpointTimeline } from "../../context/checkpoint"
import { CheckpointTimeline } from "./index"

/** Full /checkpoint dialog: the chronological checkpoint timeline. */
export function CheckpointTimelineDialog(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const controller = useCheckpointTimeline(props.sessionID)
  dialog.setSize("large")

  return (
    <Dialog onClose={dialog.clear} size="large">
      <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Checkpoint Timeline
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <CheckpointTimeline state={controller.state} onCopyResume={controller.copyResume} />
      </box>
    </Dialog>
  )
}
