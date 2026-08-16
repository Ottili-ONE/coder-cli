import { RGBA } from "@opentui/core"
import type { Theme } from "../../context/theme"
import { cliErrorMessage, errorFormat } from "../../util/error"
import { redactSensitive, truncate, isNarrow, NARROW_WIDTH_DEFAULT } from "../agent-roster/model"

export type ErrorCategory =
  | "provider"
  | "network"
  | "git"
  | "mcp"
  | "test"
  | "server"
  | "unknown"

export type DegradedSeverity = "error" | "warning" | "info"

export type DegradedState = {
  /** Stable dedupe key. Re-pushing the same id updates in place. */
  id: string
  category: ErrorCategory
  severity: DegradedSeverity
  title: string
  message: string
  detail?: string
  actionLabel?: string
  /** A keymap command or dialog token the host can resolve. */
  actionCommand?: string
  dismissible: boolean
  createdAt: number
}

export const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  provider: "Provider",
  network: "Network",
  git: "Git",
  mcp: "MCP",
  test: "Tests",
  server: "Server",
  unknown: "Error",
}

export const SEVERITY_GLYPH: Record<DegradedSeverity, string> = {
  error: "✕",
  warning: "⚠",
  info: "ℹ",
}

/** Cap on how many degraded states are shown at once. */
export const MAX_DEGRADED_STATES = 6

export function severityColor(severity: DegradedSeverity, theme: Theme): RGBA {
  switch (severity) {
    case "error":
      return theme.error
    case "warning":
      return theme.warning
    case "info":
      return theme.info
  }
}

export function defaultSeverity(category: ErrorCategory): DegradedSeverity {
  return category === "mcp" ? "warning" : "error"
}

/**
 * Heuristically map a raw error message onto one of the actionable failure
 * domains (provider, network, git, mcp, test, server). Classification only
 * drives coloring and the suggested action; the original message is always shown.
 */
