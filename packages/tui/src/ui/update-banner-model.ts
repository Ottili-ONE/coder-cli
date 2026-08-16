/**
 * Update & release banner domain model for the Ottili Coder TUI.
 *
 * Pure and rendering-free so the banner logic can be unit tested in isolation
 * and reused by the Solid view in `../component/update-banner.tsx`. Every
 * transition is a pure function: it takes inputs and returns new values, which
 * keeps the data flow deterministic and snapshot-free in tests.
 *
 * The banner hardens the update/release surface for every lifecycle state
 * (loading, empty, populated, long-content, failure, denied, offline,
 * degraded) and provides the building blocks for accessibility, terminal
 * fallbacks and render budgets. The stability vocabulary mirrors the CLI
 * channel taxonomy (`local | latest | beta | nightly`) from
 * `core/installation/version.ts`.
 */

import { redactSensitive, truncate, isNarrow } from "../component/agent-roster/model"

/** CLI channel taxonomy. Mirrors `InstallationChannel` in core. */
export type UpdateChannel = "local" | "latest" | "beta" | "nightly"

/** Semver step between the installed and target release. */
export type UpdateReleaseType = "major" | "minor" | "patch"

/**
 * The eight intentionally-rendered banner states required by the redesign,
 * plus `hidden` (nothing to show) and `installing` (progress replaces the
 * strip). Every state is rendered and actionable by the view; none is dropped
 * on the floor.
 */
export type UpdateBannerState =
  | { status: "hidden" }
  | { status: "loading"; channel: UpdateChannel }
  | { status: "empty"; channel: UpdateChannel; current: string }
  | {
      status: "available"
      channel: UpdateChannel
      target: string
      current: string
      releaseType: UpdateReleaseType
    }
  | {
      status: "long-content"
      channel: UpdateChannel
      target: string
      current: string
      releaseType: UpdateReleaseType
      detail: string
    }
  | { status: "failure"; channel: UpdateChannel; error: string }
  | { status: "denied"; channel: UpdateChannel }
  | { status: "offline"; channel: UpdateChannel }
  | { status: "degraded"; channel: UpdateChannel; detail: string }
  | { status: "installing"; channel: UpdateChannel; target: string }

/** Theme color role the view maps onto an Ottili palette token. */
export type BannerColorRole = "accent" | "success" | "warning" | "error" | "info" | "text"

/** A single keyboard/mouse affordance rendered on the strip. */
export type BannerAction = {
  key: string
  label: string
  /** Wire-safe command the host resolves (open preview, update, dismiss). */
  command: "changelog" | "update" | "dismiss"
}

/** Presentational view of a state: glyph, text, color, actions, a11y. */
export type BannerView = {
  status: UpdateBannerState["status"]
  glyph: string
  /** Short headline, already redacted and budget-capped. */
  title: string
  /** Longer supporting copy (redacted, capped). Empty when not applicable. */
  detail: string
  /** Keyboard hint line; dropped on narrow terminals. */
  hint: string
  colorRole: BannerColorRole
  /** Action affordances for this state. */
  actions: BannerAction[]
  /** Terminal-width tier that drove truncation. */
  tier: BannerTier
  /** Self-contained screen-reader / no-color label. */
  ariaLabel: string
}

/** Terminal-width tiers (spec §5.2). */
export type BannerTier = "wide" | "standard" | "narrow" | "minimal"

// ---------------------------------------------------------------------------
// Render budget
// ---------------------------------------------------------------------------

/** Cap on the headline length so a noisy version/target cannot blow the paint budget. */
export const MAX_BANNER_TITLE_LEN = 120
/** Cap on supporting detail (error text, long-content summary). */
export const MAX_BANNER_DETAIL_LEN = 500
/** Detail length that flips `available` into the `long-content` state. */
export const LONG_CONTENT_THRESHOLD = 240

