/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type RGBA } from "@opentui/core"
import {
  RENDER_BUDGET_MS,
  renderUsageBar,
  detectNoColor,
  contextMeterState,
  moveFocus,
  actionFor,
  type ContextMeterAction,
  type ContextMeterContext,
  type ContextMeterMessage,
  type ContextMeterProvider,
  type ContextMeterStatus,
} from "./model"

export interface ContextMeterColors {
  primary: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  borderSubtle: RGBA
}

export interface ContextMeterProps {
  messages: Accessor<ContextMeterMessage[]>
  providers: Accessor<ContextMeterProvider[]>
  ctx: Accessor<ContextMeterContext>
  colors?: Accessor<ContextMeterColors>
  width?: number
  expanded?: boolean
  onAction?: (action: ContextMeterAction) => void
}

const STATUS_GLYPH: Record<ContextMeterStatus, string> = {
  loading: "↻",
  empty: "·",
  populated: "▮",
  "long-content": "▤",
  degraded: "?",
  failure: "⚠",
  denied: "⊘",
  offline: "≈",
}

function colorFor(status: ContextMeterStatus, colors: ContextMeterColors | undefined): RGBA | undefined {
  if (!colors) return undefined
  switch (status) {
    case "failure":
    case "denied":
      return colors.error
    case "offline":
    case "degraded":
      return colors.warning
    case "long-content":
      return colors.info
    case "populated":
      return colors.success
    default:
      return colors.text
  }
}

/**
 * Focusable, screen-reader oriented context usage meter. Renders every lifecycle
 * state explicitly, keeps color as a secondary signal (state is always conveyed
 * by a glyph + text), and samples streaming sources at most once per render
 * budget so rapid token deltas stay within the layout's frame time.
 */
export function ContextMeter(props: ContextMeterProps) {
  const dims = useTerminalDimensions()
  const width = () => props.width ?? dims().width
  const [focusIndex, setFocusIndex] = createSignal(0)

  const [sampledMessages, setSampledMessages] = createSignal(props.messages())
  const [sampledProviders, setSampledProviders] = createSignal(props.providers())
  let scheduled = false
  createEffect(() => {
    const nextMessages = props.messages()
    const nextProviders = props.providers()
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      setSampledMessages(nextMessages)
      setSampledProviders(nextProviders)
    }, RENDER_BUDGET_MS)
  })

  const state = createMemo(() =>
    contextMeterState(sampledMessages(), sampledProviders(), props.ctx(), {
      width: width(),
      expanded: props.expanded ?? true,
      focusIndex: focusIndex(),
    }),
  )

  useKeyboard((event) => {
    if (state().segments.length === 0) return
    switch (event.name) {
      case "up":
      case "left":
        setFocusIndex(moveFocus(state(), -1))
        break
      case "down":
      case "right":
        setFocusIndex(moveFocus(state(), 1))
        break
      case "return":
      case "enter":
      case "space":
        props.onAction?.(actionFor(state().focusedKind))
        break
    }
  })

  const colors = () => props.colors?.()

  return (
    <box flexDirection="column" id="context-meter" width={width()}>
      <text id="context-meter-status" fg={colorFor(state().status, colors())} attributes={TextAttributes.BOLD}>
        {`${STATUS_GLYPH[state().status]} ${state().summaryText}`}
      </text>
      <Show when={state().segments.length > 0}>
        <For each={state().segments}>
          {(seg) => {
            const focused = () =>
              state().focusIndex >= 0 && state().segments[state().focusIndex]?.kind === seg.kind
            const detail =
              seg.kind === "usage" && state().data?.usagePercent != null
                ? `${buildMeterBar(state().data.usagePercent, 10)} ${seg.detail}`
                : seg.detail
            return (
              <text
                id={`context-meter-seg-${seg.kind}`}
                fg={focused() && colors() ? colors()!.primary : colors()?.textMuted}
              >
                {`${focused() ? "> " : "  "}${seg.label}: ${detail}`}
              </text>
            )
          }}
        </For>
      </Show>
      <Show when={state().stale}>
        <text id="context-meter-stale" fg={colors()?.warning}>
          {"↻ updating…"}
        </text>
      </Show>
      <text id="context-meter-a11y" fg={colors()?.textMuted}>
        {state().accessibleSummary}
      </text>
      <Show when={state().segments.length > 0}>
        <text id="context-meter-help" fg={colors()?.textMuted}>
          {"↑/↓ focus · ⏎ details"}
        </text>
      </Show>
    </box>
  )
}
