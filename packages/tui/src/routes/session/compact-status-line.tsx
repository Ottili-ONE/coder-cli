/** @jsxImportSource @opentui/solid */
// Compact mode status line (T-CLI-0210).
//
// Renders the derived Compact-view state as a single, non-interactive line. It
// is intentionally not focusable so it never steals or traps focus during
// streaming updates. State is conveyed in words (never color-only), the
// `aria-label` carries the spoken form for screen readers, and glyphs fall back
// to ASCII when the terminal cannot render color. Diagnostic text is already
// redacted upstream in `compact-state.ts`.

import { Show, type ParentComponent } from "solid-js"
import type { CompactViewState } from "./compact-state"

export interface CompactStatusColors {
  error: string
  warning: string
  info: string
  success: string
  text: string
  textMuted: string
  borderSubtle: string
}

const STATUS_GLYPH: Record<CompactViewState["status"], [string, string]> = {
  loading: ["↻", "..."],
  empty: ["·", "."],
  populated: ["●", "*"],
  "long-content": ["▤", "#"],
  failure: ["!", "!"],
  denied: ["⊘", "x"],
  offline: ["≈", "!"],
  degraded: ["~", "~"],
}

const FALLBACK_COLORS: CompactStatusColors = {
  error: "#ff5555",
  warning: "#ffb86c",
  info: "#8be9fd",
  success: "#50fa7b",
  text: "#f8f8f2",
  textMuted: "#6272a4",
  borderSubtle: "#44475a",
}

function colorFor(status: CompactViewState["status"], colors: CompactStatusColors): string {
  switch (status) {
    case "failure":
    case "denied":
      return colors.error
    case "offline":
    case "degraded":
      return colors.warning
    case "loading":
      return colors.info
    case "populated":
    case "long-content":
      return colors.text
    default:
      return colors.textMuted
  }
}

export const CompactStatusLine: ParentComponent<{
  state: CompactViewState
  colors?: CompactStatusColors
}> = (props) => {
  const colors = () => props.colors ?? FALLBACK_COLORS
  const glyph = () => (props.state.noColor ? STATUS_GLYPH[props.state.status][1] : STATUS_GLYPH[props.state.status][0])

  return (
    <box
      flexShrink={0}
      flexDirection="row"
      gap={1}
      paddingBottom={1}
      aria-label={props.state.accessibleSummary}
    >
      <text fg={colorFor(props.state.status, colors())}>{glyph()} </text>
      <text fg={props.state.noColor ? colors().text : colors().textMuted}>{props.state.summaryText}</text>
      <Show when={props.state.stale}>
        <text fg={colors().textMuted}> · updating…</text>
      </Show>
      <Show when={props.state.renderBudget.streamingOverBudget}>
        <text fg={colors().warning}> · large stream</text>
      </Show>
    </box>
  )
}
