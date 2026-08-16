/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import {
  type CheckInput,
  type CheckStatus,
  type BuildValidationContext,
  type ReleaseGate,
  RENDER_BUDGET_DEFAULT,
  NARROW_WIDTH_DEFAULT,
  buildState,
  checkStatusGlyph,
  checkStatusLabel,
  effectiveSelection,
  fitWidth,
  formatDuration,
  hiddenCheckCount,
  isNarrowTerminal,
  moveSelection,
  nextFilter,
  redactFailure,
  releaseGate,
  supportsColor,
  summary,
  visibleCheckIds,
} from "./model"

export interface BuildValidationProps {
  /** Sparse check updates streamed from the harness (id + status + extras). */
  checks: Accessor<CheckInput[]>
  /** A validation run is currently executing. */
  running?: Accessor<boolean>
  /** Initial discovery / first load is in flight. */
  loading?: Accessor<boolean>
  /** Connection to the harness / workspace is available. */
  connected?: Accessor<boolean>
  /** Permission to run validation is granted. */
  permitted?: Accessor<boolean>
  /** The run finished but some checks could not be collected or executed. */
  partial?: Accessor<boolean>
  /** Harness-level error (build failure, crash, discovery error). */
  error?: Accessor<string | undefined>
  /** Active color level (0 = none … 3 = full). Controls glyph rendering. */
  colorLevel?: number | Accessor<number>
  /** Max rows rendered before the budget cap. */
  renderBudget?: number
  /** Terminal width below which secondary columns are dropped. */
  narrowWidth?: number
  /** Fired with the focused check id when the user activates it (enter). */
  onSelect?: (id: string) => void
  /** Fired with the focused check id when the user reruns it (r). */
  onRerun?: (id: string) => void
  /** Fired with the focused check's (redacted) error when the user copies it (y). */
  onCopy?: (text: string) => void
}

function resolveBoolean(value: Accessor<boolean | undefined> | undefined, fallback: boolean): boolean {
  return value ? (value() ?? fallback) : fallback
}

function resolveLevel(level: number | Accessor<number> | undefined): number {
  if (level === undefined) return 3
  return typeof level === "function" ? level() : level
}

function statusColor(status: CheckStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "passed":
      return theme.success
    case "failed":
      return theme.error
    case "skipped":
      return theme.textMuted
    case "running":
      return theme.info
    case "queued":
      return theme.textMuted
  }
}

function gateColor(gate: ReleaseGate, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (gate.status) {
    case "ready":
      return theme.success
    case "warning":
      return theme.warning
    case "blocked":
      return theme.error
    case "unknown":
      return theme.textMuted
  }
}

