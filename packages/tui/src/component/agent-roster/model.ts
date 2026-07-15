/**
 * Agent roster domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering or SDK dependencies so the
 * roster logic can be unit tested in isolation and reused by the Solid component
 * in `./index.tsx`. All transitions are pure: they take inputs and return new
 * values, which keeps the data flow deterministic and snapshot-free in tests.
 *
 * The roster hardens the agent list for every lifecycle state (loading, empty,
 * populated, long-content, failure, denied, offline, degraded) and provides the
 * building blocks for accessibility, terminal fallbacks and render budgets.
 */

/** A single permission verdict for an agent capability. */
export type Perm = "ask" | "allow" | "deny"

/** Minimal agent shape the roster needs; decoupled from the SDK so it is testable. */
export interface RosterAgentInput {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  builtIn: boolean
  color?: string
  prompt?: string
  permission: {
    edit: Perm
    bash: Record<string, Perm>
    webfetch?: Perm
    doom_loop?: Perm
    external_directory?: Perm
  }
  model?: { providerID: string; modelID: string }
}

/** Per-row health of an agent after normalization. */
export type AgentRowStatus = "ready" | "denied" | "offline" | "degraded"

/** Normalized, redacted, presentable view of a single agent. */
export interface RosterAgentView {
  name: string
  description: string
  mode: RosterAgentInput["mode"]
  builtIn: boolean
  color?: string
  model?: { providerID: string; modelID: string }
  status: AgentRowStatus
  denied: boolean
  permissionSummary: string
  redacted: boolean
}

/** The eight intentionally-rendered roster states required by the redesign. */
export type RosterStatus =
  | "loading"
  | "offline"
  | "denied"
  | "failure"
  | "empty"
  | "degraded"
  | "long-content"
  | "populated"

/** Environmental context that decides which top-level state the roster is in. */
export interface RosterContext {
  connected: boolean
  permitted: boolean
  loading: boolean
  partial: boolean
  error?: string
  erroredNames?: Iterable<string>
}

/** Derivable, memoizable roster state consumed by the component. */
export interface RosterState {
  agents: RosterAgentView[]
  byName: Record<string, RosterAgentView>
  status: RosterStatus
  context: RosterContext
  selectedName: string | null
  search: string
  showAll: boolean
  renderBudget: number
  narrowWidth: number
}

export interface RosterOverrides {
  selectedName?: string | null
  search?: string
  showAll?: boolean
  renderBudget?: number
  narrowWidth?: number
}

/** Default maximum number of agent rows rendered before the budget hint appears. */
export const RENDER_BUDGET_DEFAULT = 50

/** Default description length before truncation. */
export const MAX_DESCRIPTION_LEN = 120

/** Terminal width below which the roster collapses to a compact layout. */
export const NARROW_WIDTH_DEFAULT = 60

/** Marker substituted for redacted secrets in visual output and diagnostics. */
export const REDACTION_MARKER = "••••"

/**
 * Redact secrets from a single string. Detection is conservative: it targets
 * token-shaped runs (long base64/hex, `sk-` keys, `Bearer` tokens) and
 * `key = value` style assignments. Returns the cleaned text and whether anything
 * was redacted so callers can flag sensitive surfaces.
 */
