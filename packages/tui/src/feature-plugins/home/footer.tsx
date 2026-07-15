import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Match, Show, Switch } from "solid-js"
import { BrandLabel } from "../../component/brand-label"
import { ThemeModeLabel } from "../../component/theme-mode-label"
import { GitStatusBar } from "../../component/git-status-bar"
import { abbreviateHome } from "../../runtime"
import { useTuiPaths } from "../../context/runtime"
import { useHomeSessionDestination } from "../../routes/home/session-destination"

const id = "internal:home-footer"

function Directory(props: { api: TuiPluginApi }) {
  const destination = useHomeSessionDestination()
  const paths = useTuiPaths()
  const dir = createMemo(() => {
    const selected = destination?.destination()
    const directory =
      selected?.type === "directory" ? selected.directory : props.api.state.path.directory || paths.cwd
    return abbreviateHome(directory, paths.home)
  })

  return <text fg={theme().textMuted}>{dir()}</text>
}

function Mcp(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const has = createMemo(() => list().length > 0)
  const err = createMemo(() => list().some((item) => item.status === "failed"))
  const count = createMemo(() => list().filter((item) => item.status === "connected").length)

  return (
    <Show when={has()}>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <text fg={theme().text}>
          <Switch>
            <Match when={err()}>
              <span style={{ fg: theme().error }}>⊙ </span>
            </Match>
            <Match when={true}>
              <span style={{ fg: count() > 0 ? theme().success : theme().textMuted }}>⊙ </span>
            </Match>
          </Switch>
          {count()} MCP
        </text>
        <text fg={theme().textMuted}>/status</text>
      </box>
    </Show>
  )
}

function providerReady(api: TuiPluginApi) {
  return api.state.provider.some(
    (item) => item.id !== "ottili-coder" || Object.values(item.models).some((model) => model.cost?.input !== 0),
  )
}

function Setup(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const connected = createMemo(() => providerReady(props.api))
  const account = createMemo(() => props.api.state.account())

  return (
    <Show when={!connected() || !account().loggedIn}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <Show when={!connected()}>
          <text fg={theme().primary}>/connect</text>
        </Show>
        <Show when={!account().loggedIn}>
          <text fg={theme().textMuted}>/login</text>
        </Show>
      </box>
    </Show>
  )
}

function Account(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const status = createMemo(() => props.api.state.account())

  return (
    <Show when={status().loggedIn ? status() : undefined}>
      {(account) => (
        <box flexShrink={0} flexDirection="row" gap={1}>
          <text fg={theme().success}>●</text>
          <text fg={theme().textMuted}>
            {account().email}
            {account().orgName ? ` · ${account().orgName}` : ""}
          </text>
          <text fg={theme().textMuted}>/usage</text>
          <text fg={theme().textMuted}>/logout</text>
        </box>
      )}
    </Show>
  )
}

function Cloud(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const status = createMemo(() => props.api.state.cloud())

  return (
    <Show when={status().configured ? status() : undefined}>
      {(cloud) => (
        <box flexShrink={0} flexDirection="row" gap={1}>
          <text fg={(cloud().activeJobs ?? 0) > 0 ? theme().info : theme().textMuted}>cloud</text>
          <text fg={theme().textMuted}>
            {(cloud().activeJobs ?? 0) > 0 ? `${cloud().activeJobs} active` : "ready"}
          </text>
          <text fg={theme().textMuted}>/cloud</text>
        </box>
      )}
    </Show>
  )
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current

  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexShrink={0}
      gap={1}
      border={["top"]}
      borderColor={theme().borderSubtle}
    >
      <Directory api={props.api} />
      <GitStatusBar api={props.api} />
      <box flexDirection="row" flexShrink={0} gap={2} alignItems="center">
        <Mcp api={props.api} />
        <Setup api={props.api} />
        <Account api={props.api} />
        <Cloud api={props.api} />
        <ThemeModeLabel mode={props.api.theme.mode()} muted={theme().textMuted} />
        <box flexGrow={1} />
        <BrandLabel fg={theme().text} muted={theme().textMuted} version={props.api.app.version} compact />
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
