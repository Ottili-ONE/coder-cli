import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/use-connected"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"

// Self-contained status-label helpers for screen readers. Every status item
// renders its meaning in words so it survives no-color terminals and is
// announced, not just painted (WCAG 2.1 Success Criterion 1.1.1 / 1.4.1).

function permissionAriaLabel(count: number): string {
  return `${count} pending permission${count === 1 ? "" : "s"}`
}

function lspAriaLabel(count: number): string {
  return `${count} language ${count === 1 ? "server" : "servers"} active`
}

function mcpAriaLabel(count: number): string {
  return `${count} MCP ${count === 1 ? "server" : "servers"} connected`
}

function mcpErrorAriaLabel(count: number): string {
  return `${count} MCP ${count === 1 ? "server has" : "servers have"} connection errors`
}

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lspCount = createMemo(() => Object.keys(sync.data.lsp).length)
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const account = createMemo(() => sync.data.account_status)

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  const permissionCount = () => permissions().length

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started{" "}
              <span style={{ fg: theme.textMuted }}>/connect</span>
              <Show when={!account().loggedIn}>
                {" "}
                · <span style={{ fg: theme.textMuted }}>/login</span>
              </Show>
            </text>
          </Match>
          <Match when={!connected()}>
            <text fg={theme.primary}>/connect</text>
            <Show when={account().loggedIn}>
              <text fg={theme.textMuted}>/usage</text>
            </Show>
            <Show when={!account().loggedIn}>
              <text fg={theme.textMuted}>/login</text>
            </Show>
          </Match>
          <Match when={connected() && !account().loggedIn}>
            <text fg={theme.textMuted}>/login</text>
            <text fg={theme.textMuted}>/status</text>
          </Match>
          <Match when={connected() && account().loggedIn}>
            <Show when={permissionCount() > 0}>
              <text fg={theme.warning} aria-label={permissionAriaLabel(permissionCount())}>
                <span style={{ fg: theme.warning }}>△</span> {permissionCount()} Permission
                {permissionCount() > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text} aria-label={lspAriaLabel(lspCount())}>
              <span style={{ fg: lspCount() > 0 ? theme.success : theme.textMuted }}>•</span> {lspCount()} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text} aria-label={mcpError() ? mcpErrorAriaLabel(mcp()) : mcpAriaLabel(mcp())}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
            <text fg={theme.textMuted}>/usage</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
