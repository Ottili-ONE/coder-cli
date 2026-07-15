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
 */

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

export type ProjectSwitcherStatus = "loading" | "empty" | "ready"

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

/** Build the full switcher model, resolving the loading/empty/ready status. */
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

  return { status: "ready", repositories, totalWorktrees, connectedCount, currentWorktreeID }
}

/** Flat, ordered list of worktrees across all repositories (for keyboard nav). */
export function flattenWorktrees(model: ProjectSwitcherModel): ProjectWorktree[] {
  return model.repositories.flatMap((r) => r.worktrees)
}