export function BuildValidation(props: BuildValidationProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const narrow = () => isNarrowTerminal(width(), props.narrowWidth ?? NARROW_WIDTH_DEFAULT)
  const useColor = () => supportsColor(resolveLevel(props.colorLevel))
  const renderBudget = () => props.renderBudget ?? RENDER_BUDGET_DEFAULT

  const ctx = (): BuildValidationContext => ({
    connected: resolveBoolean(props.connected, true),
    permitted: resolveBoolean(props.permitted, true),
    running: resolveBoolean(props.running, false),
    loading: resolveBoolean(props.loading, false),
    partial: resolveBoolean(props.partial, false),
    error: props.error ? props.error() : undefined,
  })

  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal<Parameters<typeof nextFilter>[0]>("all")
  const [showAll, setShowAll] = createSignal(false)
  const [copied, setCopied] = createSignal<string | null>(null)

  const state = createMemo(() =>
    buildState(props.checks(), ctx(), {
      selectedId: selectedId(),
      filter: filter(),
      showAll: showAll(),
      renderBudget: renderBudget(),
      narrowWidth: props.narrowWidth ?? NARROW_WIDTH_DEFAULT,
    }),
  )

  const visible = createMemo(() => visibleCheckIds(state()))
  const gate = createMemo(() => releaseGate(state()))
  const hidden = createMemo(() => hiddenCheckCount(state()))
  const selected = createMemo(() => effectiveSelection(state()))

  createEffect(() => {
    const valid = effectiveSelection(state())
    if (valid !== selectedId()) setSelectedId(valid)
  })

  function copyFocused() {
    const id = selected()
    const check = state().byId[id ?? ""]
    if (!check || !check.error) return
    setCopied(check.error)
    props.onCopy?.(check.error)
  }

  function rerunFocused() {
    const id = selected()
    if (id) props.onRerun?.(id)
  }

  useKeyboard((event) => {
    switch (event.name) {
      case "up":
        setSelectedId(moveSelection(state(), -1))
        break
      case "down":
        setSelectedId(moveSelection(state(), 1))
        break
      case "f":
        setFilter(nextFilter(filter()))
        break
      case "e":
        if (hidden() > 0 || state().status === "long-content") setShowAll(!showAll())
        break
      case "g":
        setSelectedId("release-gate")
        setFilter("all")
        break
      case "y":
        copyFocused()
        break
      case "r":
        rerunFocused()
        break
      case "return":
      case "enter": {
        const id = selected()
        if (id) props.onSelect?.(id)
        break
      }
    }
  })

  return (
    <box id="build-validation" flexDirection="column" width={width()}>
      <text id="build-validation-header" live>
        {summary(state())}
      </text>
      <text id="build-validation-gate" fg={gateColor(gate(), theme)}>
        {`▸ ${gate().label} — ${gate().detail}`}
      </text>

      <Show when={filter() !== "all"}>
        <text id="build-validation-filter" fg={theme.textMuted}>
          {`filter: ${filter()} · press f to cycle`}
        </text>
      </Show>

      <Show when={visible().length > 0}>
        <box flexDirection="column">
          <For each={visible()}>
            {(id) => {
              const check = () => state().byId[id]
              const isSelected = () => selected() === id
              return (
                <box
                  id={`check-row-${id}`}
                  flexDirection="row"
                  gap={1}
                  flexWrap="no-wrap"
                  backgroundColor={isSelected() ? theme.backgroundElement : theme.background}
                >
                  <text>{isSelected() ? "> " : "  "}</text>
                  <text fg={useColor() ? statusColor(check().status, theme) : theme.text}>
                    {checkStatusGlyph(check().status, useColor())}
                  </text>
                  <text fg={theme.text} wrapMode="none">
                    {fitWidth(check().label, narrow() ? Math.max(8, width() - 8) : 14)}
                  </text>
                  <text fg={theme.textMuted}>{checkStatusLabel(check().status)}</text>
                  <Show when={!narrow() && (check().durationMs ?? 0) > 0}>
                    <text fg={theme.textMuted}>{formatDuration(check().durationMs)}</text>
                  </Show>
                  <Show when={!narrow() && check().details.length > 0}>
                    <text fg={theme.textMuted} wrapMode="none">
                      {fitWidth(check().details.join(" · "), Math.max(8, width() - 40))}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={hidden() > 0 && state().status === "long-content"}>
            <text id="build-validation-budget" fg={theme.textMuted}>
              {`${visible().length} shown · ${hidden()} more — press e to expand`}
            </text>
          </Show>
        </box>
      </Show>

      <Show when={selected() && state().byId[selected() ?? ""]?.description}>
        <text id="build-validation-detail" fg={theme.textMuted} wrapMode="none">
          {`  ${state().byId[selected() ?? ""]?.description} — ${state().byId[selected() ?? ""]?.command ?? ""}`}
        </text>
      </Show>

      <Show when={visible().some((id) => state().byId[id]?.status === "failed")}>
        <box flexDirection="column">
          <For each={visible().filter((id) => state().byId[id]?.status === "failed")}>
            {(id) => (
              <Show when={state().byId[id]?.error}>
                <text id={`check-error-${id}`} fg={theme.error} wrapMode="none">
                  {`  ${state().byId[id]?.label}: ${redactFailure(state().byId[id]?.error ?? "")}`}
                </text>
              </Show>
            )}
          </For>
        </box>
      </Show>

      <Show when={state().status === "empty"}>
        <text id="build-validation-empty" fg={theme.textMuted}>
          No validation checks
        </text>
      </Show>
      <Show when={state().status === "loading"}>
        <text id="build-validation-loading" fg={theme.textMuted}>
          Validating…
        </text>
      </Show>
      <Show when={state().status === "offline"}>
        <text id="build-validation-offline" fg={theme.warning}>
          Build &amp; validation unavailable — offline
        </text>
      </Show>
      <Show when={state().status === "denied"}>
        <text id="build-validation-denied" fg={theme.error}>
          Build &amp; validation hidden — insufficient permission
        </text>
      </Show>
      <Show when={state().status === "failure"}>
        <text id="build-validation-failure" fg={theme.error}>
          {`Build & validation failed: ${redactFailure(state().context.error ?? "unknown error")}`}
        </text>
      </Show>
      <Show when={state().status === "degraded"}>
        <text id="build-validation-degraded" fg={theme.warning}>
          Some checks did not run — showing available results
        </text>
      </Show>

      <text id="build-validation-footer" fg={theme.textMuted}>
        {"↑/↓ navigate · f filter · g gate · e expand · y copy · r rerun · ⏎ open"}
      </text>
    </box>
  )
}
