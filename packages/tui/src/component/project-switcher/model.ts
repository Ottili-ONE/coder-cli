/**
 * Pure domain model for the Ottili Coder Project switcher.
 *
 * The TUI previously exposed a flat "workspace list" dialog. The redesigned
 * Project switcher groups every workspace by its repository (`projectID`) and
 * presents each workspace as a worktree of that repository, surfacing local vs
 * cloud location and live connection status, with fast switching as the primary
 * action.
 *
 * This module is intentionally free of any rendering, SDK, or Solid-JS runtime
 * dependencies so the grouping/state logic can be unit tested in isolation and
 * reused by the Solid component in `./index.tsx`. All transitions are pure:
 * they take plain data and return new plain data, which keeps the data flow
 * deterministic and snapshot-free in tests.
 *
 * The lifecycle vocabulary (loading, offline, denied, failure, empty, degraded,
 * long-content, populated) is shared with the File tree, Build & validation and
 * Context meter redesigns so every redesigned panel renders the same eight
 * states with the same accessibility and performance guarantees.
 */

import stripAnsi from "strip-ansi"
import {
  colorSupport,
  isNarrow,
  redactSensitive,
  truncate as truncateText,
} from "../agent-roster/model"
import type { Workspace } from "@opencode-ai/sdk/v2"

/** Live connection health of a single workspace, as reported by the status map. */
export type WorkspaceConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | "unknown"

/** Where a worktree physically lives: on this machine or in the cloud. */
export type LocationKind = "local" | "cloud"

/** A single switchable workspace, rendered as a worktree row. */
export interface ProjectWorktree {
  id: string
  name: string
  branch: string | null
  directory: string | null
  /** Raw `Workspace.type` value (e.g. "local" / "remote"). */
  type: string
  location: LocationKind
  status: WorkspaceConnectionStatus
  isCurrent: boolean
  /** Normalized numeric recency weight (0 when unknown). */
  timeUsed: number
}

/** A repository grouping one or more worktrees that share a `projectID`. */
export interface ProjectRepository {
  projectID: string
  name: string
  worktrees: ProjectWorktree[]
  anyConnected: boolean
  connectedCount: number
  currentWorktreeID: string | undefined
  /** Cloud when any worktree is cloud-hosted, otherwise local. */
  location: LocationKind
}

/**
 * The eight intentionally-rendered lifecycle states of the Project switcher.
 * Order matters in {@link deriveProjectSwitcherStatus}: transient/blocking
 * states win over presentational ones so the user always sees the most
 * actionable message first.
 */
export type ProjectSwitcherStatus =
  | "loading"
  | "offline"
  | "denied"
  | "failure"
  | "empty"
  | "degraded"
  | "long-content"
  | "populated"

export interface ProjectSwitcherModel {
  status: ProjectSwitcherStatus
  repositories: ProjectRepository[]
  totalWorktrees: number
  connectedCount: number
  currentWorktreeID: string | undefined
}

export interface BuildProjectSwitcherInput {
  workspaces: Workspace[]
  statuses?: Record<string, string | undefined>
  currentID?: string | null
  /** True while the initial list/status sync is still in flight. */
  loading?: boolean
}

const CLOUD_TYPES = new Set(["remote", "cloud", "sandbox"])

/** Map a raw `Workspace.type` to a coarse local/cloud bucket. */
export function classifyLocation(type: string): LocationKind {
  return CLOUD_TYPES.has(type.toLowerCase()) ? "cloud" : "local"
}

const KNOWN_STATUSES = new Set<WorkspaceConnectionStatus>([
  "connected",
  "connecting",
  "disconnected",
  "error",
])

/** Normalize an arbitrary status string into the closed status union. */
export function normalizeStatus(status: string | undefined): WorkspaceConnectionStatus {
  if (!status) return "unknown"
  return KNOWN_STATUSES.has(status as WorkspaceConnectionStatus)
    ? (status as WorkspaceConnectionStatus)
    : "unknown"
}

/** Normalize the SDK `timeUsed` (which may be the strings "NaN"/"Infinity"). */
export function normalizeTimeUsed(value: Workspace["timeUsed"]): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Derive a stable repository display name from a group of worktrees. Worktrees
 * of one repository share a directory root; we use the basename of the shortest
 * available directory, falling back to the first worktree name.
 */
