import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useSync } from "../context/sync"
import { useConnected } from "./use-connected"
import { useTheme } from "../context/theme"

export type SetupAction = {
  command: string
  hint: string
  needed: boolean
}

export function useSetupActions() {
  const sync = useSync()
  const connected = useConnected()
  const account = createMemo(() => sync.data.account_status)

  return createMemo(() => {
    const actions: SetupAction[] = []
    const needsConnect = !connected()
    const needsLogin = !account().loggedIn

    if (needsConnect) {
      actions.push({ command: "/connect", hint: "AI providers", needed: true })
    }
    if (needsLogin) {
      actions.push({ command: "/login", hint: "Ottili account", needed: true })
    } else {
      actions.push({ command: "/usage", hint: "plan limits", needed: false })
    }

    actions.push({ command: "/cloud", hint: "cloud jobs", needed: false })
    actions.push({ command: "ctrl+p", hint: "commands", needed: false })

    return actions
  })
}

export function HomeSetupActions() {
  const { theme } = useTheme()
  const actions = useSetupActions()

  return (
    <box flexDirection="row" gap={3} flexShrink={0} paddingTop={1} paddingBottom={1}>
      <For each={actions()}>
        {(action) => (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text
              fg={action.needed ? theme.primary : theme.textMuted}
              attributes={action.needed ? TextAttributes.BOLD : undefined}
            >
              {action.command}
            </text>
            <text fg={theme.textMuted}>{action.hint}</text>
          </box>
        )}
      </For>
    </box>
  )
}

export function SetupHintRow(props: {
  needsConnect: boolean
  needsLogin: boolean
  showUsage?: boolean
  onConnect?: () => void
  onLogin?: () => void
  onUsage?: () => void
}) {
  const { theme } = useTheme()

  return (
    <Show when={props.needsConnect || props.needsLogin || props.showUsage}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <Show when={props.needsConnect}>
          <text
            fg={theme.primary}
            attributes={TextAttributes.BOLD}
            onMouseUp={props.onConnect}
          >
            /connect
          </text>
        </Show>
        <Show when={props.needsLogin}>
          <text fg={props.needsConnect ? theme.textMuted : theme.primary} onMouseUp={props.onLogin}>
            /login
          </text>
        </Show>
        <Show when={props.showUsage}>
          <text fg={theme.textMuted} onMouseUp={props.onUsage}>
            /usage
          </text>
        </Show>
      </box>
    </Show>
  )
}
