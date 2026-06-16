import { TextAttributes } from "@opentui/core"
import { Show } from "solid-js"
import type { RGBA } from "@opentui/core"

export function BrandLabel(props: {
  fg?: RGBA
  muted?: RGBA
  version?: string
  compact?: boolean
}) {
  const fg = () => props.fg
  const muted = () => props.muted

  return (
    <text fg={muted()}>
      <Show when={!props.compact}>
        <span style={{ fg: props.fg, attributes: TextAttributes.BOLD }}>● </span>
      </Show>
      <span style={{ fg: fg(), attributes: TextAttributes.BOLD }}>Ottili Coder</span>
      <Show when={props.version}>
        <span style={{ fg: muted() }}> {props.version}</span>
      </Show>
    </text>
  )
}
