import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTuiConfig } from "../../config"

const id = "internal:home-welcome"

function providerReady(api: TuiPluginApi) {
  return api.state.provider.some(
    (item) => item.id !== "ottili-coder" || Object.values(item.models).some((model) => model.cost?.input !== 0),
  )
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const contentMaxWidth = createMemo(() => {
    const configured = tuiConfig.prompt?.max_width
    if (configured === "auto") return Math.max(75, Math.floor(dimensions().width * 0.7))
    return configured ?? 75
  })
  const dismissed = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const fresh = createMemo(() => props.api.state.session.count() === 0)
  const show = createMemo(() => fresh() && !providerReady(props.api) && !dismissed())

  return (
    <box width="100%" maxWidth={contentMaxWidth()} alignItems="stretch" flexShrink={0}>
      <Show when={show()}>
        <box
          border={["left"]}
          borderColor={theme().primary}
          backgroundColor={theme().backgroundPanel}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          gap={1}
        >
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme().text}>
              <b>Get started in seconds</b>
            </text>
            <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
              ✕
            </text>
          </box>
          <text fg={theme().textMuted}>
            Ottili Coder ships with free models — type a task below and press Enter.
          </text>
          <text fg={theme().textMuted}>
            <span style={{ fg: theme().text }}>1.</span> Run{" "}
            <span style={{ fg: theme().primary }}>/connect</span> for Claude, GPT, Gemini and 75+ providers
          </text>
          <text fg={theme().textMuted}>
            <span style={{ fg: theme().text }}>2.</span> Run{" "}
            <span style={{ fg: theme().primary }}>/login</span> for your Ottili ONE plan and{" "}
            <span style={{ fg: theme().primary }}>/usage</span> limits
          </text>
          <text fg={theme().textMuted}>
            <span style={{ fg: theme().text }}>3.</span> Run{" "}
            <span style={{ fg: theme().primary }}>/cloud</span> for bigger autonomous builds
          </text>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      home_bottom() {
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