export function redactSensitive(input: string): { text: string; redacted: boolean } {
  if (!input) return { text: input, redacted: false }
  let redacted = false
  let text = input

  // Long token-shaped runs (base64/hex, >= 32 chars). Normal words rarely reach
  // this length without separators, so collateral redactions stay rare.
  text = text.replace(/[A-Za-z0-9+/_=-]{32,}/g, () => {
    redacted = true
    return REDACTION_MARKER
  })

  // OpenAI-style secret keys.
  text = text.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, () => {
    redacted = true
    return REDACTION_MARKER
  })

  // Bearer tokens: keep the scheme, redact the credential.
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, (match) => {
    redacted = true
    return `${match.split(/\s+/)[0]} ${REDACTION_MARKER}`
  })

  // key = value / key: value assignments with a secret-looking key.
  text = text.replace(
    /\b(api[_-]?key|apikey|token|secret|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth)\b(\s*[:=]\s*["']?)[^\s"',}{]+/gi,
    (_match, key: string, sep: string) => {
      redacted = true
      return `${key}${sep}${REDACTION_MARKER}`
    },
  )

  return { text, redacted }
}

const SENSITIVE_KEY = /secret|token|password|passwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth/i

/**
 * Recursively sanitize a value for diagnostics/logging. String leaves are run
 * through {@link redactSensitive}; object keys that look secret are replaced
 * wholesale with the redaction marker. Never mutates the input.
 */
export function sanitizeForDiagnostics<T>(value: T): T {
  function walk(node: unknown, depth: number): unknown {
    if (depth > 8) return node
    if (typeof node === "string") return redactSensitive(node).text
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1))
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(node)) {
        out[key] = SENSITIVE_KEY.test(key) ? REDACTION_MARKER : walk(val, depth + 1)
      }
      return out
    }
    return node
  }
  return walk(value, 0) as T
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 1) return value.slice(0, Math.max(0, max))
  return value.slice(0, max - 1) + "…"
}

/** Resolve whether color may be used for an optional color-level (0 disables it). */
export function colorSupport(level?: number): { useColor: boolean; level: number } {
  const resolved = level ?? 3
  return { useColor: resolved >= 1, level: resolved }
}

/** A terminal is "narrow" when it cannot comfortably show descriptive columns. */
export function isNarrow(width: number, threshold = NARROW_WIDTH_DEFAULT): boolean {
  return width < threshold
}

function permissionSummaryOf(permission: RosterAgentInput["permission"]): string {
  const bashEntries = Object.entries(permission.bash)
  const allowBash = bashEntries.filter(([, value]) => value === "allow").length
  const denyBash = bashEntries.filter(([, value]) => value === "deny").length
  const parts = [`edit:${permission.edit}`, `bash:${allowBash}a/${denyBash}d`]
  const extras = [permission.webfetch, permission.doom_loop, permission.external_directory].filter(Boolean)
  if (extras.length) parts.push(extras.join("/"))
  return parts.join(" · ")
}

/**
 * An agent is "denied" when it cannot act at all: editing is denied and every
 * explicit bash command is also denied. Partial denies are still actionable.
 */
export function isAgentDenied(permission: RosterAgentInput["permission"]): boolean {
  const bashEntries = Object.entries(permission.bash)
  const allBashDenied = bashEntries.length > 0 && bashEntries.every(([, value]) => value === "deny")
  return permission.edit === "deny" && allBashDenied
}

/**
 * Normalize a raw agent into a presentable view. Redacts the description,
 * derives the row status from connectivity and load errors, and summarises
 * permissions. Pure: never throws on missing fields.
 */
export function normalizeAgent(input: RosterAgentInput, ctx: { connected: boolean; errored: boolean }): RosterAgentView {
  const description = redactSensitive(input.description ?? "").text
  const denied = isAgentDenied(input.permission)
  let status: AgentRowStatus = "ready"
  if (!ctx.connected) status = "offline"
  else if (denied) status = "denied"
  else if (ctx.errored) status = "degraded"
  return {
    name: input.name,
    description,
    mode: input.mode,
    builtIn: input.builtIn,
    color: input.color,
    model: input.model,
    status,
    denied,
    permissionSummary: permissionSummaryOf(input.permission),
    redacted: redactSensitive(input.description ?? "").redacted,
  }
}

/**
 * Classify the roster's top-level state. Order matters: transient/blocking
 * states win over presentational ones so the user always sees the most
 * actionable message.
 */
export function deriveRosterStatus(
  context: RosterContext,
  agents: RosterAgentView[],
  renderBudget: number,
  showAll: boolean,
): RosterStatus {
  if (context.loading) return "loading"
  if (!context.connected) return "offline"
  if (!context.permitted) return "denied"
  if (context.error) return "failure"
  if (agents.length === 0) return "empty"
  const anyDegraded = agents.some((agent) => agent.status === "degraded" || agent.status === "offline")
  if (context.partial || anyDegraded) return "degraded"
  if (!showAll && agents.length > renderBudget) return "long-content"
  return "populated"
}

