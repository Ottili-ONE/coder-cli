/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import type { Agent } from "@opencode-ai/sdk/v2"
import {
  type AgentRowStatus,
  type RosterAgentInput,
  type RosterContext,
  type RosterState,
  type RosterStatus,
  RENDER_BUDGET_DEFAULT,
  NARROW_WIDTH_DEFAULT,
  buildState,
  colorSupport,
  effectiveSelection,
  hiddenAgentCount,
  isNarrow,
  moveSelection,
  redactSensitive,
  rosterSummary,
  statusGlyph,
  statusLabel,
  truncate,
  visibleAgents,
} from "./model"

export interface AgentRosterProps {
  agents: Accessor<RosterAgentInput[]>
  loading?: Accessor<boolean>
  connected?: Accessor<boolean>
  permitted?: Accessor<boolean>
  error?: Accessor<string | undefined>
  partial?: Accessor<boolean>
  erroredNames?: Accessor<Iterable<string> | undefined>
  current?: Accessor<string | undefined>
  colorLevel?: number | Accessor<number>
  renderBudget?: number
  narrowWidth?: number
  maxDescriptionLen?: number
  onSelect?: (name: string) => void
  onExpand?: () => void
}

function resolveColorLevel(level: number | Accessor<number> | undefined): number {
  if (level === undefined) return 3
  return typeof level === "function" ? level() : level
}

function statusColor(status: AgentRowStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "ready":
      return theme.success
    case "denied":
      return theme.error
    case "offline":
      return theme.textMuted
    case "degraded":
      return theme.warning
  }
}

/** Map the SDK `Agent` into the roster's decoupled input shape. */
export function toRosterInput(agent: Agent): RosterAgentInput {
  return {
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
    builtIn: agent.builtIn,
    color: agent.color,
    prompt: agent.prompt,
    permission: agent.permission,
    model: agent.model,
  }
}

function hasRows(status: RosterStatus): boolean {
  return status === "populated" || status === "degraded" || status === "long-content"
}

export function AgentRoster(props: AgentRosterProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const narrow = () => isNarrow(width(), props.narrowWidth ?? NARROW_WIDTH_DEFAULT)

  const level = () => resolveColorLevel(props.colorLevel)
  const useColor = () => colorSupport(level()).useColor

  const list = () => props.agents() ?? []
  const ctx = (): RosterContext => ({
    connected: props.connected ? props.connected() : true,
    permitted: props.permitted ? props.permitted() : true,
    loading: props.loading ? props.loading() : false,
    partial: props.partial ? props.partial() : false,
    error: props.error ? props.error() : undefined,
    erroredNames: props.erroredNames ? props.erroredNames() : undefined,
  })

  const [selected, setSelected] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal("")
  const [showAll, setShowAll] = createSignal(false)

  const state = createMemo<RosterState>(() =>
    buildState(list(), ctx(), {
      selectedName: selected(),
      search: search(),
      showAll: showAll(),
      renderBudget: props.renderBudget ?? RENDER_BUDGET_DEFAULT,
      narrowWidth: props.narrowWidth ?? NARROW_WIDTH_DEFAULT,
    }),
  )

  const visible = createMemo(() => visibleAgents(state()))
  const summary = createMemo(() => rosterSummary(state()))
  const hidden = createMemo(() => hiddenAgentCount(state()))
  const selectedName = () => effectiveSelection(state())

  // Keep the selection signal in sync with the derived valid selection so focus
  // is retained (never lost or trapped) when the agent list updates underneath.
  createEffect(() => {
    const valid = effectiveSelection(state())
    if (valid !== selected()) setSelected(valid)
  })

  useKeyboard((event) => {
    switch (event.name) {
      case "up":
        setSelected(moveSelection(state(), -1))
        break
      case "down":
        setSelected(moveSelection(state(), 1))
        break
      case "e":
        if (state().status === "long-content") {
          setShowAll(!showAll())
          props.onExpand?.()
        }
        break
      case "enter":
      case "return": {
        const choice = effectiveSelection(state())
        if (choice) props.onSelect?.(choice)
        break
      }
    }
  })

  return (
    <box id="agent-roster" flexDirection="column" width={width()} selectable>
      <text id="agent-roster-status" live>
        {summary()}
      </text>

      <Show when={hasRows(state().status)}>
        <box flexDirection="column">
          <For each={visible()}>
            {(agent) => {
              const isSelected = () => selectedName() === agent.name
              const isCurrent = () => props.current?.() === agent.name
              return (
                <box
                  id={`agent-row-${agent.name}`}
                  selectable
                  flexDirection="row"
                  gap={1}
                  flexWrap="nowrap"
                  backgroundColor={isSelected() ? theme.backgroundElement : theme.background}
                >
                  <text>{isSelected() ? "> " : "  "}</text>
                  <text fg={useColor() ? statusColor(agent.status, theme) : theme.text}>
                    {statusGlyph(agent.status, useColor())}
                  </text>
                  <text fg={theme.text}>
                    <b>{agent.name}</b>
                  </text>
                  <text fg={theme.textMuted}>{statusLabel(agent.status)}</text>
                  <Show when={isCurrent()}>
                    <text fg={theme.textMuted}>current</text>
                  </Show>
                  <Show when={!narrow() && agent.description}>
                    <text fg={theme.textMuted} wrapMode="none">
                      {truncate(agent.description, Math.max(8, width() - 40))}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={hidden() > 0 && state().status === "long-content"}>
            <text id="agent-roster-budget" fg={theme.textMuted}>
              {`${visible().length} shown · ${hidden()} more — press e to expand`}
            </text>
          </Show>
        </box>
      </Show>

      <Show when={state().status === "empty"}>
        <text id="agent-roster-empty" fg={theme.textMuted}>
          No agents available
        </text>
      </Show>
      <Show when={state().status === "loading"}>
        <text id="agent-roster-loading" fg={theme.textMuted}>
          Loading agents…
        </text>
      </Show>
      <Show when={state().status === "offline"}>
        <text id="agent-roster-offline" fg={theme.warning}>
          Agent roster unavailable — offline
        </text>
      </Show>
      <Show when={state().status === "denied"}>
        <text id="agent-roster-denied" fg={theme.error}>
          Agent roster hidden — insufficient permission
        </text>
      </Show>
      <Show when={state().status === "failure"}>
        <text id="agent-roster-failure" fg={theme.error}>
          {`Failed to load agents: ${redactSensitive(state().context.error ?? "unknown error").text}`}
        </text>
      </Show>
      <Show when={state().status === "degraded"}>
        <text id="agent-roster-degraded" fg={theme.warning}>
          Some agents failed to load — showing what is available
        </text>
      </Show>
    </box>
  )
}