export function classifyError(message: string): ErrorCategory {
  const m = message.toLowerCase()
  if (
    /\b(network|connection refused|connection reset|econn|etimedout|socket (hang|timeout)|dns|fetch failed|unreachable|timed? ?out|5(02|03|04))\b/.test(
      m,
    )
  ) {
    return "network"
  }
  if (
    /\b(provider|model not found|rate ?limit|quota|api[_ ]?key|authentication|unauthorized|invalid token|401|403|429)\b/.test(m)
  ) {
    return "provider"
  }
  if (/\b(git|repository|merge|rebase|commit|detached head|fatal:|\.git)\b/.test(m)) {
    return "git"
  }
  if (/\b(mcp|tool .{0,12}(failed|error)|server .{0,12}(failed|unreachable))\b/.test(m)) {
    return "mcp"
  }
  if (/\b(test|jest|vitest|bun test|expect\(|assertion|spec runner)\b/.test(m)) {
    return "test"
  }
  if (/\b(server|internal server error|500|gateway|cloudflare|ottili cloud|upstream)\b/.test(m)) {
    return "server"
  }
  return "unknown"
}

/** Best-effort human-readable text for an arbitrary thrown/serialized error. */
export function errorText(input: unknown): string {
  const cli = cliErrorMessage(input)
  if (cli) return cli
  return errorFormat(input)
}

type ToDegradedOptions = {
  id?: string
  category?: ErrorCategory
  title?: string
  severity?: DegradedSeverity
  message?: string
  detail?: string
  actionLabel?: string
  actionCommand?: string
  dismissible?: boolean
}

/**
 * Normalize an arbitrary error into a DegradedState. The first non-empty line
 * becomes the headline; remaining lines become the optional detail. Secrets are
 * left to the renderer (redaction happens at paint time, so this helper stays
 * pure and free of display concerns).
 */
export function toDegradedState(input: unknown, opts: ToDegradedOptions = {}): DegradedState {
  const full = opts.message ?? errorText(input)
  const category = opts.category ?? classifyError(full)
  const severity = opts.severity ?? defaultSeverity(category)
  const lines = full
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const headline = lines[0] || "Unknown error"
  return {
    id: opts.id ?? `${category}:${headline}`.slice(0, 160),
    category,
    severity,
    title: opts.title ?? `${CATEGORY_LABEL[category]} issue`,
    message: headline,
    detail: opts.detail ?? (lines.length > 1 ? lines.slice(1).join("\n") : undefined),
    actionLabel: opts.actionLabel,
    actionCommand: opts.actionCommand,
    dismissible: opts.dismissible ?? true,
    createdAt: Date.now(),
  }
}

/** Add or replace a state by id; keep at most MAX_DEGRADED_STATES (newest last). */
export function enqueueDegraded(states: DegradedState[], next: DegradedState): DegradedState[] {
  const without = states.filter((state) => state.id !== next.id)
  return [...without, next].slice(-MAX_DEGRADED_STATES)
}

export function dismissDegraded(states: DegradedState[], id: string): DegradedState[] {
  return states.filter((state) => state.id !== id)
}

/** Single-state accessibility summary for screen readers. */
export function summarizeDegraded(states: DegradedState[]): string {
  if (states.length === 0) return ""
  if (states.length === 1) {
    const state = states[0]!
    return `${CATEGORY_LABEL[state.category]}: ${state.title}. ${state.message}`
  }
  const counts = states.reduce<Record<string, number>>((acc, state) => {
    acc[state.category] = (acc[state.category] ?? 0) + 1
    return acc
  }, {})
  const parts = Object.entries(counts).map(([cat, n]) => `${n} ${CATEGORY_LABEL[cat as ErrorCategory]}`)
  return `${states.length} issues — ${parts.join(", ")}.`
}

// ---------------------------------------------------------------------------
// Render budget
// ---------------------------------------------------------------------------

/** Per-field length caps so a single noisy state cannot blow the paint budget. */
export const MAX_TITLE_LEN = 200
export const MAX_MESSAGE_LEN = 1000
export const MAX_DETAIL_LEN = 500

/** Terminal width at or below which the degraded panel collapses to a stacked layout. */
export const DEGRADED_NARROW_WIDTH = NARROW_WIDTH_DEFAULT

/** Is the available width too small for the side-by-side header + dismiss row? */
export function isDegradedNarrow(width: number): boolean {
  return isNarrow(width, DEGRADED_NARROW_WIDTH)
}

/**
 * Truncate every user-visible field of a degraded state to the render budget.
 * Pure: never mutates the input.
 */
export function withinBudget(state: DegradedState): DegradedState {
  return {
    ...state,
    title: truncate(state.title, MAX_TITLE_LEN),
    message: truncate(state.message, MAX_MESSAGE_LEN),
    detail: state.detail ? truncate(state.detail, MAX_DETAIL_LEN) : state.detail,
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Redact secrets from every user-facing field (title, message, detail). The
 * renderer paints the result, so secrets never reach the terminal or any
 * clipboard/diagnostic surface. Pure.
 */
export function redactState(state: DegradedState): DegradedState {
  return {
    ...state,
    title: redactSensitive(state.title).text,
    message: redactSensitive(state.message).text,
    detail: state.detail ? redactSensitive(state.detail).text : state.detail,
  }
}

/** Redacted, budget-capped copy ready to paint. Pure. */
export function presentState(state: DegradedState): DegradedState {
  return withinBudget(redactState(state))
}

// ---------------------------------------------------------------------------
// Color fallback
// ---------------------------------------------------------------------------

/**
 * Whether the terminal can render color. Honors the standard NO_COLOR /
 * FORCE_COLOR conventions and falls back to TTY detection. An explicit `level`
 * (0 disables) overrides detection so callers and tests stay deterministic.
 */
export function colorEnabled(opts: { level?: number; noColor?: boolean } = {}): boolean {
  if (opts.noColor ?? process.env.NO_COLOR !== undefined) return false
  if (process.env.FORCE_COLOR === "0") return false
  if (opts.level !== undefined) return opts.level >= 1
  return process.env.FORCE_COLOR !== undefined || Boolean(process.stdout.isTTY)
}

/** Explicit text marker so meaning never depends on color alone. */
export function severityText(severity: DegradedSeverity): string {
  if (severity === "error") return "ERROR"
  if (severity === "warning") return "WARNING"
  return "INFO"
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

/**
 * Screen-reader / no-color friendly single-state label. Includes the severity
 * word, category and redacted content so the announcement is self-contained.
 */
export function stateAriaLabel(state: DegradedState): string {
  const safe = redactState(state)
  return `${severityText(state.severity)}: ${CATEGORY_LABEL[state.category]} — ${safe.title}. ${safe.message}`
}

/** Latest state's label, for a live-region announcement of the most recent change. */
export function latestAriaLabel(states: DegradedState[]): string {
  if (states.length === 0) return ""
  return stateAriaLabel(states[states.length - 1]!)
}

// ---------------------------------------------------------------------------
// Rapid-stream coalescing
// ---------------------------------------------------------------------------

/**
 * Minimum gap between committed batches of degraded states. A burst of pushes
 * (same-id retries or many transient failures) is coalesced into at most one
 * commit per window so the panel never thrashes the renderer.
 */
export const DEGRADED_COMMIT_INTERVAL_MS = 120

export type DegradedCommit = (batch: DegradedState[]) => void

/**
 * Leading+trailing throttle over degraded-state commits. The first push in a
 * quiet period commits immediately (snappy), while any pushes arriving within
 * `interval` are buffered and flushed together as one trailing batch. Latest
 * value per id wins. `flush()` forces the pending buffer out synchronously.
 */
export function createDegradedQueue(commit: DegradedCommit, interval = DEGRADED_COMMIT_INTERVAL_MS) {
  let pending = new Map<string, DegradedState>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush() {
    if (pending.size === 0) return
    const batch = [...pending.values()]
    pending.clear()
    commit(batch)
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
    push(state: DegradedState) {
      const buffered = pending.size > 0
      pending.set(state.id, state)
      if (buffered) return
      // Quiet period: commit this one now (leading), then open a trailing window.
      commit([state])
      pending.delete(state.id)
      schedule()
    },
    flush,
    pending: () => pending.size,
  }
}
