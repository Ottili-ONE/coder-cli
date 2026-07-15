// Web & Desktop Parity — shared interaction contract (T-CLI-0245).
//
// Framework-free source of truth for the one-product / three-host interaction
// model. Imported by the TUI (opentui solid), the web app and the desktop
// renderer. Contains no UI-framework dependency so every host shares it
// verbatim. See specs/tui/web-desktop-parity.md for the full design.

export type ParityCommand =
  | "openSession"
  | "forkSession"
  | "approvePermission"
  | "openSettings"
  | "switchModel"
  | "toggleTheme"
  | "openCommandPalette"
  | "focusTranscript"
  | "attachFile"

export interface ParityCommandSpec {
  command: ParityCommand
  label: string
  description: string
  // Canonical keyboard binding per host (where the action is keyboard reachable).
  tuiBinding?: string
  webShortcut?: string
}

// One product vocabulary. The TUI keymap and the web keybind both resolve to
// these command names, so the same action is reachable on every host.
export const PARITY_COMMANDS: readonly ParityCommandSpec[] = [
  {
    command: "openSession",
    label: "Open session",
    description: "Start or open a session",
    tuiBinding: "<leader>n",
    webShortcut: "Mod+K · Open session",
  },
  {
    command: "forkSession",
    label: "Fork session",
    description: "Branch the current session from a message",
    tuiBinding: "<leader>f",
    webShortcut: "Mod+Shift+F",
  },
  {
    command: "approvePermission",
    label: "Approve permission",
    description: "Approve the pending permission request",
    tuiBinding: "a",
    webShortcut: "A",
  },
  {
    command: "openSettings",
    label: "Open settings",
    description: "Open the settings surface",
    tuiBinding: "<leader>,",
    webShortcut: "Mod+,",
  },
  {
    command: "switchModel",
    label: "Switch model",
    description: "Open the model switcher",
    tuiBinding: "<leader>m",
    webShortcut: "Mod+M",
  },
  {
    command: "toggleTheme",
    label: "Toggle theme",
    description: "Cycle the active theme",
    tuiBinding: "Shift+T",
    webShortcut: "Mod+Shift+T",
  },
  {
    command: "openCommandPalette",
    label: "Command palette",
    description: "Open the command palette",
    tuiBinding: "Mod+Shift+P",
    webShortcut: "Mod+K",
  },
  {
    command: "focusTranscript",
    label: "Focus transcript",
    description: "Focus the transcript surface",
    tuiBinding: "<leader>g",
    webShortcut: "Mod+Shift+L",
  },
  {
    command: "attachFile",
    label: "Attach file",
    description: "Attach a file to the prompt",
    tuiBinding: "<leader>a",
    webShortcut: "Mod+U",
  },
]

export function parityCommandSpec(command: ParityCommand): ParityCommandSpec | undefined {
  return PARITY_COMMANDS.find((spec) => spec.command === command)
}

export type ParityHost = "web" | "desktop" | "tui"

// Platform capabilities explicitly surfaced by the shared model. Components
// branch on these flags, never on `host` string literals scattered around.
export interface PlatformCapabilities {
  host: ParityHost
  osMenu: boolean
  autoUpdate: boolean
  wsl: boolean
  nativeFileDialog: boolean
  nativeNotification: boolean
  terminalWidth: boolean
  keyboardOnly: boolean
  browserA11y: boolean
}

export function tuiCapabilities(): PlatformCapabilities {
  return {
    host: "tui",
    osMenu: false,
    autoUpdate: false,
    wsl: false,
    nativeFileDialog: false,
    nativeNotification: false,
    terminalWidth: true,
    keyboardOnly: true,
    browserA11y: false,
  }
}

export function webCapabilities(): PlatformCapabilities {
  return {
    host: "web",
    osMenu: false,
    autoUpdate: false,
    wsl: false,
    nativeFileDialog: false,
    nativeNotification: true,
    terminalWidth: false,
    keyboardOnly: false,
    browserA11y: true,
  }
}

export function desktopCapabilities(): PlatformCapabilities {
  return {
    host: "desktop",
    osMenu: true,
    autoUpdate: true,
    wsl: true,
    nativeFileDialog: true,
    nativeNotification: true,
    terminalWidth: false,
    keyboardOnly: false,
    browserA11y: true,
  }
}

// Layout tier mirror of packages/tui/src/component/responsive-layout/model.ts
// so web/desktop density decisions match the TUI tiers (closes G3).
export type LayoutTier = "narrow" | "compact" | "standard" | "wide"

export const PARITY_BREAKPOINTS = {
  narrow: 60,
  compact: 100,
  standard: 120,
  wide: 120,
} as const

export function resolveLayoutTier(width: number): LayoutTier {
  if (width < PARITY_BREAKPOINTS.narrow) return "narrow"
  if (width < PARITY_BREAKPOINTS.compact) return "compact"
  if (width < PARITY_BREAKPOINTS.standard) return "standard"
  return "wide"
}

export type ParitySessionStatus = "idle" | "thinking" | "streaming" | "awaiting" | "error"

// Host-independent, named view of a session. The TUI data context and the web
// data context both expose equivalents; naming them identically lets the same
// command operate on either host (closes G1).
export interface ParitySessionModel {
  id: string
  status: ParitySessionStatus
  messages: number
  draft: string
  pendingPermission: boolean
  model: string
  contextUsage: number
  checkpoints: number
}

export interface ParitySurface {
  commands: Partial<Record<ParityCommand, () => void>>
  capabilities: PlatformCapabilities
  widths: LayoutTier
  toast(message: string, tone?: "info" | "success" | "warning" | "error"): void
  navigate(route: string): void
}
