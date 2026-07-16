/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { Flag } from "@opencode-ai/core/flag/flag"
import { computeResponsiveLayout, type ResponsiveLayoutState } from "./model"

// `useResponsiveLayout` is the single reactive entry point the session route
// switches to. It reads the live terminal dimensions (opentui re-renders on
// SIGWINCH) plus the focus/compact/sidebar kv preferences and resolves the
// full layout state through the pure `computeResponsiveLayout` model. Gated by
// the T-CLI-0212 feature flag so adoption is zero-regression when disabled.
export function useResponsiveLayout(params: {
  parentID: boolean
  focused: boolean
  sidebarOpen: boolean
  sidebarAuto: boolean
  compactMode: boolean
}) {
  const dimensions = useTerminalDimensions()
  const state = createMemo<ResponsiveLayoutState>(() =>
    computeResponsiveLayout({
      width: dimensions().width,
      height: dimensions().height,
      parentID: params.parentID,
      focused: params.focused,
      sidebarOpen: params.sidebarOpen,
      sidebarAuto: params.sidebarAuto,
      compactMode: params.compactMode,
      redesignEnabled: Flag.EVOLUTION_T_CLI_0212_TUI_REDESIGN_RESPONSIVE_TERMINAL_LAY_ENABLED,
    }),
  )
  return state
}
