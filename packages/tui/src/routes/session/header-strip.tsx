import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { useSync } from "../../context/sync"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { CostUsageMeter } from "../cost-usage"

export function SessionHeaderStrip(props: { sessionID: string; sidebarShortcut: string }) {
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const title = createMemo(() => {
    const value = session()?.title ?? "Session"
    if (value.length <= 48) return value
    return value.slice(0, 45) + "..."
  })
  const agent = createMemo(() => local.agent.current()?.name)
  const model = createMemo(() => local.model.parsed())

  return (
    <box
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
      gap={2}
      paddingTop={1}
      paddingBottom={1}
      border={["bottom"]}
      borderColor={theme.borderSubtle}
    >
      <box flexDirection="row" gap={1} flexGrow={1} minWidth={0}>
        <text fg={theme.text} attributes={TextAttributes.BOLD} flexShrink={0}>
          {title()}
        </text>
        <Show when={agent()}>
          {(name) => (
            <>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.primary}>{Locale.titlecase(name())}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.text}>{model().model}</text>
            </>
          )}
        </Show>
        <Show when={model().model}>
          <CostUsageMeter sessionID={props.sessionID} />
        </Show>
      </box>
      <text fg={theme.textMuted} flexShrink={0}>
        {props.sidebarShortcut} sidebar
      </text>
    </box>
  )
}