/** Width breakpoints (spec §5.2). */
export const BANNER_WIDE_WIDTH = 110
export const BANNER_STANDARD_WIDTH = 80
export const BANNER_NARROW_WIDTH = 60

/** Burst window: at most one committed banner state per this interval. */
export const BANNER_COMMIT_INTERVAL_MS = 120

// ---------------------------------------------------------------------------
// Channel vocabulary
// ---------------------------------------------------------------------------

/** Human label for a channel — always a word, never color alone. */
export function channelLabel(channel: UpdateChannel): string {
  switch (channel) {
    case "local":
      return "Dev"
    case "latest":
      return "Stable"
    case "beta":
      return "Beta"
    case "nightly":
      return "Nightly"
  }
}

/** Preview channels (everything but stable) get the accent pill. */
export function channelIsPreview(channel: UpdateChannel): boolean {
  return channel !== "latest"
}

// ---------------------------------------------------------------------------
// Version comparison (semver-lite, no external dep)
// ---------------------------------------------------------------------------

/** Compare `a` and `b` as `major.minor.patch`. Returns -1/0/1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}

/** True when `left` is strictly newer than `right`. */
export function isVersionGreater(left: string, right: string): boolean {
  return compareVersions(left, right) > 0
}

/** Resolve the semver step between current and target. */
export function releaseTypeOf(current: string, target: string): UpdateReleaseType {
  const cMajor = Number.parseInt(current.split(".")[0] ?? "0", 10)
  const cMinor = Number.parseInt(current.split(".")[1] ?? "0", 10)
  const tMajor = Number.parseInt(target.split(".")[0] ?? "0", 10)
  const tMinor = Number.parseInt(target.split(".")[1] ?? "0", 10)
  if (tMajor > cMajor) return "major"
  if (tMinor > cMinor) return "minor"
  return "patch"
}

// ---------------------------------------------------------------------------
// Visibility + dismissal
// ---------------------------------------------------------------------------

/** Stable dismiss key so a skip is scoped to `{channel}@{target}` (closes G5). */
export function dismissKey(channel: UpdateChannel, target: string): string {
  return `${channel}@${target}`
}

/**
 * Whether the banner should surface an update. True only when the target is
 * newer than the installed version and the `{channel}@{target}` pair has not
 * been dismissed. Pure.
 */
export function shouldShowBanner(opts: {
  current: string
  target: string
  channel: UpdateChannel
  dismissed: string[]
}): boolean {
  if (opts.dismissed.includes(dismissKey(opts.channel, opts.target))) return false
  return isVersionGreater(opts.target, opts.current)
}

// ---------------------------------------------------------------------------
// Terminal width + color fallback
// ---------------------------------------------------------------------------

/** Map a terminal width to its render tier (spec §5.2). */
export function bannerTier(width: number): BannerTier {
  if (width >= BANNER_WIDE_WIDTH) return "wide"
  if (width >= BANNER_STANDARD_WIDTH) return "standard"
  if (width >= BANNER_NARROW_WIDTH) return "narrow"
  return "minimal"
}

/**
 * Whether the terminal can render color. Honors NO_COLOR / FORCE_COLOR and
 * falls back to TTY detection. An explicit `level` (0 disables) overrides
 * detection so callers and tests stay deterministic.
 */
export function colorEnabled(opts: { level?: number; noColor?: boolean } = {}): boolean {
  if (opts.noColor ?? process.env.NO_COLOR !== undefined) return false
  if (process.env.FORCE_COLOR === "0") return false
  if (opts.level !== undefined) return opts.level >= 1
  return process.env.FORCE_COLOR !== undefined || Boolean(process.stdout.isTTY)
}

/** Is the width too small for the descriptive columns? */
export function isBannerNarrow(width: number): boolean {
  return isNarrow(width, BANNER_NARROW_WIDTH)
}

// ---------------------------------------------------------------------------
// Redaction + budget
// ---------------------------------------------------------------------------

/** Redact secrets from a single user-facing string. */
export function redactBannerText(input: string): { text: string; redacted: boolean } {
  return redactSensitive(input)
}

