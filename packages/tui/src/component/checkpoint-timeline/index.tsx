/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useTheme } from "../../context/theme"
import {
  CHECKPOINT_TIMELINE_MAX_EVENTS,
  STATUS_GLYPH,
  checkpointStatusIsEventful,
  colorTokenFor,
  detectNoColor,
  filterEvents,
  formatEventLine,
  nextFilter,
  statusColorToken,
  toggleExpanded,
  type CheckpointEvent,
  type CheckpointEventKind,
  type CheckpointTimelineState,
} from "./model"

export type CheckpointTimelineAction =
  | { type: "expand"; index: number }
  | { type: "cycleFilter" }
  | { type: "copyResume" }

export interface CheckpointTimelineProps {
  /** Pre-built timeline state (see `parseCheckpointTimeline`). */
  state: Accessor<CheckpointTimelineState>
  /** Copy the current resume point (nextAction) to the clipboard. */
  onCopyResume?: () => void
  onAction?: (action: CheckpointTimelineAction) => void
}

function accentColor(token: string, theme: ReturnType<typeof useTheme>["theme"]): RGBA {
  switch (token) {
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "error":
      return theme.error
    case "info":
      return theme.info
    case "secondary":
      return theme.secondary
    case "textMuted":
      return theme.textMuted
    default:
      return theme.text
  }
}

/**
 * Focusable, screen-reader oriented checkpoint timeline. Renders every
 * lifecycle state explicitly (loading / empty / populated / long-content /
 * failure / denied / offline / degraded), keeps color as a secondary signal
 * (state is always conveyed by a glyph + text), degrades right-to-left on
 * narrow / no-color terminals, and caps the rendered rows to the render
 * budget so rapid streams never overflow the frame.
 */
export function CheckpointTimeline(props: CheckpointTimelineProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => props.width ?? dims().width
  const noColor = detectNoColor()

  const [focusIndex, setFocusIndex] = createSignal(-1)
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = createSignal<CheckpointEventKind | "all">("all")

  const all = createMemo(() => filterEvents(props.state(), filter()))
  const rows = createMemo(() =>
    all().slice(0, Math.min(all().length, CHECKPOINT_TIMELINE_MAX_EVENTS)),
  )
  const truncated = createMemo(() => Math.max(0, all().length - rows().length))

  const status = () => props.state().status
  const eventful = () => checkpointStatusIsEventful(status())

  const moveClamp = (count: number, index: number, direction: 1 | -1): number => {
    if (count === 0) return -1
    if (index < 0) return direction === 1 ? 0 : count - 1
    return Math.min(count - 1, Math.max(0, index + direction))
  }

  useKeyboard((event) => {
    if (rows().length === 0) return
    switch (event.name) {
      case "up":
      case "left":
        setFocusIndex((i) => moveClamp(rows().length, i, -1))
        break
      case "down":
      case "right":
        setFocusIndex((i) => moveClamp(rows().length, i, 1))
        break
      case "return":
      case "enter":
      case "space": {
        const idx = focusIndex() >= 0 ? focusIndex() : 0
        const row = rows()[idx]
        if (row) {
          setExpanded((set) => toggleExpanded(new Set(set), row.id))
          props.onAction?.({ type: "expand", index: idx })
        }
        break
      }
      case "f":
        setFilter((current) => {
          const next = nextFilter(current)
          props.onAction?.({ type: "cycleFilter" })
          return next
        })
        break
      case "c":
        props.onCopyResume?.()
        props.onAction?.({ type: "copyResume" })
        break
    }
  })

  return (
    <box flexDirection="column" id="checkpoint-timeline" width={width()}>
      <text
        id="checkpoint-status"
        fg={accentColor(statusColorToken(status()), theme)}
        attributes={TextAttributes.BOLD}
      >
        {`${STATUS_GLYPH[status()]} ${props.state().statusText}`}
      </text>

      <Show when={eventful()}>
        <Show when={props.state().goal}>
          <text id="checkpoint-goal" fg={theme.text} attributes={TextAttributes.BOLD}>
            {`Goal: ${props.state().goal}`}
          </text>
        </Show>
        <Show when={props.state().mode}>
          <text id="checkpoint-mode" fg={theme.textMuted}>
            {`Mode: ${props.state().mode}${props.state().lastUpdated ? ` · Updated: ${props.state().lastUpdated}` : ""}`}
          </text>
        </Show>
        <Show when={props.state().currentMilestone}>
          <text id="checkpoint-current" fg={theme.textMuted}>
            {`Current milestone: ${props.state().currentMilestone}`}
          </text>
        </Show>
        <Show when={props.state().nextAction}>
          <text id="checkpoint-next" fg={theme.textMuted}>
            {`Next action: ${props.state().nextAction}`}
          </text>
        </Show>
        <Show when={props.state().blockers.length > 0}>
          <text id="checkpoint-blockers" fg={theme.warning}>
            {`Blockers: ${props.state().blockers.join("; ")}`}
          </text>
        </Show>

        <For each={rows()}>
          {(event: CheckpointEvent, i) => {
            const line = createMemo(() => formatEventLine(event, width(), { noColor }))
            const focused = () => focusIndex() === i()
            const color = focused() ? theme.primary : accentColor(colorTokenFor(event), theme)
            return (
              <box flexDirection="column">
                <text
                  id={`checkpoint-event-${event.id}`}
                  fg={color}
                  attributes={focused() ? TextAttributes.BOLD : undefined}
                  title={`${event.kind}${event.status ? `, ${event.status}` : ""}${event.severity ? `, severity ${event.severity}` : ""}: ${event.title}${event.detail ? ` — ${event.detail}` : ""}`}
                >
                  {`${focused() ? "> " : "  "}${line()}`}
                </text>
                <Show when={expanded().has(event.id) && event.detail}>
                  <text id={`checkpoint-event-detail-${event.id}`} fg={theme.textMuted} paddingLeft={2}>
                    {event.detail}
                  </text>
                </Show>
              </box>
            )
          }}
        </For>

        <Show when={truncated() > 0}>
          <text id="checkpoint-more" fg={theme.textMuted}>
            {`and ${truncated()} more events…`}
          </text>
        </Show>
      </Show>

      <Show when={props.state().stale}>
        <text id="checkpoint-stale" fg={theme.warning}>
          {"↻ updating…"}
        </text>
      </Show>

      <Show when={props.state().redacted}>
        <text id="checkpoint-redacted" fg={theme.textMuted}>
          {"secrets redacted from this view"}
        </text>
      </Show>

      <text id="checkpoint-a11y" fg={theme.textMuted}>
        {props.state().accessibleSummary}
      </text>

      <Show when={eventful()}>
        <text id="checkpoint-help" fg={theme.textMuted}>
          {`↑/↓ focus · ⏎ expand · f: ${filter()} · c copy resume`}
        </text>
      </Show>
    </box>
  )
}
