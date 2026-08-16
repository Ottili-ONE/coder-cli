/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"

export interface ConflictFileFilterProps {
  query: string
  onChange: (query: string) => void
  onClear: () => void
  onSubmit: (query: string) => void
  resultCount: number
}

/**
 * Minimal one-line filter display for the conflict file list.
 *
 * This is a **presentation-only** component. Keyboard handling is managed by
 * the parent (`ConflictResolutionView`) through its useKeyboard() handler.
 * The parent calls onChange/onClear/onSubmit in response to keystrokes when
 * filter mode is active.
 */
export function ConflictFileFilter(props: ConflictFileFilterProps) {
  const { theme } = useTheme()

  return (
    <box
      id="conflict-filter"
      flexDirection="row"
      gap={1}
      paddingLeft={0}
      paddingRight={0}
      paddingTop={0}
      paddingBottom={0}
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        Filter:
      </text>
      <text fg={theme.text}>
        {props.query || <span style={{ fg: theme.textMuted }}>type to filter...</span>}
      </text>
      <text
        fg={theme.textMuted}
        attributes={TextAttributes.BOLD}
        onMouseUp={() => props.onClear()}
      >
        ✕
      </text>
      <Show when={props.resultCount === 0 && props.query !== ""}>
        <text fg={theme.warning}>No matching conflicts</text>
      </Show>
    </box>
  )
}

export default ConflictFileFilter