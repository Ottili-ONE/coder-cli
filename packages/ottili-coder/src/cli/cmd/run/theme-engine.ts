// Consolidated theme engine for the direct interactive run view.
//
// This module owns the brand palette source, terminal capability detection,
// and explicit override resolution. It does NOT own reactive state, refresh
// loops, or SolidJS context — those stay in the TUI theme provider and the
// run footer. The run view (`run/theme.ts`) consumes this engine to map a
// resolved theme into the scrollback/footer `RunTheme` color model.
//
// Design contract: specs/tui/theme-engine.md (T-CLI-0216 / T-CLI-0217).
import { RGBA, type TerminalColors } from "@opentui/core"
import { allThemes, hasTheme, resolveTheme, resolveThemeName } from "@opencode-ai/tui/theme"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

// ---------------------------------------------------------------------------
// Ottili brand palette — the single source of truth for brand role colors.
// ---------------------------------------------------------------------------

// Dark Ottili palette variant. Mirrors packages/tui/src/theme/assets/ottiliCoder.json
// so the run view and the TUI app share one brand source.
export const OTILI_BRAND_THEME = {
  $schema: "https://ottili.one/coder/theme.json",
  defs: {
    step1: "#0d0a08",
    step2: "#161311",
    step3: "#1f1b18",
    step4: "#282320",
    step5: "#322c28",
    step6: "#3c3531",
    step7: "#483f39",
    step8: "#5a514a",
    step9: "#f97316",
    step10: "#fb923c",
    step11: "#7d7670",
    step12: "#eae6e1",
    secondary: "#78716c",
    accent: "#a77fc4",
    red: "#e06c75",
    orange: "#f5a742",
    green: "#7fd88f",
    cyan: "#3b82f6",
    yellow: "#e5c07b",
  },
  theme: {
    primary: "step9",
    secondary: "secondary",
    accent: "accent",
    error: "red",
    warning: "orange",
    success: "green",
    info: "cyan",
    text: "step12",
    textMuted: "step11",
    selectedListItemText: "step1",
    background: "step1",
    backgroundPanel: "step2",
    backgroundElement: "step3",
    backgroundMenu: "step4",
    border: "step9",
    borderActive: "step10",
    borderSubtle: "step6",
    thinkingOpacity: 0.55,
    diffAdded: "green",
    diffRemoved: "red",
    diffContext: "step11",
    diffHunkHeader: "step11",
    diffHighlightAdded: "green",
    diffHighlightRemoved: "red",
    diffAddedBg: "#1a241c",
    diffRemovedBg: "#2a1a1c",
    diffContextBg: "step2",
    diffLineNumber: "#8f8f8f",
    diffAddedLineNumberBg: "#172119",
    diffRemovedLineNumberBg: "#241819",
    markdownText: "step12",
    markdownHeading: "accent",
    markdownLink: "step9",
    markdownLinkText: "step10",
    markdownCode: "green",
    markdownBlockQuote: "yellow",
    markdownEmph: "yellow",
    markdownStrong: "orange",
    markdownHorizontalRule: "step7",
    markdownListItem: "step9",
    markdownListEnumeration: "step11",
    markdownImage: "step9",
    markdownImageText: "step10",
    markdownCodeBlock: "step12",
    syntaxComment: "step11",
    syntaxKeyword: "accent",
    syntaxFunction: "step9",
    syntaxVariable: "red",
    syntaxString: "green",
    syntaxNumber: "orange",
    syntaxType: "yellow",
    syntaxOperator: "step11",
    syntaxPunctuation: "step12",
  },
} as const

