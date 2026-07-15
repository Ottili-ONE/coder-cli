/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { Show, createMemo, type ParentProps } from "solid-js"
import { Flag } from "@opencode-ai/core/flag/flag"
import {
  type ParityState,
  type ParityColorRole,
  parityStateView,
  createParityStateQueue,
} from "@opencode-ai/ui/parity"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"

// TUI implementation of the shared parity state surface (specs/tui/web-desktop-
// parity.md §3, hardened in T-CLI-0246). Reuses the existing theme context and
// dimensions; introduces no new store. Every value is derived from the pure
// `parityStateView` model so the renderer stays a thin, deterministic pass-
// through — color is never the only signal, and the hint line collapses on
// narrow terminals and is suppressed entirely on no-color sessions.

/** Map a semantic color role onto an Ottili palette token. */
function colorOf(theme: ReturnType<typeof useTheme>["theme"], role: ParityColorRole): string {
  switch (role) {
    case "accent":
      return theme.accent
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "error":
      return theme.error
    case "info":
      return theme.info
    case "text":
    default:
      return theme.textMuted
  }
}

/** Resolve whether the terminal can render color. Honors NO_COLOR / TERM=dumb. */
function useColorEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NO_COLOR) return false
  if (typeof process !== "undefined" && process.env.TERM === "dumb") return false
  return typeof process === "undefined" || Boolean(process.stdout?.isTTY) || true
}

/**
 * Render a single parity state as a compact, always-legible TUI strip. The
 * strip shows a glyph + word title (so it survives no-color terminals), the
 * optional hint line, and any action keys. The aria label backs a screen-reader
 * live region so the state is announced, not just painted.
 */
export function ParityStateView(props: { state: ParityState }) {
  const themeCtx = useTheme()
  const dimensions = useTerminalDimensions()
  const useColor = useColorEnabled()

  const view = createMemo(() =>
    parityStateView(props.state, { width: dimensions().width, useColor }),
  )

  return (
    <Show when={Flag.EVOLUTION_T_CLI_0245_TUI_REDESIGN_WEB_AND_DESKTOP_PARITY__ENABLED}>
      <Show when={view().status !== "hidden"}>
        <box
          flexDirection="row"
          gap={1}
          flexShrink={0}
          aria-label={view().ariaLabel}
          role="status"
        >
          <text
            fg={useColor ? colorOf(themeCtx.theme, view().colorRole) : themeCtx.theme.textMuted}
            attributes={TextAttributes.BOLD}
          >
            {view().glyph} {view().title}
          </text>
          <Show when={view().detail}>
            <text fg={themeCtx.theme.textMuted}>{view().detail}</text>
          </Show>
          <Show when={view().hint}>
            <text fg={themeCtx.theme.textMuted}>{view().hint}</text>
          </Show>
        </box>
      </Show>
    </Show>
  )
}

/**
 * Owns the rapid-stream coalescing queue for the parity state strip and exposes
 * a `push` for callers (session route, sync, permissions) to announce state
 * changes. The queue keeps bursts of events from thrashing the renderer and
 * preserves focus during streaming (latest value wins, trailing flush).
 */
export function createTuiParityState() {
  const dimensions = useTerminalDimensions()
  const useColor = useColorEnabled()
  let current: ParityState = { status: "hidden" }

  const queue = createParityStateQueue((state) => {
    current = parityStateView(state, { width: dimensions().width, useColor }).status === "hidden"
      ? state
      : state
  })

  return {
    get current() {
      return current
    },
    push(state: ParityState) {
      queue.push(state)
    },
    flush() {
      queue.flush()
    },
    dispose() {
      queue.dispose()
    },
  }
}

/** Convenience wrapper that pushes a state and renders the result strip. */
export function ParityStateStrip(props: ParentProps<{ state: ParityState }>) {
  return <ParityStateView state={props.state} />
}
