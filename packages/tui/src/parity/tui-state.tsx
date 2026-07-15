/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { Show, createMemo } from "solid-js"
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

// Ottili brand palette hex tokens (mirrors theme/themes/ottiliCoder.json), used
// for the state strip so it reads like the rest of the chrome and survives
// no-color terminals (the glyph + word title carry the meaning).
const ROLE_HEX: Record<ParityColorRole, string> = {
  accent: "#a77fc4",
  success: "#7fd88f",
  warning: "#f5a742",
  error: "#e06c75",
  info: "#f97316",
  text: "#7d7670",
}

/** Resolve whether the terminal can render color. Honors NO_COLOR / TERM=dumb. */
function useColorEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NO_COLOR) return false
  if (typeof process !== "undefined" && process.env.TERM === "dumb") return false
  if (typeof process === "undefined") return true
  return Boolean(process.stdout?.isTTY) || true
}

/**
 * Render a single parity state as a compact, always-legible TUI strip. The
 * strip shows a glyph + word title (so it survives no-color terminals), the
 * optional detail, and the hint line. The `title` backs a screen-reader
 * announcement so the state is announced, not just painted.
 */
export function ParityStateView(props: { state: ParityState }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const useColor = useColorEnabled()

  const view = createMemo(() =>
    parityStateView(props.state, { width: dimensions().width, useColor }),
  )

  return (
    <Show when={Flag.EVOLUTION_T_CLI_0245_TUI_REDESIGN_WEB_AND_DESKTOP_PARITY__ENABLED}>
      <Show when={view().status !== "hidden"}>
        <box flexDirection="row" gap={1} flexShrink={0} title={view().ariaLabel}>
          <text
            fg={useColor ? ROLE_HEX[view().colorRole] : theme.textMuted}
            attributes={TextAttributes.BOLD}
          >
            {view().glyph} {view().title}
          </text>
          <Show when={view().detail}>
            <text fg={theme.textMuted}>{view().detail}</text>
          </Show>
          <Show when={view().hint}>
            <text fg={theme.textMuted}>{view().hint}</text>
          </Show>
        </box>
      </Show>
    </Show>
  )
}

/**
 * Owns the rapid-stream coalescing queue for the parity state strip and exposes
 * `push` for callers (session route, sync, permissions) to announce state
 * changes. The queue keeps bursts of events from thrashing the renderer and
 * preserves focus during streaming (latest value wins, trailing flush).
 */
export function createTuiParityState() {
  const dimensions = useTerminalDimensions()
  const useColor = useColorEnabled()
  let current: ParityState = { status: "hidden" }

  const queue = createParityStateQueue((state) => {
    current = state
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
