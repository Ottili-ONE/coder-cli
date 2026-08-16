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
  /** Current rendered lifecycle state (loading/empty/populated/…/degraded). */
  state: ParityState
  toast(message: string, tone?: "info" | "success" | "warning" | "error"): void
  navigate(route: string): void
}

// ---------------------------------------------------------------------------
// Parity state surface — hardened for all rendered states (T-CLI-0246).
//
// The interaction vocabulary (ParityCommand / ParitySurface, above) defines
// *what* you can do; this state model defines *how every lifecycle state is
// rendered* so the TUI, web app and desktop renderer behave identically. Every
// state is intentionally rendered and actionable (none dropped on the floor),
// every value is redaction-bounded, and narrow / no-color terminals fall back
// to word + glyph cues. The view model is pure so it can be unit tested in
// isolation; the host renderers stay thin.
// ---------------------------------------------------------------------------

/**
 * The eight intentionally-rendered parity states. `hidden` means nothing to
 * show. Every state is rendered and actionable; none is silently dropped.
 */
export type ParityState =
  | { status: "hidden" }
  | { status: "loading"; detail?: string }
  | { status: "empty"; detail?: string }
  | {
      status: "populated"
      title: string
      detail?: string
      actions?: ParityAction[]
    }
  | {
      status: "long-content"
      title: string
      detail: string
      actions?: ParityAction[]
    }
  | { status: "failure"; error: string; retry?: boolean }
  | { status: "denied"; resource: string }
  | { status: "offline"; detail?: string }
  | { status: "degraded"; detail: string }

/** A keyboard/mouse affordance rendered for an actionable state. */
export type ParityAction = {
  key: string
  label: string
  command: ParityCommand | "retry" | "dismiss"
}

/** Semantic color role the host maps onto its palette tokens. */
export type ParityColorRole = "accent" | "success" | "warning" | "error" | "info" | "text"

/** Presentational view of a parity state. Pure output of `parityStateView`. */
export type ParityStateView = {
  status: ParityState["status"]
  glyph: string
  /** Headline, already redacted and budget-capped. */
  title: string
  /** Supporting copy (redacted, capped). Empty when not applicable. */
  detail: string
  /** Keyboard hint line; dropped on narrow terminals. */
  hint: string
  colorRole: ParityColorRole
  /** Action affordances for this state. */
  actions: ParityAction[]
  /** Width tier that drove truncation. */
  tier: LayoutTier
  /** Self-contained screen-reader / no-color label. */
  ariaLabel: string
}

/** Cap on the headline length so a noisy title cannot blow the paint budget. */
export const MAX_PARITY_TITLE_LEN = 120
/** Cap on supporting detail (error text, long-content summary). */
export const MAX_PARITY_DETAIL_LEN = 500
/** Detail length that flips `populated` into the `long-content` state. */
export const LONG_PARITY_CONTENT_THRESHOLD = 240
/** Burst window: at most one committed state per this interval. */
export const PARITY_COMMIT_INTERVAL_MS = 120

/**
 * Map a parity state to its presentational view. Redaction, budget caps and
 * width tiers are applied here so the renderer stays a thin, dumb pass-through.
 * Color is never the only signal: the title always carries a word, and the
 * glyph + action keys reinforce meaning when color is unavailable.
 */
export function parityStateView(
  state: ParityState,
  opts: { width?: number; useColor?: boolean } = {},
): ParityStateView {
  const width = opts.width ?? PARITY_BREAKPOINTS.wide
  const tier = resolveLayoutTier(width)
  const safe = withinParityBudget(state)
  const base: Omit<
    ParityStateView,
    "glyph" | "title" | "detail" | "hint" | "colorRole" | "actions" | "ariaLabel"
  > = { status: safe.status, tier }

  const dropHint = tier === "narrow" || tier === "compact"

  switch (safe.status) {
    case "hidden":
      return { ...base, glyph: "", title: "", detail: "", hint: "", colorRole: "text", actions: [], ariaLabel: "" }

    case "loading":
      return {
        ...base,
        glyph: "↻",
        title: "Loading…",
        detail: safe.detail ? redactParityText(safe.detail).text : "",
        hint: dropHint ? "" : "preparing your workspace",
        colorRole: "info",
        actions: [],
        ariaLabel: "Loading.",
      }

    case "empty":
      return {
        ...base,
        glyph: "✓",
        title: "Nothing here yet",
        detail: safe.detail ? redactParityText(safe.detail).text : "",
        hint: dropHint ? "" : "start a session to populate this view",
        colorRole: "success",
        actions: [],
        ariaLabel: "Nothing here yet.",
      }

    case "populated": {
      const actions = safe.actions ?? []
      const hint = dropHint ? "" : actions.map((a) => `[${a.key}] ${a.label}`).join(" · ")
      return {
        ...base,
        glyph: "●",
        title: safe.title,
        detail: safe.detail ? redactParityText(safe.detail).text : "",
        hint,
        colorRole: "accent",
        actions,
        ariaLabel: ariaFor(safe.title, safe.detail),
      }
    }

    case "long-content": {
      const detail = redactParityText(safe.detail).text
      const actions = safe.actions ?? []
      const hint = dropHint ? "" : actions.map((a) => `[${a.key}] ${a.label}`).join(" · ")
      return {
        ...base,
        glyph: "▤",
        title: safe.title,
        detail,
        hint,
        colorRole: "accent",
        actions,
        ariaLabel: `${ariaFor(safe.title, safe.detail)} (long content).`,
      }
    }

    case "failure": {
      const redacted = redactParityText(safe.error)
      const actions: ParityAction[] = safe.retry
        ? [{ key: "r", label: "retry", command: "retry" }]
        : []
      actions.push({ key: "d", label: "dismiss", command: "dismiss" })
      return {
        ...base,
        glyph: "✕",
        title: "Something went wrong",
        detail: redacted.text,
        hint: dropHint ? "" : "press [r] to retry · [d] to dismiss",
        colorRole: "error",
        actions,
        ariaLabel: `Something went wrong${redacted.text ? `: ${redacted.text}` : ""}.`,
      }
    }

    case "denied":
      return {
        ...base,
        glyph: "⊘",
        title: `Access denied: ${safe.resource}`,
        detail: "Permission was denied. Grant access or choose a different option to continue.",
        hint: dropHint ? "" : "press [d] to dismiss",
        colorRole: "warning",
        actions: [{ key: "d", label: "dismiss", command: "dismiss" }],
        ariaLabel: `Access denied for ${safe.resource}. Permission was denied.`,
      }

    case "offline":
      return {
        ...base,
        glyph: "⚠",
        title: "You're offline",
        detail: safe.detail ? redactParityText(safe.detail).text : "Reconnect to sync this view.",
        hint: dropHint ? "" : "press [d] to dismiss",
        colorRole: "warning",
        actions: [{ key: "d", label: "dismiss", command: "dismiss" }],
        ariaLabel: "You are offline.",
      }

    case "degraded":
      return {
        ...base,
        glyph: "⚠",
        title: "Limited functionality",
        detail: redactParityText(safe.detail).text,
        hint: dropHint ? "" : "press [d] to dismiss",
        colorRole: "warning",
        actions: [{ key: "d", label: "dismiss", command: "dismiss" }],
        ariaLabel: `Limited functionality${safe.detail ? `: ${redactParityText(safe.detail).text}` : ""}.`,
      }
  }
}