export function buildState(
  inputs: RosterAgentInput[],
  context: RosterContext,
  overrides: RosterOverrides = {},
): RosterState {
  const errored = new Set(context.erroredNames ? [...context.erroredNames] : [])
  const agents = inputs.map((input) => normalizeAgent(input, { connected: context.connected, errored: errored.has(input.name) }))
  const renderBudget = overrides.renderBudget ?? RENDER_BUDGET_DEFAULT
  const showAll = overrides.showAll ?? false
  const status = deriveRosterStatus(context, agents, renderBudget, showAll)
  return {
    agents,
    byName: Object.fromEntries(agents.map((agent) => [agent.name, agent])),
    status,
    context,
    selectedName: overrides.selectedName ?? null,
    search: overrides.search ?? "",
    showAll,
    renderBudget,
    narrowWidth: overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT,
  }
}

/** Filter agents by a case-insensitive substring search over name and description. */
export function filterAgents(agents: RosterAgentView[], search: string): RosterAgentView[] {
  const query = search.trim().toLowerCase()
  if (!query) return agents
  return agents.filter(
    (agent) => agent.name.toLowerCase().includes(query) || agent.description.toLowerCase().includes(query),
  )
}

/** Visible rows after search filter and render-budget cap. */
export function visibleAgents(state: RosterState): RosterAgentView[] {
  const filtered = filterAgents(state.agents, state.search)
  if (state.showAll) return filtered
  return filtered.slice(0, state.renderBudget)
}

/** Count of rows hidden by the render budget (0 when expanded). */
export function hiddenAgentCount(state: RosterState): number {
  const filtered = filterAgents(state.agents, state.search)
  return state.showAll ? 0 : Math.max(0, filtered.length - state.renderBudget)
}

/**
 * Selection that stays valid across data updates. If the stored selection is no
 * longer visible, it falls back to the first visible row. This is what keeps
 * focus from being lost or trapped when the agent list changes.
 */
export function effectiveSelection(state: RosterState): string | null {
  const ids = visibleAgents(state).map((agent) => agent.name)
  if (ids.length === 0) return null
  if (state.selectedName && ids.includes(state.selectedName)) return state.selectedName
  return ids[0]
}

/** Move the selection by `direction` (-1 up, 1 down), clamped to visible rows. */
export function moveSelection(state: RosterState, direction: 1 | -1): string | null {
  const ids = visibleAgents(state).map((agent) => agent.name)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

/** Single-line summary used as the accessible live-region label and header. */
export function rosterSummary(state: RosterState): string {
  const count = state.agents.length
  switch (state.status) {
    case "loading":
      return "Agent roster: loading…"
    case "offline":
      return "Agent roster: offline — unavailable"
    case "denied":
      return "Agent roster: permission denied"
    case "failure":
      return `Agent roster: failed to load — ${redactSensitive(state.context.error ?? "unknown error").text}`
    case "empty":
      return "Agent roster: no agents available"
    case "degraded":
      return `Agent roster: ${count} agents (degraded)`
    case "long-content":
      return `Agent roster: ${count} agents (showing ${state.renderBudget})`
    case "populated":
    default:
      return `Agent roster: ${count} ${count === 1 ? "agent" : "agents"}`
  }
}

/** Short textual status label, always rendered so state is never color-only. */
export function statusLabel(status: AgentRowStatus): string {
  switch (status) {
    case "ready":
      return "ready"
    case "denied":
      return "denied"
    case "offline":
      return "offline"
    case "degraded":
      return "degraded"
  }
}

/** Compact marker for a row; colored glyph when color is available, else a bracket tag. */
export function statusGlyph(status: AgentRowStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "ready":
        return "●"
      case "denied":
        return "⊘"
      case "offline":
        return "○"
      case "degraded":
        return "△"
    }
  }
  switch (status) {
    case "ready":
      return "[ok]"
    case "denied":
      return "[denied]"
    case "offline":
      return "[offline]"
    case "degraded":
      return "[warn]"
  }
}
