/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import {
  type FilterMode,
  type TestCaseInput,
  type TestCaseStatus,
  type TestCaseView,
  type TestResultsContext,
  RENDER_BUDGET_DEFAULT,
  NARROW_WIDTH_DEFAULT,
  NAME_WIDTH_DEFAULT,
  buildState,
  effectiveSelection,
  hiddenTestCount,
  isNarrowTerminal,
  moveSelection,
  nextFilter,
  redactFailure,
  supportsColor,
  testStatusGlyph,
  testStatusLabel,
  testSummary,
  visibleTests,
  fitWidth,
} from "./model"

export interface TestResultsProps {
  /** Raw test cases. New cases are appended as the run streams results. */
  tests: Accessor<TestCaseInput[]>
  /** A test run is currently executing. */
  running?: Accessor<boolean>
  /** Initial discovery / first load is in flight. */
  loading?: Accessor<boolean>
  /** Connection to the harness / workspace is available. */
  connected?: Accessor<boolean>
  /** Permission to run tests is granted. */
  permitted?: Accessor<boolean>
  /** Harness-level error (build failure, crash, discovery error). */
  error?: Accessor<string | undefined>
  /** The run finished but some suites could not be collected or executed. */
  partial?: Accessor<boolean>
  /** Active color level (0 = none … 3 = full). Controls glyph rendering. */
  colorLevel?: number | Accessor<number>
  /** Max rows rendered before the budget cap. */
  renderBudget?: number
  /** Terminal width below which secondary columns are dropped. */
  narrowWidth?: number
  /** Visible-name width cap when not narrow. */
  nameWidth?: number
  /** Fired with the focused test id when the user activates it (enter). */
  onSelect?: (id: string) => void
  /** Fired with the focused test's (redacted) error when the user copies it. */
  onCopy?: (text: string) => void
}

function resolveBoolean(value: Accessor<boolean | undefined> | undefined, fallback: boolean): boolean {
  return value ? (value() ?? fallback) : fallback
}

function resolveLevel(level: number | Accessor<number> | undefined): number {
  if (level === undefined) return 3
  return typeof level === "function" ? level() : level
}

function statusColor(status: TestCaseStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "passed":
      return theme.success
    case "failed":
      return theme.error
    case "skipped":
      return theme.textMuted
    case "todo":
      return theme.warning
  }
}

