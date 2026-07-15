import { Show } from "solid-js"
import { createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import "opentui-spinner/solid"
import { createStreamingColors, createStreamingFrames } from "../ui/spinner"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}

export function StreamingIndicator(props: {
  children?: JSX.Element
  color?: RGBA
  width?: number
  interval?: number
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.primary
  const frames = createMemo(() => createStreamingFrames({ color: color(), width: props.width, inactiveFactor: 0.18 }))
  const colors = createMemo(() =>
    createStreamingColors({ color: color(), width: props.width, inactiveFactor: 0.18 }),
  )
  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={<text fg={color()}>{"▁".repeat(props.width ?? 10)} {props.children}</text>}
    >
      <box flexDirection="row" gap={1}>
        <spinner frames={frames()} color={colors()} interval={props.interval ?? 60} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
