/**
 * Task queue domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering or SDK dependencies so the
 * queue logic can be unit tested in isolation and reused by the Solid component
 * in `./index.tsx`. All transitions are pure: they take a state and return a new
 * state, which keeps the data flow deterministic and snapshot-free in tests.
 */

export type TaskStatus =
  | "queued"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"

export type Priority = "high" | "normal" | "low"

export interface Task {
  id: string
  title: string
  group: string
  status: TaskStatus
  priority: Priority
  dependencies: string[]
  attempts: number
  maxAttempts: number
  progress: number
  stream: string
  error?: string
}

export type FilterMode = "all" | "active" | "failed" | "blocked"
export type GroupBy = "group" | "status" | "none"

export interface TaskQueueState {
  tasks: Record<string, Task>
  order: string[]
  selectedId: string | null
  filter: FilterMode
  groupBy: GroupBy
}

export type TaskQueueAction =
  | { type: "select"; id: string }
  | { type: "retry"; id: string; rejected: boolean; attempts: number }
  | { type: "cancel"; id: string }

export interface TaskInput extends Partial<Omit<Task, "id" | "title" | "group">> {
  id: string
  title: string
  group: string
}

export function makeTask(input: TaskInput): Task {
  return {
    id: input.id,
    title: input.title,
    group: input.group,
    status: input.status ?? "queued",
    priority: input.priority ?? "normal",
    dependencies: input.dependencies ?? [],
    attempts: input.attempts ?? 0,
    maxAttempts: input.maxAttempts ?? 3,
    progress: input.progress ?? 0,
    stream: input.stream ?? "",
    error: input.error,
  }
}

export const STATUS_ICON: Record<TaskStatus, string> = {
  queued: "•",
  running: "▶",
  retrying: "↻",
  completed: "✓",
  failed: "✗",
  blocked: "⊘",
  cancelled: "−",
}

export const PRIORITY_MARK: Record<Priority, string> = {
  high: "!",
  normal: "·",
  low: "·",
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "HIGH",
  normal: "NORM",
  low: "LOW",
}

export function priorityRank(priority: Priority): number {
  return priority === "high" ? 0 : priority === "normal" ? 1 : 2
}

export function isActive(status: TaskStatus): boolean {
  return status === "queued" || status === "running" || status === "retrying"
}

/** A task is effectively blocked when it is waiting and not all dependencies are done. */
export function dependenciesMet(task: Task, tasks: Record<string, Task>): boolean {
  return task.dependencies.every((dep) => tasks[dep]?.status === "completed")
}

export function isBlocked(task: Task, tasks: Record<string, Task>): boolean {
  return task.status === "blocked" || (isActive(task.status) && !dependenciesMet(task, tasks))
}

export function buildState(tasks: Task[], overrides: Partial<TaskQueueState> = {}): TaskQueueState {
  const record: Record<string, Task> = {}
  const order: string[] = []
  for (const task of tasks) {
    record[task.id] = task
    order.push(task.id)
  }
  return {
    tasks: record,
    order,
    selectedId: null,
    filter: "all",
    groupBy: "group",
    ...overrides,
  }
}

export function visibleTaskIds(state: TaskQueueState): string[] {
  const ids = state.order.filter((id) => state.tasks[id])
  const filtered = ids.filter((id) => {
    const task = state.tasks[id]
    switch (state.filter) {
      case "active":
        return isActive(task.status) || isBlocked(task, state.tasks)
      case "failed":
        return task.status === "failed"
      case "blocked":
        return isBlocked(task, state.tasks)
      case "all":
      default:
        return true
    }
  })
  return filtered.sort((a, b) => {
    const priorityDiff = priorityRank(state.tasks[a].priority) - priorityRank(state.tasks[b].priority)
    if (priorityDiff !== 0) return priorityDiff
    return state.order.indexOf(a) - state.order.indexOf(b)
  })
}

export interface TaskGroup {
  key: string
  items: string[]
}

export function groupTasks(ids: string[], state: TaskQueueState): TaskGroup[] {
  if (state.groupBy === "none") return [{ key: "Tasks", items: [...ids] }]
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const task = state.tasks[id]
    const key = state.groupBy === "status" ? task.status : task.group
    const bucket = groups.get(key)
    if (bucket) bucket.push(id)
    else groups.set(key, [id])
  }
  return [...groups.entries()].map(([key, items]) => ({ key, items }))
}

export function effectiveSelection(state: TaskQueueState): string | null {
  const ids = visibleTaskIds(state)
  if (ids.length === 0) return null
  if (state.selectedId && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

export function moveSelection(state: TaskQueueState, direction: 1 | -1): string | null {
  const ids = visibleTaskIds(state)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

export const FILTER_CYCLE: FilterMode[] = ["all", "active", "failed", "blocked"]

export function nextFilter(mode: FilterMode): FilterMode {
  return FILTER_CYCLE[(FILTER_CYCLE.indexOf(mode) + 1) % FILTER_CYCLE.length]
}

export const GROUP_CYCLE: GroupBy[] = ["group", "status", "none"]

export function nextGroupBy(mode: GroupBy): GroupBy {
  return GROUP_CYCLE[(GROUP_CYCLE.indexOf(mode) + 1) % GROUP_CYCLE.length]
}

function withTask(state: TaskQueueState, id: string, patch: Partial<Task>): TaskQueueState {
  const task = state.tasks[id]
  if (!task) return state
  return { ...state, tasks: { ...state.tasks, [id]: { ...task, ...patch } } }
}

/** Append a streamed chunk to a task and nudge its progress forward. */
export function applyStream(state: TaskQueueState, id: string, chunk: string): TaskQueueState {
  const task = state.tasks[id]
  if (!task) return state
  const stream = (task.stream + chunk).slice(-400)
  const progress = Math.min(100, task.progress + Math.max(1, Math.round((chunk.length / 120) * 100) % 25 || 4))
  return withTask(state, id, { stream, progress })
}

export function setStatus(state: TaskQueueState, id: string, status: TaskStatus): TaskQueueState {
  return withTask(state, id, { status })
}

export function completeTask(state: TaskQueueState, id: string): TaskQueueState {
  return withTask(state, id, { status: "completed", progress: 100 })
}

export function failTask(state: TaskQueueState, id: string, error: string): TaskQueueState {
  const task = state.tasks[id]
  if (!task) return state
  return withTask(state, id, { status: "failed", error, progress: task.progress })
}

export function cancelTask(state: TaskQueueState, id: string): TaskQueueState {
  return withTask(state, id, { status: "cancelled" })
}

/**
 * Attempt to retry a failed task. Returns the next state plus a `rejected` flag
 * when the task has already exhausted its attempts — the caller should surface
 * that as a failure path rather than silently rescheduling.
 */
export function retryTask(
  state: TaskQueueState,
  id: string,
): { state: TaskQueueState; rejected: boolean; attempts: number } {
  const task = state.tasks[id]
  if (!task) return { state, rejected: true, attempts: 0 }
  if (task.attempts >= task.maxAttempts) {
    return {
      state: withTask(state, id, { error: `Max retries (${task.maxAttempts}) reached` }),
      rejected: true,
      attempts: task.attempts,
    }
  }
  const attempts = task.attempts + 1
  return {
    state: withTask(state, id, { attempts, status: "retrying", error: undefined }),
    rejected: false,
    attempts,
  }
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + "…"
}
