import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { useSync } from "../../context/sync"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { CostUsageMeter } from "../cost-usage"
import { CheckpointStatusIndicator } from "../checkpoint-timeline/indicator"

export function SessionHeaderStrip(props: { sessionID: string; sidebarShortcut: string; condensed?: boolean }) {
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
      paddingTop={props.condensed ? 0 : 1}
      paddingBottom={props.condensed ? 0 : 1}
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
        <Show when={Flag.OTTILI_CODER_EXPERIMENTAL_CHECKPOINT_TIMELINE}>
          <CheckpointStatusIndicator sessionID={props.sessionID} />
        </Show>
      </box>
      <text fg={theme.textMuted} flexShrink={0}>
        {props.sidebarShortcut} sidebar
      </text>
    </box>
  )
}
