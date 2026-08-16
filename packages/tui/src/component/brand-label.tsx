import { TextAttributes } from "@opentui/core"
import { Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"

export function BrandLabel(props: {
  fg?: RGBA
  muted?: RGBA
  version?: string
  compact?: boolean
}) {
  const { theme } = useTheme()
  const fg = () => props.fg
  const muted = () => props.muted

  return (
    <text fg={muted()}>
      <Show when={!props.compact}>
        <span style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>✻ </span>
      </Show>
      <span style={{ fg: fg() ?? theme.text, attributes: TextAttributes.BOLD }}>Ottili Coder</span>
      <Show when={props.version}>
        <span style={{ fg: muted() }}> {props.version}</span>
      </Show>
    </text>
  )
}
