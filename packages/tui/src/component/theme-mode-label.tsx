import type { RGBA } from "@opentui/core"

export function ThemeModeLabel(props: { mode?: "dark" | "light"; muted: RGBA; text?: RGBA }) {
  // Ottili Coder is dark-only; the mode prop is accepted for API compatibility
  // but the label always renders as dark.
  void props.mode
  return (
    <text fg={props.muted}>
      ☾ dark
    </text>
  )
}
