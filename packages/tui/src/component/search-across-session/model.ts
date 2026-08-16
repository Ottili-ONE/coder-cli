/**
 * Search across session — domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering or SDK dependencies so the
 * search logic can be unit tested in isolation and reused by the Solid component
 * in `./index.tsx`. All transitions are pure: they take a state and return a new
 * value, which keeps the data flow deterministic and snapshot-free in tests.
 *
 * The surface searches a single session over six categories: messages, tool
 * calls, files, tasks, errors and decisions. Categories keep the result list
 * legible and let the user narrow a noisy session down to the kind of artifact
 * they are looking for.
 */

export type SearchCategory = "message" | "tool" | "file" | "task" | "error" | "decision"

export const CATEGORY_ORDER: SearchCategory[] = [
  "message",
  "tool",
  "file",
  "task",
  "error",
  "decision",
]

export const CATEGORY_LABEL: Record<SearchCategory, string> = {
  message: "Messages",
  tool: "Tool calls",
  file: "Files",
  task: "Tasks",
  error: "Errors",
  decision: "Decisions",
}

/** Visible glyph per category. Geometric/technical symbols only — no emoji. */
export const CATEGORY_ICON: Record<SearchCategory, string> = {
  message: "✉",
  tool: "⚙",
  file: "▤",
  task: "☑",
  error: "⚠",
  decision: "◆",
}

export type SearchCategoryFilter = "all" | SearchCategory

export interface SearchEntry {
  /** Stable id unique within the session search index. */
  id: string
  category: SearchCategory
  /** Short one-line summary shown as the row title. */
  title: string
  /** Longer body used for matching and shown on narrow/inspection widths. */
  body: string
  /**
   * Navigation target. For most categories this is the originating message id
   * so selecting a result lands on its source via the session route.
   */
  sourceID: string
  /** Optional secondary context (tool state, file path, task status). */
  meta?: string
  /** Creation time, used as a stable tie-breaker when ranking. */
  timestamp?: number
}

export interface SearchState {
  entries: SearchEntry[]
  query: string
  category: SearchCategoryFilter
  selectedId: string | null
  /** Set when indexing or lookup fails; the UI surfaces this as a failure path. */
  error: string | null
}

export interface SearchStateOverrides extends Partial<SearchState> {}

export function buildState(entries: SearchEntry[], overrides: SearchStateOverrides = {}): SearchState {
  return {
    entries,
    query: "",
    category: "all",
    selectedId: null,
    error: null,
    ...overrides,
  }
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + "…"
}

/**
 * Score how well an entry matches a query. Returns 0 when there is no match
 * (the entry is filtered out). Higher is a better match so results can be
 * ranked rather than shown in raw insertion order.
 */
export function matchScore(entry: SearchEntry, query: string): number {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return 1
  const title = entry.title.toLowerCase()
  const body = entry.body.toLowerCase()
  const meta = (entry.meta ?? "").toLowerCase()
  const titleExact = title === q ? 100 : 0
  const titlePrefix = title.startsWith(q) ? 60 : 0
  const titleSub = title.includes(q) ? 40 : 0
  const metaSub = meta.includes(q) ? 25 : 0
  const bodySub = body.includes(q) ? 15 : 0
  return titleExact + titlePrefix + titleSub + metaSub + bodySub
}

/** Apply the active category filter and query, then rank the survivors. */
export function visibleEntries(state: SearchState): SearchEntry[] {
  const filtered = state.entries.filter((entry) => {
    if (state.category !== "all" && entry.category !== state.category) return false
    if (state.query.trim().length === 0) return true
    return matchScore(entry, state.query) > 0
  })
  const ranked = filtered
    .map((entry) => ({ entry, score: matchScore(entry, state.query) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const ta = a.entry.timestamp ?? 0
      const tb = b.entry.timestamp ?? 0
      if (tb !== ta) return tb - ta
      return a.entry.id.localeCompare(b.entry.id)
    })
  return ranked.map((r) => r.entry)
}

export function categoryCounts(entries: SearchEntry[]): Record<SearchCategory, number> {
  const counts: Record<SearchCategory, number> = {
    message: 0,
    tool: 0,
    file: 0,
    task: 0,
    error: 0,
    decision: 0,
  }
  for (const entry of entries) counts[entry.category]++
  return counts
}

/** The id that should be focused, clamped to the visible list. */
export function effectiveSelection(state: SearchState): string | null {
  const ids = visibleEntries(state).map((e) => e.id)
  if (ids.length === 0) return null
  if (state.selectedId && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

/** Move the focus by one row, clamping at the ends of the visible list. */
export function moveSelection(state: SearchState, direction: 1 | -1): string | null {
  const ids = visibleEntries(state).map((e) => e.id)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

export const CATEGORY_FILTER_CYCLE: SearchCategoryFilter[] = ["all", ...CATEGORY_ORDER]

export function nextCategory(filter: SearchCategoryFilter): SearchCategoryFilter {
  return CATEGORY_FILTER_CYCLE[(CATEGORY_FILTER_CYCLE.indexOf(filter) + 1) % CATEGORY_FILTER_CYCLE.length]
}

/** Human-readable label for the active filter, used in the footer/header. */
export function categoryFilterLabel(filter: SearchCategoryFilter): string {
  return filter === "all" ? "All" : CATEGORY_LABEL[filter]
}

/** Find the entry a selection should resolve to, or null when nothing is focusable. */
export function selectedEntry(state: SearchState): SearchEntry | null {
  const id = effectiveSelection(state)
  if (!id) return null
  return state.entries.find((e) => e.id === id) ?? null
}