export function repositoryName(workspaces: Workspace[]): string {
  const withDir = workspaces.filter((w) => w.directory)
  const source = withDir.length ? withDir : workspaces
  const ref = source[0]
  if (ref?.directory) {
    const base = ref.directory.split("/").filter(Boolean).at(-1)
    if (base) return base
  }
  return ref?.name ?? "Unknown project"
}

function toWorktree(
  workspace: Workspace,
  statuses: Record<string, string | undefined> | undefined,
  currentID: string | undefined,
): ProjectWorktree {
  return {
    id: workspace.id,
    name: workspace.name,
    branch: workspace.branch ?? null,
    directory: workspace.directory ?? null,
    type: workspace.type,
    location: classifyLocation(workspace.type),
    status: normalizeStatus(statuses?.[workspace.id]),
    isCurrent: workspace.id === currentID,
    timeUsed: normalizeTimeUsed(workspace.timeUsed),
  }
}

function sortWorktrees(a: ProjectWorktree, b: ProjectWorktree): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
  if (b.timeUsed !== a.timeUsed) return b.timeUsed - a.timeUsed
  return a.name.localeCompare(b.name)
}

/** Group workspaces into repositories by `projectID`, sorting deterministically. */
export function groupByRepository(
  workspaces: Workspace[],
  statuses: Record<string, string | undefined> | undefined,
  currentID: string | undefined,
): ProjectRepository[] {
  const byProject = new Map<string, Workspace[]>()
  for (const workspace of workspaces) {
    const bucket = byProject.get(workspace.projectID)
    if (bucket) bucket.push(workspace)
    else byProject.set(workspace.projectID, [workspace])
  }

  const repositories: ProjectRepository[] = []
  for (const [projectID, items] of byProject) {
    const worktrees = items.map((w) => toWorktree(w, statuses, currentID)).sort(sortWorktrees)
    const connectedCount = worktrees.filter((w) => w.status === "connected").length
    const current = worktrees.find((w) => w.isCurrent)
    repositories.push({
      projectID,
      name: repositoryName(items),
      worktrees,
      anyConnected: connectedCount > 0,
      connectedCount,
      currentWorktreeID: current?.id,
      location: worktrees.some((w) => w.location === "cloud") ? "cloud" : "local",
    })
  }

  repositories.sort((a, b) => {
    if ((a.currentWorktreeID != null) !== (b.currentWorktreeID != null)) {
      return a.currentWorktreeID ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
  return repositories
}

/** Build the structural switcher model, resolving the loading/empty/populated status. */
export function buildProjectSwitcher(input: BuildProjectSwitcherInput): ProjectSwitcherModel {
  const loading = input.loading ?? false
  const workspaces = input.workspaces ?? []
  const currentID = input.currentID ?? undefined

  if (loading && workspaces.length === 0) {
    return {
      status: "loading",
      repositories: [],
      totalWorktrees: 0,
      connectedCount: 0,
      currentWorktreeID: currentID,
    }
  }

  if (workspaces.length === 0) {
    return {
      status: "empty",
      repositories: [],
      totalWorktrees: 0,
      connectedCount: 0,
      currentWorktreeID: currentID,
    }
  }

  const repositories = groupByRepository(workspaces, input.statuses, currentID)
  const totalWorktrees = repositories.reduce((n, r) => n + r.worktrees.length, 0)
  const connectedCount = repositories.reduce((n, r) => n + r.connectedCount, 0)
  const currentWorktreeID = repositories.find((r) => r.currentWorktreeID)?.currentWorktreeID

  return { status: "populated", repositories, totalWorktrees, connectedCount, currentWorktreeID }
}

/** Flat, ordered list of worktrees across all repositories (for keyboard nav). */
export function flattenWorktrees(model: ProjectSwitcherModel): ProjectWorktree[] {
  return model.repositories.flatMap((r) => r.worktrees)
}

// ---------------------------------------------------------------------------
// Lifecycle hardening model
//
// The Project switcher is opened in many environments that can be loading,
// offline, denied, failed, empty, partially loaded, large, or fully populated.
// These helpers classify and summarize that lifecycle so the presentational
// component can render every state intentionally and keep the view accessible
// and within a render budget. They are pure and item-shape agnostic: they only
// need a count and a context.
// ---------------------------------------------------------------------------

/** Default maximum number of worktree rows painted before a "show more" hint. */
export const RENDER_BUDGET_DEFAULT = 50

/** Terminal width below which the switcher collapses to a compact, truncated layout. */
export const NARROW_WIDTH_DEFAULT = 60

/** Maximum length of a redacted error shown in the UI or diagnostics. */
export const ERROR_MAX = 240

/** Marker substituted for redacted secrets in visual output and diagnostics. */
export const REDACTION_MARKER = "••••"

/** Environmental context that decides which top-level lifecycle state we are in. */
export interface ProjectSwitcherContext {
  /** An initial list/status sync is still in flight. */
  loading: boolean
  /** The workspace service (and any cloud sync) is reachable. */
  connected: boolean
  /** The user may list and switch between workspaces. */
  permitted: boolean
  /** The list loaded but some part (statuses, cloud sync) could not be collected. */
  partial: boolean
  /** Load-level error (crash, discovery error). Redacted on render. */
  error?: string
}

/** Derivable, memoizable Project switcher view state consumed by the component. */
export interface ProjectSwitcherState {
  model: ProjectSwitcherModel
  status: ProjectSwitcherStatus
  context: ProjectSwitcherContext
  totalWorktrees: number
  /** Rows painted when the render budget is applied (all once expanded). */
  visibleWorktrees: number
  /** Rows hidden by the render budget (0 once expanded). */
  hiddenWorktrees: number
  showAll: boolean
  renderBudget: number
  narrowWidth: number
}

/**
 * Classify a load error into the blocking lifecycle state it should surface.
 * Connectivity failures become `offline`; auth/permission failures become
 * `denied`; anything else is a generic `failure`.
 */
export function classifyError(message: string | undefined): "offline" | "denied" | "failure" | undefined {
  if (!message) return undefined
  const cleaned = message.toLowerCase()
  if (/(forbidden|403|permission|denied|unauthorized|401|access\b.*denied|not authorized)/.test(cleaned)) {
    return "denied"
  }
  if (
    /(network|econnrefused|enotfound|etimedout|timeout|timed out|offline|unreachable|getaddrinfo|dns|503|502|connection (reset|refused|failed)|socket)/.test(
      cleaned,
    )
  ) {
    return "offline"
  }
  return "failure"
}

/**
 * Classify the Project switcher's top-level state. Order matters: transient or
 * blocking states win over presentational ones so the user always sees the most
 * actionable message first.
 */
export function deriveProjectSwitcherStatus(
  context: ProjectSwitcherContext,
  totalWorktrees: number,
  renderBudget: number,
  showAll: boolean,
  anyError: boolean,
): ProjectSwitcherStatus {
  if (context.loading) return "loading"
  if (!context.connected) return "offline"
  if (!context.permitted) return "denied"
  if (context.error) return "failure"
  if (totalWorktrees === 0) return "empty"
  if (context.partial || anyError) return "degraded"
  if (!showAll && totalWorktrees > renderBudget) return "long-content"
  return "populated"
}

export interface BuildProjectSwitcherStateOverrides {
  showAll?: boolean
  renderBudget?: number
  narrowWidth?: number
}

export function buildProjectSwitcherState(
  input: BuildProjectSwitcherInput,
  context: ProjectSwitcherContext,
  overrides: BuildProjectSwitcherStateOverrides = {},
): ProjectSwitcherState {
  const renderBudget = overrides.renderBudget ?? RENDER_BUDGET_DEFAULT
  const showAll = overrides.showAll ?? false
  const narrowWidth = overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT

  const model = buildProjectSwitcher(input)
  const totalWorktrees = model.totalWorktrees
  const anyError = model.repositories.some((r) => r.worktrees.some((w) => w.status === "error" || w.status === "disconnected"))

  const status = deriveProjectSwitcherStatus(context, totalWorktrees, renderBudget, showAll, anyError)

  return {
    model,
    status,
    context,
    totalWorktrees,
    visibleWorktrees: showAll ? totalWorktrees : Math.min(totalWorktrees, renderBudget),
    hiddenWorktrees: showAll ? 0 : Math.max(0, totalWorktrees - renderBudget),
    showAll,
    renderBudget,
    narrowWidth,
  }
}

/** Count of rows painted when the render budget is applied (0 once expanded). */
export function visibleWorktreeCount(state: ProjectSwitcherState): number {
  return state.visibleWorktrees
}

/** Count of rows hidden by the render budget (0 once expanded). */
export function hiddenWorktreeCount(state: ProjectSwitcherState): number {
  return state.hiddenWorktrees
}

/** Single-line summary used as the accessible live-region label and header. */
export function projectSwitcherSummary(state: ProjectSwitcherState): string {
  const count = state.totalWorktrees
  const error = state.context.error
  switch (state.status) {
    case "loading":
      return "Projects: loading…"
    case "offline":
      return "Projects: offline — unavailable"
    case "denied":
      return "Projects: access denied"
    case "failure":
      return `Projects: failed to load — ${redactProjectSwitcherError(error ?? "unknown error")}`
    case "empty":
      return "Projects: no repositories"
    case "degraded":
      return `Projects: ${count} repositor${count === 1 ? "y" : "ies"} (degraded)`
    case "long-content":
      return `Projects: ${count} repositor${count === 1 ? "y" : "ies"} (showing ${state.renderBudget})`
    case "populated":
    default:
      return `Projects: ${count} repositor${count === 1 ? "y" : "ies"}`
  }
}

/** Short textual status label, always rendered so state is never color-only. */
export function lifecycleLabel(status: ProjectSwitcherStatus): string {
  switch (status) {
    case "loading":
      return "loading"
    case "offline":
      return "offline"
    case "denied":
      return "denied"
    case "failure":
      return "failed"
    case "empty":
      return "empty"
    case "degraded":
      return "degraded"
    case "long-content":
      return "truncated"
    case "populated":
      return "ready"
  }
}

/** Compact marker for a state; colored glyph when color is available, else a bracket tag. */
export function lifecycleGlyph(status: ProjectSwitcherStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "loading":
        return "…"
      case "offline":
        return "○"
      case "denied":
        return "⊘"
      case "failure":
        return "✗"
      case "empty":
        return "∅"
      case "degraded":
        return "△"
      case "long-content":
        return "▤"
      case "populated":
        return "✓"
    }
  }
  switch (status) {
    case "loading":
      return "[loading]"
    case "offline":
      return "[offline]"
    case "denied":
      return "[denied]"
    case "failure":
      return "[failed]"
    case "empty":
      return "[empty]"
    case "degraded":
      return "[degraded]"
    case "long-content":
      return "[truncated]"
    case "populated":
      return "[ok]"
  }
}

/** Compact marker for a worktree's connection status, color-aware for no-color fallback. */
export function connectionGlyph(status: WorkspaceConnectionStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "connected":
        return "●"
      case "connecting":
        return "◐"
      case "disconnected":
        return "○"
      case "error":
        return "✗"
      case "unknown":
        return "○"
    }
  }
  switch (status) {
    case "connected":
      return "[ok]"
    case "connecting":
      return "[sync]"
    case "disconnected":
      return "[off]"
    case "error":
      return "[err]"
    case "unknown":
      return "[?]"
  }
}