// Light Ottili palette variant. Same brand accents (orange primary, plum accent)
// with inverted neutrals so the surface stays visibly Ottili on light terminals.
export const OTILI_BRAND_LIGHT_THEME = {
  $schema: "https://ottili.one/coder/theme.json",
  defs: {
    step1: "#faf9f7",
    step2: "#f1efec",
    step3: "#e7e3de",
    step4: "#ddd8d1",
    step5: "#cfc9c0",
    step6: "#b8b1a8",
    step7: "#a59d92",
    step8: "#8a8278",
    step9: "#f97316",
    step10: "#fb923c",
    step11: "#6b6660",
    step12: "#1a1714",
    secondary: "#78716c",
    accent: "#9d7cd8",
    red: "#d1535f",
    orange: "#c47e1f",
    green: "#3f9d57",
    cyan: "#2563eb",
    yellow: "#9a6b1f",
  },
  theme: {
    primary: "step9",
    secondary: "secondary",
    accent: "accent",
    error: "red",
    warning: "orange",
    success: "green",
    info: "cyan",
    text: "step12",
    textMuted: "step11",
    selectedListItemText: "step1",
    background: "step1",
    backgroundPanel: "step2",
    backgroundElement: "step3",
    backgroundMenu: "step4",
    border: "step9",
    borderActive: "step10",
    borderSubtle: "step6",
    thinkingOpacity: 0.55,
    diffAdded: "green",
    diffRemoved: "red",
    diffContext: "step11",
    diffHunkHeader: "step11",
    diffHighlightAdded: "green",
    diffHighlightRemoved: "red",
    diffAddedBg: "#dcefe1",
    diffRemovedBg: "#f6e2e4",
    diffContextBg: "step2",
    diffLineNumber: "#8f8f8f",
    diffAddedLineNumberBg: "#d2ecd8",
    diffRemovedLineNumberBg: "#f3d9db",
    markdownText: "step12",
    markdownHeading: "accent",
    markdownLink: "step9",
    markdownLinkText: "step10",
    markdownCode: "green",
    markdownBlockQuote: "yellow",
    markdownEmph: "yellow",
    markdownStrong: "orange",
    markdownHorizontalRule: "step7",
    markdownListItem: "step9",
    markdownListEnumeration: "step11",
    markdownImage: "step9",
    markdownImageText: "step10",
    markdownCodeBlock: "step12",
    syntaxComment: "step11",
    syntaxKeyword: "accent",
    syntaxFunction: "step9",
    syntaxVariable: "red",
    syntaxString: "green",
    syntaxNumber: "orange",
    syntaxType: "yellow",
    syntaxOperator: "step11",
    syntaxPunctuation: "step12",
  },
} as const

// ---------------------------------------------------------------------------
// Terminal capability detection (typed).
// ---------------------------------------------------------------------------

export type ColorDepth = "truecolor" | "256" | "16" | "unknown"

export type ThemeCapabilities = {
  // Highest color depth the terminal reports through its palette query.
  colorDepth: ColorDepth
  // OSC 11 default background present (terminal reports its own background).
  backgroundQuery: boolean
  // OSC 10 default foreground present.
  foregroundQuery: boolean
}

// Pure helper: derive capabilities from an already-fetched palette snapshot.
// Color depth follows palette length (>=256 -> truecolor, >=16 -> 256, >=1 -> 16).
export function capabilitiesFromPalette(colors: TerminalColors): ThemeCapabilities {
  const size = colors.palette?.length ?? 0
  const colorDepth: ColorDepth = size >= 256 ? "truecolor" : size >= 16 ? "256" : size >= 1 ? "16" : "unknown"
  return {
    colorDepth,
    backgroundQuery: Boolean(colors.defaultBackground),
    foregroundQuery: Boolean(colors.defaultForeground),
  }
}

// Query the renderer once and classify what the terminal can represent.
// Returns an all-unknown capability set if detection fails rather than throwing.
export async function detectCapabilities(renderer: {
  getPalette: (options?: { timeout?: number; size?: number }) => Promise<TerminalColors>
}): Promise<ThemeCapabilities> {
  try {
    const colors = await renderer.getPalette({ size: 256 })
    return capabilitiesFromPalette(colors)
  } catch {
    return {
      colorDepth: "unknown",
      backgroundQuery: false,
      foregroundQuery: false,
    }
  }
}

// ---------------------------------------------------------------------------
// Override resolution.
// ---------------------------------------------------------------------------

function modeOf(bg: RGBA): "dark" | "light" {
  return 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b > 0.5 ? "light" : "dark"
}

export type ResolveActiveThemeInput = {
  // Explicit user selection (config.theme / kv). Wins over the adaptive path.
  override?: string
  // Detected terminal capabilities (currently used to choose the brand variant
  // when no explicit override is supplied).
  capabilities?: ThemeCapabilities
  // Dark/light pick. Derived from the terminal background when omitted.
  mode?: "dark" | "light"
}

// Resolve the active brand-anchored theme.
//
// Override wins: a present, registered theme name resolves to that variant.
// Without an override, the capability-adaptive brand theme is returned (dark by
// default, light when the terminal background is light). The run view keeps its
// own terminal-adaptive system path for the no-override case to preserve
// byte-for-byte behavior; this resolver is the brand source of truth.
export function resolveActiveTheme(input: ResolveActiveThemeInput = {}): TuiThemeCurrent {
  const name = input.override
  if (name && hasTheme(name)) {
    return resolveTheme(allThemes()[resolveThemeName(name)]!, input.mode ?? "dark")
  }

  const mode = input.mode ?? (input.capabilities?.backgroundQuery ? "dark" : "dark")
  return resolveTheme(mode === "light" ? OTILI_BRAND_LIGHT_THEME : OTILI_BRAND_THEME, mode)
}

export { allThemes, hasTheme, resolveThemeName }
