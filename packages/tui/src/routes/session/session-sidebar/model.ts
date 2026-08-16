/**
 * Pure domain model for the Ottili Coder Session sidebar.
 *
 * This module is intentionally free of any rendering, SDK, or Solid-JS runtime
 * dependencies so the sidebar logic can be unit tested in isolation and reused
 * by the Solid component in `./sidebar.tsx`. All transitions are pure: they take
 * plain data and return new plain data, which keeps the data flow deterministic
 * and snapshot-free in tests.
 */

/** Minimal session shape required to render the sidebar. Mirrors the real SDK
 *  `Session` contract fields the component relies on. */
export interface SidebarSession {
  id: string
  title: string
  parentID?: string | null
  directory: string
  path?: string
  workspaceID?: string | null
  time: {
    updated: number
    archived?: number | null
  }
}

/** Real-time execution state of a session, derived from the sync status map. */
export type ResumeState = "idle" | "busy" | "retry"

/** A single rendered row in the sidebar. */
export interface SidebarEntry {
  id: string
  title: string
  /** Human readable location shown under the title (basename of the directory). */
  directory: string
  /** Group key used for non-pinned rows (e.g. "Today" or a date string). */
  group: string
  isPinned: boolean
  isCurrent: boolean
  /** Quick-switch slot number when the session is pinned into a slot (1-9). */
  slot?: number
  /** Whether the session is currently running a turn or retrying. */
  resume: ResumeState
}

export interface SidebarGroup {
  key: string
  entries: SidebarEntry[]
}

export interface SidebarModel {
  /** Pinned sessions always shown first. */
  pinned: SidebarEntry[]
  /** Date-grouped (or search-result) groups of remaining sessions. */
  groups: SidebarGroup[]
  /** Active search query (empty when not searching). */
  query: string
  /** True when a query is active and results are filtered. */
  isSearching: boolean
}

export interface BuildSidebarInput {
  sessions: SidebarSession[]
  /** Pinned session ids in pin order. */
  pinnedIDs: string[]
  /** Quick-switch slot number per session id. */
  slotByID?: Map<string, number>
  /** Currently open session id, highlighted in the list. */
  currentID?: string
  /** Session status map keyed by session id. */
  statuses?: Record<string, { type: ResumeState }>
  /** Project main directory used to shorten the displayed location. */
  projectMainDir?: string
  /** Active search query. */
  query?: string
  /** Reference time used to compute "Today" grouping. Defaults to Date.now(). */
  now?: number
}

export function resumeState(status?: { type: ResumeState }): ResumeState {
  if (!status) return "idle"
  if (status.type === "busy" || status.type === "retry") return status.type
  return "idle"
}

/** Only top-level sessions are switchable; children are continuations. */
export function topLevelSessions(sessions: SidebarSession[]): SidebarSession[] {
  return sessions.filter((x) => x.parentID === undefined && x.time.archived == null)
}

export function sortByRecency(sessions: SidebarSession[]): SidebarSession[] {
  return [...sessions].sort((a, b) => b.time.updated - a.time.updated)
}

/** Case-insensitive match over title, full directory, and project path. */
export function matchesQuery(session: SidebarSession, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    session.title.toLowerCase().includes(q) ||
    session.directory.toLowerCase().includes(q) ||
    (session.path?.toLowerCase().includes(q) ?? false)
  )
}

/** Shorten a directory for display: drop the project prefix and show the basename. */
export function displayDirectory(session: SidebarSession, projectMainDir?: string): string {
  const full = session.directory || session.path || ""
  let dir = full
  if (projectMainDir && full.startsWith(projectMainDir)) {
    dir = full.slice(projectMainDir.length).replace(/^\/+/, "")
  }
  if (!dir) return ""
  return dir.length > 22 ? "…" + dir.slice(-21) : dir
}

function dateGroupKey(time: number, now: number): string {
  const updated = new Date(time).toDateString()
  const today = new Date(now).toDateString()
  return updated === today ? "Today" : updated
}

function toEntry(
  session: SidebarSession,
  input: BuildSidebarInput,
  group: string,
  isPinned: boolean,
): SidebarEntry {
  return {
    id: session.id,
    title: session.title,
    directory: displayDirectory(session, input.projectMainDir),
    group,
    isPinned,
    isCurrent: session.id === input.currentID,
    slot: input.slotByID?.get(session.id),
    resume: resumeState(input.statuses?.[session.id]),
  }
}

export function buildSidebar(input: BuildSidebarInput): SidebarModel {
  const now = input.now ?? Date.now()
  const query = input.query?.trim() ?? ""
  const isSearching = query.length > 0

  const candidates = sortByRecency(topLevelSessions(input.sessions))
  const pinnedSet = new Set(input.pinnedIDs.filter((id) => candidates.some((x) => x.id === id)))
  const slotByID = input.slotByID ?? new Map()

  if (isSearching) {
    const matches = candidates.filter((x) => matchesQuery(x, query))
    const entries = matches.map((x) => toEntry(x, input, "Results", pinnedSet.has(x.id)))
    return {
      pinned: [],
      groups: entries.length ? [{ key: "Results", entries }] : [],
      query,
      isSearching: true,
    }
  }

  const pinned = input.pinnedIDs
    .map((id) => candidates.find((x) => x.id === id))
    .filter((x): x is SidebarSession => x !== undefined)
    .map((x) => toEntry(x, input, "Pinned", true))

  const remaining = candidates.filter((x) => !pinnedSet.has(x.id))
  const groups = new Map<string, SidebarEntry[]>()
  for (const session of remaining) {
    const key = dateGroupKey(session.time.updated, now)
    const entry = toEntry(session, input, key, false)
    const bucket = groups.get(key)
    if (bucket) bucket.push(entry)
    else groups.set(key, [entry])
  }

  return {
    pinned,
    groups: [...groups.entries()].map(([key, entries]) => ({ key, entries })),
    query,
    isSearching: false,
  }
}

/** Flat, ordered list of selectable entries: pinned first, then each group. */
export function flattenEntries(model: SidebarModel): SidebarEntry[] {
  return [...model.pinned, ...model.groups.flatMap((group) => group.entries)]
}

export function moveSelection(
  entries: SidebarEntry[],
  currentId: string | undefined,
  direction: 1 | -1,
): string | undefined {
  if (entries.length === 0) return undefined
  const index = entries.findIndex((x) => x.id === currentId)
  if (index === -1) return entries[0].id
  const next = Math.min(entries.length - 1, Math.max(0, index + direction))
  return entries[next].id
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + "…"
}
