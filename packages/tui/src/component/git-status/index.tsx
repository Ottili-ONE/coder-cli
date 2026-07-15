/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show, type Accessor } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import {
  type GitBarAction,
  type GitBarContext,
  type GitRepoStatus,
  type GitSegment,
  NARROW_WIDTH_DEFAULT,
  actionFor,
  gitStatusState,
  moveFocus,
} from "./model"

export interface GitStatusBarProps {
  /** Git status streamed from the harness. */
  status: Accessor<GitRepoStatus>
  /** The directory is a git repository. */
  isGit?: Accessor<boolean>
  /** A status refresh is currently in flight. */
  loading?: Accessor<boolean>
  /** Harness-level error (git crash, repo corruption). */
  error?: Accessor<string | undefined>
  /** Active color level (0 = none … 3 = full). Controls glyph rendering. */
  colorLevel?: number | Accessor<number>
  /** Terminal width below which secondary segments are dropped. */
  narrowWidth?: number
  /** Fired with the focused segment's action when the user activates it (enter). */
  onAction?: (action: GitBarAction) => void
}

function resolveBoolean(value: Accessor<boolean | undefined> | undefined, fallback: boolean): boolean {
  return value ? (value() ?? fallback) : fallback
}

function resolveLevel(level: number | Accessor<number> | undefined): number {
  if (level === undefined) return 3
  return typeof level === "function" ? level() : level
}

function segmentColor(kind: GitSegment["kind"], theme: ReturnType<typeof useTheme>["theme"]) {
  switch (kind) {
    case "dirty":
      return theme.warning
    case "sync":
      return theme.info
    case "worktree":
      return theme.primary
    case "conflict":
      return theme.error
    case "branch":
    default:
      return theme.text
  }
}

export function GitStatusBar(props: GitStatusBarProps) {
  const dims = useTerminalDimensions()
  const { theme } = useTheme()
  const width = () => dims().width
  const narrowWidth = () => props.narrowWidth ?? NARROW_WIDTH_DEFAULT
  const useColor = () => resolveLevel(props.colorLevel) > 0

  const ctx = (): GitBarContext => ({
    isGit: resolveBoolean(props.isGit, true),
    loading: resolveBoolean(props.loading, false),
    error: props.error ? props.error() : undefined,
  })

  const [focusIndex, setFocusIndex] = createSignal(0)

  const state = createMemo(() =>
    gitStatusState(props.status(), ctx(), {
      focusIndex: focusIndex(),
      width: width(),
      narrowWidth: narrowWidth(),
    }),
  )

  const focused = createMemo(() =>
    state().focusIndex >= 0 ? state().segments[state().focusIndex] : undefined,
  )

  function activate() {
    const action = actionFor(state().focusedKind)
    if (action) props.onAction?.(action)
  }

  useKeyboard((event) => {
    switch (event.name) {
      case "left":
      case "up":
        setFocusIndex(moveFocus(state(), -1))
        break
      case "right":
      case "down":
        setFocusIndex(moveFocus(state(), 1))
        break
      case "return":
      case "enter":
        activate()
        break
    }
  })

  return (
    <box id="git-status-bar" flexDirection="row" gap={1} width={width()} flexWrap="no-wrap">
      <Show when={state().status === "not-git"}>
        <text id="git-status-not-git" fg={theme.textMuted}>
          not a git repository
        </text>
      </Show>

      <Show when={state().status === "error"}>
        <text id="git-status-error" fg={theme.error} wrapMode="none">
          {state().summaryText}
        </text>
      </Show>

      <Show when={state().status !== "not-git" && state().status !== "error"}>
        <box flexDirection="row" gap={1} flexWrap="no-wrap" alignItems="center">
          <Show when={state().stale}>
            <text id="git-status-stale" fg={theme.textMuted}>
              ⟳
            </text>
          </Show>
          <For each={state().segments}>
            {(segment, index) => {
              const isFocused = () => index() === state().focusIndex
              return (
                <text
                  id={`git-segment-${segment.kind}`}
                  fg={segmentColor(segment.kind, theme)}
                  backgroundColor={isFocused() ? theme.backgroundElement : theme.background}
                >
                  {`${isFocused() ? "> " : ""}${segment.glyph ? segment.glyph + " " : ""}${segment.label}${segment.detail ? " " + segment.detail : ""}`}
                </text>
              )
            }}
          </For>
        </box>
      </Show>

      <Show when={state().status === "syncing"}>
        <text id="git-status-syncing" fg={theme.textMuted}>
          syncing…
        </text>
      </Show>
    </box>
  )
}

export default GitStatusBar