export function TestResults(props: TestResultsProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const narrow = () => isNarrowTerminal(width(), props.narrowWidth ?? NARROW_WIDTH_DEFAULT)
  const useColor = () => supportsColor(props.colorLevel === undefined ? 3 : resolveLevel(props.colorLevel))
  const nameWidth = () => props.nameWidth ?? NAME_WIDTH_DEFAULT

  const ctx = (): TestResultsContext => ({
    connected: resolveBoolean(props.connected, true),
    permitted: resolveBoolean(props.permitted, true),
    running: resolveBoolean(props.running, false),
    loading: resolveBoolean(props.loading, false),
    partial: resolveBoolean(props.partial, false),
    error: props.error ? props.error() : undefined,
  })

  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal<FilterMode>("all")
  const [showAll, setShowAll] = createSignal(false)
  const [copied, setCopied] = createSignal<string | null>(null)

  const state = createMemo(() =>
    buildState(props.tests(), ctx(), {
      selectedId: selectedId(),
      filter: filter(),
      showAll: showAll(),
      renderBudget: props.renderBudget ?? RENDER_BUDGET_DEFAULT,
      narrowWidth: props.narrowWidth ?? NARROW_WIDTH_DEFAULT,
    }),
  )

  const visible = createMemo(() => visibleTests(state()))
  const summary = createMemo(() => testSummary(state()))
  const hidden = createMemo(() => hiddenTestCount(state()))
  const selected = createMemo(() => effectiveSelection(state()))

  // Keep the selection signal in sync with the derived valid selection so focus
  // is retained (never lost or trapped) as results stream in or filters change.
  createEffect(() => {
    const valid = effectiveSelection(state())
    if (valid !== selectedId()) setSelectedId(valid)
  })

  function copyFocused() {
    const id = selected()
    const test = state().byId[id ?? ""]
    if (!test || !test.error) return
    setCopied(test.error)
    props.onCopy?.(test.error)
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
        if (state().status === "long-content" || hidden() > 0) setShowAll(!showAll())
        break
      case "y":
        copyFocused()
        break
      case "return":
      case "enter": {
        const id = selected()
        if (id) props.onSelect?.(id)
        break
      }
    }
  })

  const headerId = () => `test-results-${state().status}`

  return (
    <box id="test-results" flexDirection="column" width={width()} selectable>
      <text id={headerId()} live>
        {summary()}
        <Show when={ctx().running && state().status !== "loading"}>
          <text fg={theme.textMuted}> · running…</text>
        </Show>
        <Show when={copied()}>
          <text fg={theme.success}> · copied</text>
        </Show>
      </text>

      <Show when={filter() !== "all" && hasRows(state().status)}>
        <text id="test-results-filter" fg={theme.textMuted}>
          {`filter: ${filter()} · press f to cycle`}
        </text>
      </Show>

      <Show when={hasRows(state().status)}>
        <box flexDirection="column">
          <For each={visible()}>
            {(test) => {
              const isSelected = () => selected() === test.id
              return (
                <box
                  id={`test-row-${test.id}`}
                  selectable
                  flexDirection="row"
                  gap={1}
                  flexWrap="nowrap"
                  backgroundColor={isSelected() ? theme.backgroundElement : theme.background}
                >
                  <text>{isSelected() ? "> " : "  "}</text>
                  <text fg={useColor() ? statusColor(test.status, theme) : theme.text}>
                    {testStatusGlyph(test.status, useColor())}
                  </text>
                  <text fg={theme.text} wrapMode="none">
                    {fitWidth(test.name, narrow() ? Math.max(8, width() - 8) : nameWidth())}
                  </text>
                  <text fg={theme.textMuted}>{testStatusLabel(test.status)}</text>
                  <Show when={!narrow() && test.file}>
                    <text fg={theme.textMuted} wrapMode="none">
                      {fitWidth(test.file, Math.max(8, width() - nameWidth() - 24))}
                    </text>
                  </Show>
                  <Show when={!narrow() && test.durationMs > 0}>
                    <text fg={theme.textMuted}>{`${test.durationMs}ms`}</text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={hidden() > 0 && state().status === "long-content"}>
            <text id="test-results-budget" fg={theme.textMuted}>
              {`${visible().length} shown · ${hidden()} more — press e to expand`}
            </text>
          </Show>
        </box>
      </Show>

      <Show when={visible().some((test) => test.status === "failed") && hasRows(state().status)}>
        <box flexDirection="column">
          <For each={visible().filter((test) => test.status === "failed")}>
            {(test) => (
              <Show when={test.error}>
                <text id={`test-error-${test.id}`} fg={theme.error} wrapMode="none">
                  {`  ${test.name}: ${redactFailure(test.error)}`}
                </text>
              </Show>
            )}
          </For>
        </box>
      </Show>

      <Show when={state().status === "empty"}>
        <text id="test-results-empty" fg={theme.textMuted}>
          No tests found
        </text>
      </Show>
      <Show when={state().status === "loading"}>
        <text id="test-results-loading" fg={theme.textMuted}>
          Loading test results…
        </text>
      </Show>
      <Show when={state().status === "offline"}>
        <text id="test-results-offline" fg={theme.warning}>
          Test results unavailable — offline
        </text>
      </Show>
      <Show when={state().status === "denied"}>
        <text id="test-results-denied" fg={theme.error}>
          Test results hidden — insufficient permission to run tests
        </text>
      </Show>
      <Show when={state().status === "failure"}>
        <text id="test-results-failure" fg={theme.error}>
          {`Test run failed: ${redactFailure(state().context.error ?? "unknown error")}`}
        </text>
      </Show>
      <Show when={state().status === "degraded"}>
        <text id="test-results-degraded" fg={theme.warning}>
          Some suites did not run — showing available results
        </text>
      </Show>

      <text id="test-results-footer" fg={theme.textMuted}>
        {"↑/↓ navigate · f filter · e expand · y copy error · ⏎ open"}
      </text>
    </box>
  )
}

/** Whether the current status should show the result rows. */
function hasRows(status: string): boolean {
  return status === "populated" || status === "degraded" || status === "long-content"
}
