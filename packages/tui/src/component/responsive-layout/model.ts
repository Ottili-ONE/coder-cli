// Responsive layout resolution (T-CLI-0212).
//
// Pure, Solid/engine-free layout math. Every decision is a function of
// explicit inputs so it can be unit-tested without mounting the TUI, mirroring
// the existing `focus.ts` / `compact-state.ts` pattern.
//
// This module is the single source of truth that replaces the ad-hoc
// `dimensions().width > 120` checks spread across `routes/session/index.tsx`
// (lines 365, 2603, 2657) and the duplicated `42`-column sidebar width
// (`sidebar.tsx:315`, `index.tsx:404`). The session route adopts it behind
// `Flag.EVOLUTION_T_CLI_0212_TUI_REDESIGN_RESPONSIVE_TERMINAL_LAY_ENABLED`
// (see §7 of specs/tui/responsive-terminal-layout.md); when the flag is off
// `computeResponsiveLayout` returns the exact legacy mapping, so the render
// path can switch to it with zero regression.

export type LayoutTier = "narrow" | "compact" | "standard" | "wide"

// Single source of truth for the width thresholds. The `standard` tier sits at
// the historical `> 120` docked-sidebar gate so existing behavior is preserved
// for terminals >= 120 cols; the new `narrow` (< 60) and `compact` (60–99)
// tiers add the staged degradation the legacy binary breakpoint lacked.
export const RESPONSIVE_BREAKPOINTS = {
  narrow: 60,
  compact: 100,
  standard: 120,
  wide: 120,
} as const

// Docked sidebar width. Centralized here so the docked render path and the
// content-width subtraction share one constant instead of a duplicated magic
// number.
export const SIDEBAR_DOCKED_WIDTH = 42

export function resolveLayoutTier(width: number): LayoutTier {
  if (width < RESPONSIVE_BREAKPOINTS.narrow) return "narrow"
  if (width < RESPONSIVE_BREAKPOINTS.compact) return "compact"
  if (width < RESPONSIVE_BREAKPOINTS.standard) return "standard"
  return "wide"
}

export type SidebarMode = "docked" | "overlay" | "hidden"
export type HeaderDensity = "full" | "condensed" | "minimal"
export type ToolDiffView = "split" | "unified"

export interface ResponsiveLayoutInput {
  width: number
  height: number
  parentID: boolean
  focused: boolean
  sidebarOpen: boolean
  sidebarAuto: boolean
  compactMode: boolean
  redesignEnabled: boolean
}

export interface ResponsiveLayoutState {
  tier: LayoutTier
  sidebarMode: SidebarMode
  sidebarWidth: number
  headerDensity: HeaderDensity
  toolDiffView: ToolDiffView
  contentPadding: number
  autoCompact: boolean
  redesignEnabled: boolean
}

// Legacy mapping: reproduces today's behavior exactly so the flag-off path is
// a no-op for users. Kept verbatim-intent with the existing `wide()` memo and
// the `computeSidebarVisible` contract in `focus.ts`.
function legacyLayout(input: ResponsiveLayoutInput): ResponsiveLayoutState {
  const legacyWide = input.width > 120
  let sidebarMode: SidebarMode = "hidden"
  if (!input.parentID && !input.focused) {
    if (input.sidebarOpen || (input.sidebarAuto && legacyWide)) {
      sidebarMode = legacyWide ? "docked" : "overlay"
    }
  }
  return {
    tier: resolveLayoutTier(input.width),
    sidebarMode,
    sidebarWidth: SIDEBAR_DOCKED_WIDTH,
    headerDensity: "full",
    toolDiffView: legacyWide ? "split" : "unified",
    contentPadding: 2,
    autoCompact: false,
    redesignEnabled: false,
  }
}

export function computeResponsiveLayout(input: ResponsiveLayoutInput): ResponsiveLayoutState {
  if (!input.redesignEnabled) return legacyLayout(input)

  const tier = resolveLayoutTier(input.width)

  // Mirrors the `computeSidebarVisible` contract (focus.ts): the auto sidebar
  // docks only when there is room (wide/standard) and is hidden otherwise; an
  // explicitly opened sidebar overlays on compact/narrow terminals instead of
  // stealing transcript width.
  const sidebarMode: SidebarMode =
    input.parentID || input.focused
      ? "hidden"
      : input.sidebarOpen
        ? tier === "narrow" || tier === "compact"
          ? "overlay"
          : "docked"
        : input.sidebarAuto
          ? tier === "wide" || tier === "standard"
            ? "docked"
            : "hidden"
          : "hidden"

  const headerDensity: HeaderDensity =
    input.focused ? "minimal" : tier === "narrow" || tier === "compact" ? "condensed" : "full"

  const toolDiffView: ToolDiffView = tier === "wide" ? "split" : "unified"

  // Width-driven density suggestion. Never overrides an explicit user
  // preference: manual `compact_mode` stays authoritative; `autoCompact` only
  // signals that small terminals should engage compact density by default.
  const autoCompact = !input.compactMode && (tier === "narrow" || tier === "compact")

  // Tighten transcript padding at small tiers (Claude Code-like density) but
  // never below 1 so the message left-rule stays aligned.
  const contentPadding = tier === "narrow" || tier === "compact" ? 1 : 2

  return {
    tier,
    sidebarMode,
    sidebarWidth: sidebarMode === "docked" ? SIDEBAR_DOCKED_WIDTH : 0,
    headerDensity,
    toolDiffView,
    contentPadding,
    autoCompact,
    redesignEnabled: true,
  }
}
