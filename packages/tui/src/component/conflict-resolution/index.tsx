/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import {
  type ConflictAction,
  type ConflictContext,
  type ConflictFile,
  type ConflictSide,
  type ConflictType,
  NARROW_WIDTH_DEFAULT,
  abortAction,
  conflictResolutionState,
  continueAction,
  moveFocus,
  resolutionBadge,
  selectAction,
} from "./model"

export interface ConflictResolutionViewProps {
  /** Conflict list streamed from the harness. */
  files: Accessor<ReadonlyArray<ConflictFile>>
  /** The operation that produced the conflicts. */
  operation?: Accessor<ConflictType> | ConflictType
  /** A conflict list refresh is currently in flight. */
  loading?: Accessor<boolean>
  /** Harness-level error (git crash, corrupted index). */
  error?: Accessor<string | undefined>
  /** Terminal width below which secondary columns are dropped. */
  narrowWidth?: number
  /** Fired with the resolved action when the user activates a control. */
  onAction?: (action: ConflictAction) => void
}

function resolveValue<T>(value: T | Accessor<T> | undefined, fallback: T): T {
  if (value === undefined) return fallback
  return typeof value === "function" ? (value as Accessor<T>)() : value
}

export function ConflictResolutionView(props: ConflictResolutionViewProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const narrowWidth = () => props.narrowWidth ?? NARROW_WIDTH_DEFAULT

  const [resolutions, setResolutions] = createSignal<Record<string, ConflictSide>>({})
  const [focusIndex, setFocusIndex] = createSignal(0)

  const ctx = (): ConflictContext => ({
    loading: resolveValue(props.loading, false),
    error: props.error ? props.error() : undefined,
  })

  const operation = () => resolveValue(props.operation, props.files()[0]?.type ?? "unknown")

  // Apply local resolution overrides on top of the streamed conflict list so
  // keyboard resolution and live streaming updates compose without losing state.
  const resolvedFiles = createMemo<ConflictFile[]>(() => {
    const overrides = resolutions()
    return props.files().map((f) => (overrides[f.path] ? { ...f, resolution: overrides[f.path] } : f))
  })

  const state = createMemo(() =>
    conflictResolutionState(resolvedFiles(), ctx(), {
      focusIndex: focusIndex(),
      width: width(),
      narrowWidth: narrowWidth(),
      operation: operation(),
    }),
  )

  const focusedPath = () => state().focusedPath

  function applySide(side: ConflictSide) {
    const path = focusedPath()
    if (!path) return
    setResolutions({ ...resolutions(), [path]: side })
  }

  useKeyboard((event) => {
    switch (event.name) {
      case "up":
      case "left":
        setFocusIndex(moveFocus(state(), -1))
        break
      case "down":
      case "right":
        setFocusIndex(moveFocus(state(), 1))
        break
      case "o":
        applySide("ours")
        break
      case "t":
        applySide("theirs")
        break
      case "u":
        applySide("union")
        break
      case "m":
        applySide("manual")
        break
      case "return":
      case "enter": {
        const action = selectAction(focusedPath())
        if (action) props.onAction?.(action)
        break
      }
      case "c": {
        const action = continueAction(state().allResolved, state().unresolved)
        props.onAction?.(action)
        break
      }
      case "a":
        props.onAction?.(abortAction())
        break
    }
  })

  return (
    <box id="conflict-resolution" flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text id="conflict-header" fg={theme.text} attributes={TextAttributes.BOLD}>
          {state().summaryText}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onAction?.(abortAction())}>
          esc
        </text>
      </box>

      <Show when={state().status === "error"} fallback={
        <Show when={state().files.length > 0} fallback={
          <text id="conflict-empty" fg={theme.textMuted} wrapMode="word">
            No conflicts to resolve.
          </text>
        }>
          <box id="conflict-list" flexDirection="column" gap={0}>
            <For each={state().files}>
              {(file, index) => {
                const isFocused = () => index() === state().focusIndex
                return (
                  <text
                    id={`conflict-file-${file.path}`}
                    fg={file.resolution ? theme.success : theme.text}
                    backgroundColor={isFocused() ? theme.backgroundElement : theme.background}
                  >
                    {`${isFocused() ? "> " : "  "}${file.path}${state().narrow ? "" : "  "}${resolutionBadge(file)}`}
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
      }>
        <box id="conflict-error" flexDirection="column" gap={1}>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            Resolution failed
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {state().summaryText}
          </text>
        </box>
      </Show>

      <Show when={state().status !== "error"}>
        <box id="conflict-actions" flexDirection="row" gap={1} flexWrap="wrap">
          <text fg={theme.textMuted}>[o]urs [t]heirs [u]nion [m]anual</text>
          <text fg={state().allResolved ? theme.success : theme.textMuted}>[c]ontinue</text>
          <text fg={theme.warning}>[a]bort</text>
          <Show when={state().stale}>
            <text fg={theme.textMuted}>⟳ scanning…</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

export default ConflictResolutionView
