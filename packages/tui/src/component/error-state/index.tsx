/** @jsxImportSource @opentui/solid */
import { createContext, useContext, type JSX, Show, For, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { InputRenderable, TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useConnected } from "../use-connected"
import { useDialog } from "../../ui/dialog"
import { useClipboard } from "../../context/clipboard"
import { SplitBorder } from "../../ui/border"
import { DialogMcp } from "../dialog-mcp"
import { DialogProvider as DialogProviderList } from "../dialog-provider"
import { redactSensitive } from "../agent-roster/model"
import {
  CATEGORY_LABEL,
  MAX_DEGRADED_STATES,
  SEVERITY_GLYPH,
  severityColor,
  colorEnabled,
  createDegradedQueue,
  isDegradedNarrow,
  presentState,
  severityText,
  type DegradedState,
} from "./model"

type DegradedStore = {
  /** Ad-hoc states pushed at runtime (e.g., session errors). */
  states: DegradedState[]
  /** Ids the user dismissed; filters out derived (signal-driven) states too. */
  dismissed: string[]
}

type DegradedApi = {
  store: DegradedStore
  push: (state: DegradedState) => void
  dismiss: (id: string) => void
  clear: () => void
}

const DegradedStateCtx = createContext<DegradedApi>()

export function DegradedStateProvider(props: { children: JSX.Element }) {
  const [store, setStore] = createStore<DegradedStore>({ states: [], dismissed: [] })
  const queue = createDegradedQueue((batch) =>
    setStore("states", (prev) => {
      let next = prev
      for (const state of batch) {
        next = [...next.filter((existing) => existing.id !== state.id), state].slice(-MAX_DEGRADED_STATES)
      }
      return next
    }),
  )
  const api: DegradedApi = {
    store,
    push: (state) => queue.push(state),
    dismiss: (id) => setStore("dismissed", (prev) => (prev.includes(id) ? prev : [...prev, id])),
    clear: () => {
      queue.flush()
      setStore({ states: [], dismissed: [] })
    },
  }
  return <DegradedStateCtx.Provider value={api}>{props.children}</DegradedStateCtx.Provider>
}

export function useDegradedState(): DegradedApi {
  const ctx = useContext(DegradedStateCtx)
  if (!ctx) throw new Error("useDegradedState must be used within a DegradedStateProvider")
  return ctx
}

/** Build the dialog/default action for a state's actionCommand. */
function resolveAction(api: DegradedApi, dialog: ReturnType<typeof useDialog>, state: DegradedState) {
  const command = state.actionCommand
  if (command === "mcp" || command?.startsWith("mcp")) {
    dialog.replace(() => <DialogMcp />)
  } else if (command === "connect" || command === "provider") {
    dialog.replace(() => <DialogProviderList />)
  }
  if (state.dismissible) api.dismiss(state.id)
}

/**
 * A single, presentational error/degraded row. Uses the Ottili palette
 * (severity → theme.error/warning/info), a left accent border, a category
 * badge, and mouse affordances (copy message, run action, dismiss).
 * Keyboard is handled by the aggregate <DegradedStates /> panel so this stays
 * safe to embed inside other keyboard-driven surfaces (test results, git bar).
 */
export function DegradedStateView(props: {
  state: DegradedState
  focused?: boolean
  onAction?: (state: DegradedState) => void
  onDismiss?: (id: string) => void
  onCopy?: (text: string) => void
}) {
  const { theme } = useTheme()
  const term = useTerminalDimensions()
  const presented = () => presentState(props.state)
  const color = () => colorEnabled()
  const accent = () => (color() ? severityColor(props.state.severity, theme) : theme.textMuted)
  const narrow = () => isDegradedNarrow(term().width)
  const headerLabel = () =>
    `${SEVERITY_GLYPH[props.state.severity]} ${severityText(props.state.severity)} · ${CATEGORY_LABEL[props.state.category]}`

  return (
    <box
      flexDirection="column"
      gap={0}
      backgroundColor={props.focused ? theme.backgroundElement : theme.backgroundPanel}
      borderColor={accent()}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box
        flexDirection={narrow() ? "column" : "row"}
        gap={1}
        alignItems={narrow() ? "flex-start" : "center"}
        justifyContent={narrow() ? "flex-start" : "space-between"}
      >
        <text attributes={TextAttributes.BOLD} fg={accent()}>
          {headerLabel()}
          <text fg={theme.text}>: {presented().title}</text>
        </text>
        <Show when={props.state.dismissible}>
          <text
            fg={theme.textMuted}
            onMouseUp={() => props.onDismiss?.(props.state.id)}
          >
            dismiss
          </text>
        </Show>
      </box>
      <text fg={theme.text} wrapMode="word" onMouseUp={() => props.onCopy?.(props.state.message)}>
        {presented().message}
      </text>
      <Show when={presented().detail}>
        <text fg={theme.textMuted} wrapMode="word">
          {presented().detail}
        </text>
      </Show>
      <Show when={props.state.actionLabel}>
        <box flexDirection="row" gap={1} paddingTop={1} justifyContent="flex-end">
          <box
            backgroundColor={theme.primary}
            paddingLeft={2}
            paddingRight={2}
            onMouseUp={() => props.onAction?.(props.state)}
          >
            <text fg={theme.selectedListItemText} attributes={TextAttributes.BOLD}>
              {props.state.actionLabel}
            </text>
          </box>
        </box>
      </Show>
    </box>
  )
}

/**
 * Aggregate panel wired into the real TUI. Composes ad-hoc states (session
 * errors) with signal-derived degraded states from live application state:
 * MCP server health and provider/network connectivity. Renders nothing when
 * there is nothing to surface. Supports mouse and keyboard (when the prompt
 * editor is not focused): ↑/↓ or j/k navigate, enter acts, c copies, esc/d
 * dismisses the focused state.
 */
export function DegradedStates(props: { max?: number }) {
  const api = useDegradedState()
  const sync = useSync()
  const connected = useConnected()
  const dialog = useDialog()
  const clipboard = useClipboard()
  const renderer = useRenderer()
  const [focus, setFocus] = createSignal(0)

  const derived = createMemo<DegradedState[]>(() => {
    const list: DegradedState[] = []
    const mcp = sync.data.mcp
    for (const [name, item] of Object.entries(mcp)) {
      if (item.status === "failed") {
        list.push({
          id: `mcp:${name}`,
          category: "mcp",
          severity: "error",
          title: `MCP server "${name}" failed`,
          message: typeof item.error === "string" ? item.error : "The MCP server stopped or could not start.",
          detail: "Open MCP settings to inspect and restart this server.",
          actionLabel: "MCP settings",
          actionCommand: "mcp",
          dismissible: true,
          createdAt: 0,
        })
      } else if (item.status === "needs_auth") {
        list.push({
          id: `mcp-auth:${name}`,
          category: "mcp",
          severity: "warning",
          title: `MCP server "${name}" needs authentication`,
          message: `Authenticate the "${name}" MCP server to enable its tools.`,
          actionLabel: "Authenticate",
          actionCommand: `mcp auth ${name}`,
          dismissible: true,
          createdAt: 0,
        })
      } else if (item.status === "needs_client_registration") {
        list.push({
          id: `mcp-reg:${name}`,
          category: "mcp",
          severity: "error",
          title: `MCP server "${name}" needs client registration`,
          message:
            typeof (item as { error?: unknown }).error === "string"
              ? ((item as { error: string }).error)
              : "The MCP client is not registered with this server.",
          actionLabel: "MCP settings",
          actionCommand: "mcp",
          dismissible: true,
          createdAt: 0,
        })
      }
    }
    if (!connected()) {
      list.push({
        id: "provider:disconnected",
        category: "network",
        severity: "warning",
        title: "No AI provider connected",
        message: "Connect a provider or sign in to Ottili to enable model requests.",
        actionLabel: "Connect",
        actionCommand: "connect",
        dismissible: false,
        createdAt: 0,
      })
    }
    return list
  })

  const all = createMemo<DegradedState[]>(() => {
    const map = new Map<string, DegradedState>()
    for (const state of derived()) map.set(state.id, state)
    for (const state of api.store.states) map.set(state.id, state)
    const visible = [...map.values()].filter((state) => !api.store.dismissed.includes(state.id))
    return visible.slice(-(props.max ?? MAX_DEGRADED_STATES))
  })

  const focusIndex = () => Math.min(focus(), Math.max(0, all().length - 1))

  function copy(text: string) {
    void clipboard.write?.(redactSensitive(text).text)
  }

  function act(state: DegradedState) {
    resolveAction(api, dialog, state)
  }

  useKeyboard((event) => {
    const list = all()
    if (list.length === 0) return
    const editor = renderer.currentFocusedEditor
    if (editor instanceof TextareaRenderable || editor instanceof InputRenderable) return
    const current = list[focusIndex()]
    if (!current) return
    if (event.name === "c") {
      copy(current.message)
      return
    }
    if (event.name === "escape" || event.name === "d") {
      api.dismiss(current.id)
      return
    }
    if (event.name === "return" || event.name === "enter") {
      if (current.actionCommand) act(current)
      return
    }
    if (event.name === "down" || event.name === "j") {
      setFocus((index) => Math.min(index + 1, list.length - 1))
      return
    }
    if (event.name === "up" || event.name === "k") {
      setFocus((index) => Math.max(index - 1, 0))
      return
    }
  })

  return (
    <Show when={all().length > 0}>
      <box
        aria-label={`${all().length} degraded state${all().length === 1 ? "" : "s"}`}
        flexDirection="column"
        gap={1}
        flexShrink={0}
        paddingBottom={1}
      >
        <For each={all()}>
          {(state) => (
            <DegradedStateView
              state={state}
              focused={state.id === all()[focusIndex()].id}
              onAction={act}
              onDismiss={(id) => api.dismiss(id)}
              onCopy={copy}
            />
          )}
        </For>
      </box>
    </Show>
  )
}
