/**
 * Agent roster domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering or SDK dependencies so the
 * roster logic can be unit tested in isolation and reused by the Solid component
 * in `./index.tsx`. All transitions are pure: they take a state and return a new
 * state, which keeps the data flow deterministic and snapshot-free in tests.
 */

export type AgentStatus = "idle" | "working" | "handoff" | "done" | "failed"

export type HandoffState = "none" | "pending" | "ready" | "done"

export type RosterFilter = "all" | "active" | "handoff" | "failed"

export interface AgentEntry {
  id: string
  name: string
  role: string
  providerID: string
  modelID: string
  task: string
  status: AgentStatus
  progress: number
  handoff: HandoffState
  stream: string
  attempts: number
  maxAttempts: number
  error?: string
}

export interface AgentRosterState {
  entries: Record<string, AgentEntry>
  order: string[]
  selectedId: string | null
  filter: RosterFilter
}

export type RosterAction =
  | { type: "select"; id: string }
  | { type: "focus"; id: string }
  | { type: "handoff.accept"; id: string }
  | { type: "retry"; id: string; rejected: boolean; attempts: number }

export interface AgentInput extends Partial<Omit<AgentEntry, "id" | "name" | "role">> {
  id: string
  name: string
  role: string
}

export function makeAgent(input: AgentInput): AgentEntry {
  return {
    id: input.id,
    name: input.name,
    role: input.role,
    providerID: input.providerID ?? "unknown",
    modelID: input.modelID ?? "unknown",
    task: input.task ?? "",
    status: input.status ?? "idle",
    progress: input.progress ?? 0,
    handoff: input.handoff ?? "none",
    stream: input.stream ?? "",
    attempts: input.attempts ?? 0,
    maxAttempts: input.maxAttempts ?? 3,
    error: input.error,
  }
}

export const STATUS_ICON: Record<AgentStatus, string> = {
  idle: "·",
  working: "▶",
  handoff: "⇄",
  done: "✓",
  failed: "✗",
}

export const HANDOFF_LABEL: Record<HandoffState, string> = {
  none: "—",
  pending: "pending",
  ready: "ready",
  done: "handed off",
}

export function isActive(status: AgentStatus): boolean {
  return status === "working" || status === "handoff"
}

export function buildRoster(entries: AgentEntry[], overrides: Partial<AgentRosterState> = {}): AgentRosterState {
  const record: Record<string, AgentEntry> = {}
  const order: string[] = []
  for (const entry of entries) {
    record[entry.id] = entry
    order.push(entry.id)
  }
  return {
    entries: record,
    order,
    selectedId: null,
    filter: "all",
    ...overrides,
  }
}

export function visibleAgentIds(state: AgentRosterState): string[] {
  const ids = state.order.filter((id) => state.entries[id])
  return ids.filter((id) => {
    const entry = state.entries[id]
    switch (state.filter) {
      case "active":
        return isActive(entry.status)
      case "handoff":
        return entry.handoff === "ready" || entry.handoff === "done"
      case "failed":
        return entry.status === "failed"
      case "all":
      default:
        return true
    }
  })
}

export function effectiveSelection(state: AgentRosterState): string | null {
  const ids = visibleAgentIds(state)
  if (ids.length === 0) return null
  if (state.selectedId && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

export function moveSelection(state: AgentRosterState, direction: 1 | -1): string | null {
  const ids = visibleAgentIds(state)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

export const FILTER_CYCLE: RosterFilter[] = ["all", "active", "handoff", "failed"]

export function nextFilter(mode: RosterFilter): RosterFilter {
  return FILTER_CYCLE[(FILTER_CYCLE.indexOf(mode) + 1) % FILTER_CYCLE.length]
}

function withEntry(state: AgentRosterState, id: string, patch: Partial<AgentEntry>): AgentRosterState {
  const entry = state.entries[id]
  if (!entry) return state
  return { ...state, entries: { ...state.entries, [id]: { ...entry, ...patch } } }
}

/** Append a streamed chunk to an agent and nudge its progress forward. */
export function applyStream(state: AgentRosterState, id: string, chunk: string): AgentRosterState {
  const entry = state.entries[id]
  if (!entry) return state
  const stream = (entry.stream + chunk).slice(-400)
  const progress = Math.min(100, entry.progress + Math.max(1, Math.round(chunk.length / 10)))
  return withEntry(state, id, { stream, progress, status: "working" })
}

/** Mark an agent's task complete: full progress and a handoff that is ready for review. */
export function completeAgent(state: AgentRosterState, id: string): AgentRosterState {
  const entry = state.entries[id]
  if (!entry) return state
  const handoff = entry.handoff === "none" ? "ready" : entry.handoff
  return withEntry(state, id, { status: "done", progress: 100, handoff })
}

export function markHandoffReady(state: AgentRosterState, id: string): AgentRosterState {
  return withEntry(state, id, { handoff: "ready" })
}

/** Accept a ready handoff: the specialist's work is folded back into the session. */
export function acceptHandoff(state: AgentRosterState, id: string): AgentRosterState {
  return withEntry(state, id, { handoff: "done", status: "done" })
}

/** Failure path: a specialist's task fails. Handoff resets and the error is recorded. */
export function failAgent(state: AgentRosterState, id: string, error: string): AgentRosterState {
  const entry = state.entries[id]
  if (!entry) return state
  return withEntry(state, id, { status: "failed", error, handoff: "none", progress: entry.progress })
}

/**
 * Attempt to retry a failed specialist. Returns the next state plus a `rejected`
 * flag when the specialist has already exhausted its attempts — the caller should
 * surface that as a failure path rather than silently rescheduling.
 */
export function retryAgent(
  state: AgentRosterState,
  id: string,
): { state: AgentRosterState; rejected: boolean; attempts: number } {
  const entry = state.entries[id]
  if (!entry) return { state, rejected: true, attempts: 0 }
  if (entry.attempts >= entry.maxAttempts) {
    return {
      state: withEntry(state, id, { error: `Max retries (${entry.maxAttempts}) reached` }),
      rejected: true,
      attempts: entry.attempts,
    }
  }
  const attempts = entry.attempts + 1
  return {
    state: withEntry(state, id, { attempts, status: "working", error: undefined }),
    rejected: false,
    attempts,
  }
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + "…"
}

export interface RosterCounts {
  total: number
  active: number
  handoff: number
  failed: number
}

export function rosterCounts(state: AgentRosterState): RosterCounts {
  const entries = Object.values(state.entries)
  return {
    total: entries.length,
    active: entries.filter((entry) => isActive(entry.status)).length,
    handoff: entries.filter((entry) => entry.handoff === "ready" || entry.handoff === "done").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
  }
}
