/**
 * Unified background-jobs domain model for the Ottili Coder TUI.
 *
 * The TUI observes two distinct job populations that upstream treated as separate
 * surfaces (the process-local `BackgroundJob.Service` and the remote Ottili
 * Cloud jobs polled through `util/cloud-api`). This module normalizes both into
 * a single `BackgroundJobView` so a single view can present queued/running
 * jobs, ownership, resource use, pause/cancel and results side by side.
 *
 * The model is intentionally free of any rendering, theme, or SDK dependency so
 * the normalization and selection logic can be unit tested in isolation and reused
 * by the Solid component in `./index.tsx`. All transitions are pure: they take
 * a state and return a new state, keeping the data flow deterministic.
 */

import type { CloudJob } from "../util/cloud-api"
import type { Info as LocalJobInfo } from "@opencode-ai/core/background-job"

export type JobSource = "local" | "cloud"

export type JobStatus =
  | "queued"
  | "planning"
  | "running"
  | "paused"
  | "validating"
  | "completed"
  | "failed"
  | "error"
  | "cancelled"
  | "draft"

/** Semantic tone used to map a status onto the Ottili palette in the view. */
export type Tone = "success" | "error" | "warning" | "info" | "muted" | "neutral"

export interface JobResource {
  /** Who owns the work: "this session" locally, `created_by` for cloud. */
  owner: string
  /** Where it runs: "process-local" locally, `execution_backend` for cloud. */
  backend: string
  taskTotal?: number
  taskDone?: number
  taskFailed?: number
}

export interface BackgroundJobView {
  source: JobSource
  /** Stable view id, namespaced by source to avoid Local/Cloud id clashes. */
  id: string
  /** Raw id as known by the source (local string or cloud numeric string). */
  rawId: string
  title: string
  /** Local job `type` or cloud job `mode`. */
  type: string
  status: JobStatus
  startedAt: number
  completedAt?: number
  /** 0..100. Local jobs are 0 until terminal; cloud uses `completion_pct`. */
  progress: number
  resource: JobResource
  canCancel: boolean
  canPause: boolean
  paused: boolean
  result?: string
  error?: string
}

export const STATUS_ICON: Record<JobStatus, string> = {
  queued: "•",
  planning: "✎",
  running: "▶",
  paused: "⏸",
  validating: "◌",
  completed: "✓",
  failed: "✗",
  error: "✗",
  cancelled: "−",
  draft: "·",
}

export function statusTone(status: JobStatus): Tone {
  switch (status) {
    case "completed":
      return "success"
    case "failed":
    case "error":
      return "error"
    case "running":
    case "planning":
    case "validating":
      return "info"
    case "queued":
    case "paused":
      return "warning"
    case "cancelled":
    case "draft":
      return "muted"
    default:
      return "neutral"
  }
}

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "error" || status === "cancelled"
}

export function isActive(status: JobStatus): boolean {
  return !isTerminal(status)
}

function normalizeLocalStatus(status: LocalJobInfo["status"]): JobStatus {
  return status
}

export function fromLocal(info: LocalJobInfo, now: number = Date.now()): BackgroundJobView {
  const status = normalizeLocalStatus(info.status)
  const terminal = isTerminal(status)
  return {
    source: "local",
    id: `local:${info.id}`,
    rawId: info.id,
    title: info.title ?? info.type,
    type: info.type,
    status,
    startedAt: info.started_at,
    completedAt: info.completed_at,
    progress: terminal ? 100 : 0,
    resource: {
      owner: "this session",
      backend: "process-local",
    },
    canCancel: status === "running" || status === "queued",
    canPause: false,
    paused: false,
    result: info.output,
    error: info.error,
  }
}

export function fromCloud(job: CloudJob, now: number = Date.now()): BackgroundJobView {
  const status = job.status
  const startedAt = job.started_at ? Date.parse(job.started_at) : now
  const completedAt = job.completed_at ? Date.parse(job.completed_at) : undefined
  const counts = job.task_counts ?? {}
  return {
    source: "cloud",
    id: `cloud:${job.id}`,
    rawId: String(job.id),
    title: job.title,
    type: job.mode,
    status,
    startedAt,
    completedAt,
    progress: Math.max(0, Math.min(100, Math.round(job.completion_pct ?? 0))),
    resource: {
      owner: job.created_by,
      backend: job.execution_backend,
      taskTotal: job.task_total ?? job.target_task_count,
      taskDone: counts.completed,
      taskFailed: counts.failed,
    },
    canCancel: !isTerminal(status),
    canPause: status === "running",
    paused: status === "paused",
    result: job.result_summary ?? undefined,
    error: job.error_summary ?? undefined,
  }
}

