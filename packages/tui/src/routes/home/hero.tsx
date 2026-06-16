import { TextAttributes } from "@opentui/core"
import { createMemo } from "solid-js"
import { Logo } from "../../component/logo"
import { useTheme } from "../../context/theme"
import { useLocal } from "../../context/local"

export function HomeHero() {
  const { theme } = useTheme()
  const local = useLocal()
  const parsed = createMemo(() => local.model.parsed())

  const subtitle = createMemo(() => {
    if (parsed().model !== "No provider selected") {
      return `${parsed().model} · ${parsed().provider}`
    }
    return "Describe a task below — local agent or Ottili Cloud"
  })

  return (
    <box alignItems="center" flexShrink={0} gap={1} paddingBottom={1}>
      <Logo idle />
      <box alignItems="center" gap={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Ottili Coder
        </text>
        <text fg={theme.textMuted}>Autonomous developer · terminal + cloud</text>
        <text fg={theme.primary}>{subtitle()}</text>
      </box>
    </box>
  )
}
