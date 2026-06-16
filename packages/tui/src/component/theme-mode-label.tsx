import type { RGBA } from "@opentui/core"

export function ThemeModeLabel(props: { mode: "dark" | "light"; muted: RGBA; text?: RGBA }) {
  const label = () => (props.mode === "light" ? "light" : "dark")
  const icon = () => (props.mode === "light" ? "☀" : "☾")

  return (
    <text fg={props.muted}>
      {icon()} {label()}
    </text>
  )
}