function ariaFor(title: string, detail?: string): string {
  if (!detail) return title
  return `${title}: ${detail}`
}

/** Apply the render budget to any parity state. Pure. */
export function withinParityBudget(state: ParityState): ParityState {
  switch (state.status) {
    case "populated":
      return {
        ...state,
        title: truncateParity(state.title, MAX_PARITY_TITLE_LEN),
        detail: state.detail ? truncateParity(state.detail, MAX_PARITY_DETAIL_LEN) : state.detail,
      }
    case "long-content":
      return {
        ...state,
        title: truncateParity(state.title, MAX_PARITY_TITLE_LEN),
        detail: truncateParity(state.detail, MAX_PARITY_DETAIL_LEN),
      }
    case "failure":
      return { ...state, error: truncateParity(state.error, MAX_PARITY_DETAIL_LEN) }
    case "denied":
      return { ...state, resource: truncateParity(state.resource, MAX_PARITY_TITLE_LEN) }
    case "offline":
      return {
        ...state,
        detail: state.detail ? truncateParity(state.detail, MAX_PARITY_DETAIL_LEN) : state.detail,
      }
    case "degraded":
      return { ...state, detail: truncateParity(state.detail, MAX_PARITY_DETAIL_LEN) }
    default:
      return state
  }
}

// Conservative, framework-free redaction matcher reused by every host so a
// secret can never reach the parity chrome or diagnostics. Token-shaped runs,
// `sk-` keys and `key = value` assignments with a secret-looking key are
// masked with a single non-revealing marker.
export function redactParityText(input: string): { text: string; redacted: boolean } {
  if (!input) return { text: input, redacted: false }
  let redacted = false
  let text = input
  text = text.replace(/[A-Za-z0-9+/_=-]{32,}/g, () => {
    redacted = true
    return "••••"
  })
  text = text.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, () => {
    redacted = true
    return "••••"
  })
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, (match) => {
    redacted = true
    return `${match.split(/\s+/)[0]} ••••`
  })
  text = text.replace(
    /\b(api[_-]?key|apikey|token|secret|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth)\b(\s*[:=]\s*["']?)[^\s"',}{]+/gi,
    (_match, key: string, sep: string) => {
      redacted = true
      return `${key}${sep}••••`
    },
  )
  return { text, redacted }
}

function truncateParity(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 1) return value.slice(0, Math.max(0, max))
  return value.slice(0, max - 1) + "…"
}

/** Screen-reader / no-color friendly label for any state. */
export function parityAriaLabel(state: ParityState): string {
  return parityStateView(state).ariaLabel
}

/** Latest visible state's label, for a live-region announcement. */
export function latestParityAriaLabel(states: ParityState[]): string {
  if (states.length === 0) return ""
  return parityAriaLabel(states[states.length - 1]!)
}

export type ParityStateCommit = (state: ParityState) => void

/**
 * Leading+trailing throttle over parity-state commits. The first push in a quiet
 * period commits immediately (snappy), while any pushes arriving within
 * `interval` are buffered and flushed together as one trailing batch. Latest
 * value wins. Keeps a burst of state events from thrashing the renderer and
 * preserves focus (no mid-stream DOM/terminal churn). Call `flush()` to force
 * the pending buffer out synchronously (e.g. on unmount).
 */
export function createParityStateQueue(commit: ParityStateCommit, interval = PARITY_COMMIT_INTERVAL_MS) {
  let pending: ParityState | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush() {
    if (pending === undefined) return
    const next = pending
    pending = undefined
    commit(next)
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, interval) as ReturnType<typeof setTimeout>
    if (typeof timer.unref === "function") timer.unref()
  }

  return {
    push(state: ParityState) {
      const first = pending === undefined
      pending = state
      if (first) commit(state)
      schedule()
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
  }
}
