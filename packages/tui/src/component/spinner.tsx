import { Show } from "solid-js"
import { createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import "opentui-spinner/solid"
import { createStreamingColors, createStreamingFrames, MIN_STREAM_WIDTH } from "../ui/spinner"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={
        <text fg={color()} aria-label="loading">
          ⋯ {props.children}
        </text>
      }
    >
      <box flexDirection="row" gap={1} aria-label="loading">
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
  const width = () => props.width ?? 10
  const frames = createMemo(() =>
    createStreamingFrames({ color: color(), width: width(), inactiveFactor: 0.18, minimal: width() < MIN_STREAM_WIDTH }),
  )
  const colors = createMemo(() =>
    createStreamingColors({ color: color(), width: width(), inactiveFactor: 0.18, minimal: width() < MIN_STREAM_WIDTH }),
  )
  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={
        <text fg={color()} aria-label="streaming">
          {"▁".repeat(width())} {props.children}
        </text>
      }
    >
      <box flexDirection="row" gap={1} aria-label="streaming">
        <spinner frames={frames()} color={colors()} interval={props.interval ?? 60} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