/** Truncate a worktree title to fit a narrow terminal without dropping its meaning. */
export function truncateWorktreeTitle(title: string, max: number): string {
  return truncateText(title, max)
}

/** A terminal is "narrow" when long paths must be truncated to preserve layout. */
export function isProjectSwitcherNarrow(width: number, threshold = NARROW_WIDTH_DEFAULT): boolean {
  return isNarrow(width, threshold)
}

/** Resolve whether color may be used, reading the environment when no level is given. */
export function projectSwitcherColorSupport(level?: number): { useColor: boolean; level: number } {
  if (level === undefined) return { useColor: !detectNoColor(), level: detectNoColor() ? 0 : 3 }
  return colorSupport(level)
}

/** True when the environment requests no color (NO_COLOR or a dumb terminal). */
export function detectNoColor(): boolean {
  if (process.env.NO_COLOR) return true
  const term = process.env.TERM ?? ""
  return term === "dumb" || term === "unknown"
}

/**
 * Redact secrets from an error message so it can be shown or logged safely.
 * Strips ANSI escape codes, masks token-shaped runs, and bounds the length.
 */
export function redactProjectSwitcherError(message: string): string {
  const cleaned = stripAnsi(message ?? "").replace(/\t/g, "  ").trim()
  const redacted = redactSensitive(cleaned).text
  if (redacted.length <= ERROR_MAX) return redacted
  return redacted.slice(0, ERROR_MAX - 1) + "…"
}