export function durationMs(job: BackgroundJobView, now: number = Date.now()): number {
  return (job.completedAt ?? now) - job.startedAt
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`
  return `${s}s`
}

export function resourceSummary(job: BackgroundJobView): string {
  const resource = job.resource
  if (job.source === "cloud" && resource.taskTotal != null) {
    const done = resource.taskDone ?? 0
    const failed = resource.taskFailed ?? 0
    return `${done}/${resource.taskTotal} tasks${failed ? ` · ${failed} failed` : ""}`
  }
  return resource.backend
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + "…"
}

export type JobFilter = "all" | "active" | "completed" | "failed"
export type JobGroupBy = "source" | "status" | "none"

export interface BackgroundJobsState {
  jobs: Record<string, BackgroundJobView>
  order: string[]
  selectedId: string | null
  filter: JobFilter
  groupBy: JobGroupBy
}

export interface JobsSummary {
  total: number
  active: number
  completed: number
  failed: number
}

export function buildState(
  jobs: BackgroundJobView[],
  overrides: Partial<BackgroundJobsState> = {},
): BackgroundJobsState {
  const record: Record<string, BackgroundJobView> = {}
  const order: string[] = []
  for (const job of jobs) {
    record[job.id] = job
    order.push(job.id)
  }
  return {
    jobs: record,
    order,
    selectedId: null,
    filter: "all",
    groupBy: "source",
    ...overrides,
  }
}

export function visibleJobIds(state: BackgroundJobsState): string[] {
  const ids = state.order.filter((id) => state.jobs[id])
  const filtered = ids.filter((id) => {
    const job = state.jobs[id]!
    switch (state.filter) {
      case "active":
        return isActive(job.status)
      case "completed":
        return job.status === "completed"
      case "failed":
        return job.status === "failed" || job.status === "error"
      case "all":
      default:
        return true
    }
  })
  return filtered.sort((a, b) => state.jobs[b]!.startedAt - state.jobs[a]!.startedAt)
}

export interface JobGroup {
  key: string
  items: string[]
}

export function groupJobs(ids: string[], state: BackgroundJobsState): JobGroup[] {
  if (state.groupBy === "none") return [{ key: "Jobs", items: [...ids] }]
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const job = state.jobs[id]!
    const key =
      state.groupBy === "status" ? job.status : job.source === "local" ? "Local" : "Cloud"
    const bucket = groups.get(key)
    if (bucket) bucket.push(id)
    else groups.set(key, [id])
  }
  return [...groups.entries()].map(([key, items]) => ({ key, items }))
}

export function effectiveSelection(state: BackgroundJobsState): string | null {
  const ids = visibleJobIds(state)
  if (ids.length === 0) return null
  if (state.selectedId && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

export function moveSelection(state: BackgroundJobsState, direction: 1 | -1): string | null {
  const ids = visibleJobIds(state)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

export const FILTER_CYCLE: JobFilter[] = ["all", "active", "completed", "failed"]

export function nextFilter(mode: JobFilter): JobFilter {
  return FILTER_CYCLE[(FILTER_CYCLE.indexOf(mode) + 1) % FILTER_CYCLE.length]
}

export const GROUP_CYCLE: JobGroupBy[] = ["source", "status", "none"]

export function nextGroupBy(mode: JobGroupBy): JobGroupBy {
  return GROUP_CYCLE[(GROUP_CYCLE.indexOf(mode) + 1) % GROUP_CYCLE.length]
}

export function summary(jobs: Record<string, BackgroundJobView>): JobsSummary {
  const all = Object.values(jobs)
  return {
    total: all.length,
    active: all.filter((job) => isActive(job.status)).length,
    completed: all.filter((job) => job.status === "completed").length,
    failed: all.filter((job) => job.status === "failed" || job.status === "error").length,
  }
}