/** Truncate a user-visible field to its render budget. Pure. */
export function withinBannerBudget(state: UpdateBannerState): UpdateBannerState {
  switch (state.status) {
    case "available":
    case "long-content":
    case "installing":
      return { ...state, target: truncate(state.target, MAX_BANNER_TITLE_LEN) }
    case "failure":
      return { ...state, error: truncate(state.error, MAX_BANNER_DETAIL_LEN) }
    case "degraded":
      return { ...state, detail: truncate(state.detail, MAX_BANNER_DETAIL_LEN) }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/**
 * Map a state to its presentational view. Redaction, budget caps and width
 * tiers are all applied here so the view stays a thin, dumb renderer. Color is
 * never the only signal: the title always carries a word, and the pill word
 * (Beta/Nightly/Stable) plus the action keys reinforce meaning when color is
 * unavailable.
 */
export function bannerViewModel(
  state: UpdateBannerState,
  opts: { width?: number; useColor?: boolean } = {},
): BannerView {
  const width = opts.width ?? BANNER_WIDE_WIDTH
  const useColor = opts.useColor ?? true
  const tier = bannerTier(width)
  const safe = withinBannerBudget(state)
  const label = "channel" in safe ? channelLabel(safe.channel) : ""

  const base: Omit<BannerView, "glyph" | "title" | "detail" | "hint" | "colorRole" | "actions" | "ariaLabel"> = {
    status: safe.status,
    tier,
  }

  switch (safe.status) {
    case "hidden":
      return { ...base, glyph: "", title: "", detail: "", hint: "", colorRole: "text", actions: [], ariaLabel: "" }

    case "loading":
      return {
        ...base,
        glyph: "↻",
        title: "Checking for updates…",
        detail: "",
        hint: tier === "wide" ? "we check for a new Ottili Coder release on startup" : "",
        colorRole: "info",
        actions: [],
        ariaLabel: "Checking for Ottili Coder updates.",
      }

    case "empty":
      return {
        ...base,
        glyph: "✓",
        title: `Ottili Coder is up to date (v${safe.current})`,
        detail: "",
        hint: tier === "wide" ? "no new release available" : "",
        colorRole: "success",
        actions: [],
        ariaLabel: "Ottili Coder is up to date.",
      }

    case "available": {
      const view = bannerAvailableView(safe, label, tier, useColor)
      return { ...base, ...view }
    }

    case "long-content": {
      const view = bannerAvailableView(safe, label, tier, useColor)
      const detail = truncate(safe.detail, MAX_BANNER_DETAIL_LEN)
      return {
        ...base,
        ...view,
        detail,
        ariaLabel: `${view.ariaLabel} Notes: ${detail}`,
      }
    }

    case "failure": {
      const redacted = redactSensitive(safe.error)
      return {
        ...base,
        glyph: "✕",
        title: "Update check failed",
        detail: redacted.text,
        hint: tier === "wide" ? "press [d] to dismiss" : "",
        colorRole: "error",
        actions: [{ key: "d", label: "dismiss", command: "dismiss" }],
        ariaLabel: `Update check failed${redacted.text ? `: ${redacted.text}` : ""}.`,
      }
    }

    case "denied":
      return {
        ...base,
        glyph: "⊘",
        title: "Updates are disabled",
        detail: "Auto-update is off or permission was denied. Enable it or install manually to update.",
        hint: tier === "wide" ? "press [d] to dismiss" : "",
        colorRole: "warning",
        actions: [{ key: "d", label: "dismiss", command: "dismiss" }],
        ariaLabel: "Updates are disabled. Auto-update is off or permission was denied.",
      }

    case "offline":
      return {
        ...base,
        glyph: "⚠",
        title: "Offline — could not check for updates",
        detail: "",
        hint: tier === "wide" ? "press [d] to dismiss" : "",
        colorRole: "warning",
        actions: [{ key: "d", label: "dismiss", command: "dismiss" }],
        ariaLabel: "Offline. Could not check for updates.",
      }

    case "degraded": {
      const redacted = redactSensitive(safe.detail)
      return {
        ...base,
        glyph: "⚠",
        title: "Update info incomplete",
        detail: redacted.text,
        hint: tier === "wide" ? "press [d] to dismiss" : "",
        colorRole: "warning",
        actions: [{ key: "d", label: "dismiss", command: "dismiss" }],
        ariaLabel: `Update information is incomplete${redacted.text ? `: ${redacted.text}` : ""}.`,
      }
    }

    case "installing":
      return {
        ...base,
        glyph: "↻",
        title: `Updating to v${safe.target}…`,
        detail: "",
        hint: tier === "wide" ? "progress continues in the background" : "",
        colorRole: "info",
        actions: [],
        ariaLabel: `Updating to version ${safe.target}.`,
      }
  }
}

/** Shared view for the `available` and `long-content` populated states. */
function bannerAvailableView(
  state: Extract<UpdateBannerState, { status: "available" | "long-content" }>,
  label: string,
  tier: BannerTier,
  useColor: boolean,
): Pick<BannerView, "glyph" | "title" | "detail" | "hint" | "colorRole" | "actions" | "ariaLabel"> {
  const pill = tier === "minimal" ? "" : label
  const titleParts: string[] = []
  if (pill) titleParts.push(`[${pill}]`)
  titleParts.push(`Update available · v${state.target}`)
  const title = titleParts.join(" ")

  // Truncation drops the hint first, then the changelog key, then the pill word,
  // preserving the version + update action last (spec §5.2).
  const actions: BannerAction[] = [
    { key: "c", label: "notes", command: "changelog" },
    { key: "u", label: "update", command: "update" },
    { key: "d", label: "dismiss", command: "dismiss" },
  ]
  if (tier === "narrow") actions.shift() // drop [c] changelog key
  if (tier === "minimal") {
    // keep only the update action; version-only strip
    actions.length = 0
    actions.push({ key: "u", label: "update", command: "update" })
  }

  const hint =
    tier === "wide"
      ? `press [c] notes · [u] update · [d] dismiss`
      : tier === "standard"
        ? `[c] [u] [d]`
        : ""

  const colorRole: BannerColorRole = channelIsPreview(state.channel) ? "accent" : "success"
  const ariaLabel = `Update available v${state.target}, channel ${label}. Press c for notes, u to update, d to dismiss.`

  return { glyph: "⤓", title, detail: "", hint, colorRole, actions, ariaLabel }
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

/** Screen-reader / no-color friendly label for any state. */
export function bannerAriaLabel(state: UpdateBannerState): string {
  return bannerViewModel(state).ariaLabel
}

/** Latest visible state's label, for a live-region announcement. */
export function latestAriaLabel(states: UpdateBannerState[]): string {
  if (states.length === 0) return ""
  return bannerAriaLabel(states[states.length - 1]!)
}

// ---------------------------------------------------------------------------
// Rapid-stream coalescing
// ---------------------------------------------------------------------------

export type BannerCommit = (state: UpdateBannerState) => void

/**
 * Leading+trailing throttle over banner-state commits. The first push in a
 * quiet period commits immediately (snappy), while any pushes arriving within
 * `interval` are buffered and flushed together as one trailing batch. Latest
 * value wins. `flush()` forces the pending buffer out synchronously. Keeps a
 * burst of update events from thrashing the renderer.
 */
export function createUpdateBannerQueue(commit: BannerCommit, interval = BANNER_COMMIT_INTERVAL_MS) {
  let pending: UpdateBannerState | undefined
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
    push(next: UpdateBannerState) {
      const buffered = pending !== undefined
      pending = next
      if (buffered) return
      commit(next)
      schedule()
    },
    flush,
    pending: () => (pending === undefined ? 0 : 1),
  }
}
