/**
 * Conflict resolution domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, or SDK
 * dependencies so the resolver logic can be unit tested in isolation and
 * reused by the Solid component in `./index.tsx`. Every transition is pure:
 * it takes inputs and returns new values, which keeps the data flow
 * deterministic and snapshot-free in tests.
 *
 * The panel projects an in-progress git merge or rebase into an ordered,
 * focusable list of conflicted files. Each file can be resolved to one side
 * (ours / theirs), a union, or a manual edit. The model derives a validation
 * report and the lifecycle status that the panel header renders. It mirrors
 * the conventions of the `git-status`, `build-validation` and `task-queue`
 * components: a `conflictResolutionState` entry point, a derived `status`,
 * visible/filtered selection, and a context object that lifts harness
 * concerns (loading / error) above the raw file list so the same model
 * serves live, streaming and failure states.
 */

import stripAnsi from "strip-ansi"
import { redactError } from "../git-status/model"

/** Whether the conflicts came from a merge, a rebase, or an unknown source. */
export type ConflictType = "merge" | "rebase" | "unknown"

/** How a single conflicted file was resolved. */
export type ConflictSide = "ours" | "theirs" | "union" | "manual"

/** One conflicted file in the working tree. */
export interface ConflictFile {
  /** Repository-relative path of the conflicted file. */
  readonly path: string
  /** The operation that produced this conflict. */
  readonly type: ConflictType
  /** True for binary conflicts that cannot be text-merged automatically. */
  readonly binary?: boolean
  /** The chosen resolution, or undefined while still unresolved. */
  readonly resolution?: ConflictSide
  /** Edited content, present only when `resolution` is `"manual"`. */
  readonly content?: string
  /** Count of <<<<<<< conflict regions in this file. */
  readonly conflictRegions?: number
  /** Lines added across all conflict regions (ours + theirs). */
  readonly additions?: number
  /** Lines deleted across all conflict regions. */
  readonly deletions?: number
  /** Per-region resolution state for the conflict preview. */
  readonly regionResolutions?: Array<{
    regionIndex: number
    resolution?: ConflictSide
    content?: string
  }>
}

/** Whole-panel lifecycle derived from context + files. */
export type ConflictResolutionStatus =
  | "empty"
  | "resolving"
  | "ready"
  | "error"

/** Harness-level concerns lifted above the raw file list. */
export interface ConflictContext {
  /** A conflict list refresh is currently in flight (streaming update). */
  readonly loading: boolean
  /** Harness-level error (git crash, permission, corrupted index). Redacted on render. */
  readonly error?: string
}

export interface ConflictResolutionState {
  readonly operation: ConflictType
  readonly files: ReadonlyArray<ConflictFile>
  readonly focusIndex: number
  readonly focusedPath: string | null
  readonly resolved: number
  readonly unresolved: number
  readonly allResolved: boolean
  readonly narrow: boolean
  /** True while a refresh is streaming and the rendered data is stale. */
  readonly stale: boolean
  readonly status: ConflictResolutionStatus
  /** One-line header summary, safe to render verbatim. */
  readonly summaryText: string
  /** Whether the conflict preview panel is open for the focused file. */
  readonly previewOpen: boolean
  /** Index of the file whose preview is open. */
  readonly previewFileIndex: number
  /** Which zone has keyboard focus — the file list or the preview regions. */
  readonly previewFocus: "list" | "regions"
  /** Active file list filter query. Empty string means no filter. */
  readonly filterQuery: string
  /** Files filtered by filterQuery. Reference-equal to files when no filter is active. */
  readonly filteredFiles: ReadonlyArray<ConflictFile>
  /** Total conflict regions across all files (for summary display). */
  readonly conflictRegionsTotal: number
}

export const NARROW_WIDTH_DEFAULT = 60
export const ERROR_MAX = 240

// --- input normalization ----------------------------------------------------

export function normalizeConflictType(op?: string): ConflictType {
  if (op === "merge" || op === "rebase") return op
  return "unknown"
}

/** Build a conflict file with sensible defaults. */
export function makeConflict(
  path: string,
  type: ConflictType = "unknown",
  over: Partial<ConflictFile> = {},
): ConflictFile {
  return { path, type, ...over }
}

// --- resolution -------------------------------------------------------------

/** Return a new list with `path` resolved to `side` (and optional content). */
export function resolveFile(
  files: ReadonlyArray<ConflictFile>,
  path: string,
  side: ConflictSide,
  content?: string,
): ConflictFile[] {
  return files.map((f) =>
    f.path === path
      ? { ...f, resolution: side, content: side === "manual" ? content : undefined }
      : f,
  )
}

/** Return a new list with `path` returned to the unresolved state. */
export function unresolveFile(
  files: ReadonlyArray<ConflictFile>,
  path: string,
): ConflictFile[] {
  return files.map((f) => (f.path === path ? { ...f, resolution: undefined, content: undefined } : f))
}

// --- validation -------------------------------------------------------------

export interface ResolutionReport {
  readonly total: number
  readonly resolved: number
  readonly unresolved: number
  readonly allResolved: boolean
  /** Files that still need a resolution. */
  readonly remaining: ReadonlyArray<ConflictFile>
}

/** Classify how many conflicts remain and whether the set is ready to continue. */
export function validateResolution(files: ReadonlyArray<ConflictFile>): ResolutionReport {
  const resolved = files.filter((f) => f.resolution).length
  const unresolved = files.length - resolved
  return {
    total: files.length,
    resolved,
    unresolved,
    allResolved: files.length > 0 && unresolved === 0,
    remaining: files.filter((f) => !f.resolution),
  }
}

// --- streaming reconciliation ------------------------------------------------

/**
 * Merge a partial conflict list into the previous snapshot, keyed by path.
 * Used when the harness streams incremental conflict discovery (e.g. the
 * count rises before every file is enumerated). An existing resolution is
 * preserved when the partial entry omits it. Total.
 */
export function mergeConflicts(
  prev: ReadonlyArray<ConflictFile>,
  partial: ReadonlyArray<ConflictFile>,
): ConflictFile[] {
  const byPath = new Map<string, ConflictFile>()
  for (const f of prev) byPath.set(f.path, f)
  for (const f of partial) {
    const existing = byPath.get(f.path)
    byPath.set(f.path, existing ? { ...existing, ...f, resolution: f.resolution ?? existing.resolution } : f)
  }
  return [...byPath.values()]
}

// --- filtering --------------------------------------------------------------

/** Filter files by case-insensitive path substring match. */
export function filterFiles(
  files: ReadonlyArray<ConflictFile>,
  query: string,
): ReadonlyArray<ConflictFile> {
  if (!query) return files
  const lower = query.toLowerCase()
  return files.filter((f) => f.path.toLowerCase().includes(lower))
}

// --- preview state ----------------------------------------------------------

/** Toggle the conflict preview for a file index. Returns new previewOpen + previewFileIndex. */
export function togglePreview(
  state: ConflictResolutionState,
  fileIndex: number,
): Pick<ConflictResolutionState, "previewOpen" | "previewFileIndex" | "previewFocus"> {
  if (state.previewOpen && state.previewFileIndex === fileIndex) {
    return { previewOpen: false, previewFileIndex: fileIndex, previewFocus: "list" }
  }
  return { previewOpen: true, previewFileIndex: fileIndex, previewFocus: "list" }
}

/** Cycle the keyboard focus zone between the file list and conflict regions. */
export function previewFocusTab(state: ConflictResolutionState): "list" | "regions" {
  return state.previewFocus === "list" ? "regions" : "list"
}

/** Count conflict regions across all files for summary display. */
export function totalConflictRegions(files: ReadonlyArray<ConflictFile>): number {
  return files.reduce((sum, f) => sum + (f.conflictRegions ?? 0), 0)
}

// --- keyboard navigation & focus -------------------------------------------

/** Move the focus between files. Clamps at the ends (no wrap). */
export function moveFocus(state: ConflictResolutionState, direction: 1 | -1): number {
  const count = state.files.length
  if (count === 0) return -1
  if (state.focusIndex < 0) return direction === 1 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, state.focusIndex + direction))
}

/** Index of a file path, or -1 when not present. */
export function focusIndexForPath(files: ReadonlyArray<ConflictFile>, path: string): number {
  return files.findIndex((f) => f.path === path)
}

// --- actions ----------------------------------------------------------------

export type ConflictAction =
  | { type: "select"; path: string }
  | { type: "resolve"; path: string; side: ConflictSide }
  | { type: "continue" }
  | { type: "abort" }
  | { type: "blocked"; reason: string }

/** User activated the focused file (enter). */
export function selectAction(path: string | null): ConflictAction | null {
  return path ? { type: "select", path } : null
}

/** User asked to resolve the focused file to a side. */
export function resolveAction(path: string | null, side: ConflictSide): ConflictAction | null {
  return path ? { type: "resolve", path, side } : null
}

/**
 * User asked to continue the merge/rebase. This is blocked with a reason
 * until every conflict has a resolution — the failure path the panel guards.
 */
export function continueAction(allResolved: boolean, unresolved: number): ConflictAction {
  return allResolved
    ? { type: "continue" }
    : { type: "blocked", reason: `${unresolved} conflict${unresolved === 1 ? "" : "s"} still unresolved` }
}

/** User asked to abort the merge/rebase. */
export function abortAction(): ConflictAction {
  return { type: "abort" }
}

// --- presentation helpers ---------------------------------------------------

export function isNarrowTerminal(width: number, narrowWidth: number = NARROW_WIDTH_DEFAULT): boolean {
  return width < narrowWidth
}

/** Short label for a resolution side, or a placeholder for unresolved. */
export function resolutionBadge(file: ConflictFile): string {
  if (!file.resolution) return "[ ]"
  if (file.resolution === "manual") return "[manual]"
  return `[${file.resolution}]`
}

function operationWord(operation: ConflictType): string {
  if (operation === "rebase") return "Rebase"
  if (operation === "merge") return "Merge"
  return "Conflict"
}

/** One-line header summary, mirroring the other panels' phrasing. */
export function summary(
  operation: ConflictType,
  files: ReadonlyArray<ConflictFile>,
  ctx: ConflictContext,
): string {
  if (ctx.error) return `Conflict resolution failed — ${redactError(ctx.error)}`
  const word = operationWord(operation)
  if (files.length === 0) return `${word} conflicts — none`
  const report = validateResolution(files)
  if (report.allResolved) {
    return `${word} conflicts — ${report.resolved}/${report.total} resolved · ready to continue`
  }
  return `${word} conflicts — ${report.resolved}/${report.total} resolved · ${report.unresolved} to go`
}

// --- state construction -----------------------------------------------------

export interface ConflictOverrides {
  readonly focusIndex?: number
  readonly focusPath?: string
  /** Actual terminal width. Secondary columns are dropped below `narrowWidth`. */
  readonly width?: number
  readonly narrowWidth?: number
  readonly operation?: ConflictType
  readonly filterQuery?: string
  readonly previewOpen?: boolean
  readonly previewFileIndex?: number
  readonly previewFocus?: "list" | "regions"
}

export function conflictResolutionState(
  files: ReadonlyArray<ConflictFile>,
  ctx: ConflictContext,
  overrides: ConflictOverrides = {},
): ConflictResolutionState {
  const narrowWidth = overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT
  const width = overrides.width ?? narrowWidth
  const narrow = isNarrowTerminal(width, narrowWidth)
  const operation = overrides.operation ?? files[0]?.type ?? "merge"
  const report = validateResolution(files)

  let focusIndex: number
  if (overrides.focusPath != null) {
    const idx = focusIndexForPath(files, overrides.focusPath)
    focusIndex = idx >= 0 ? idx : 0
  } else if (overrides.focusIndex != null) {
    focusIndex = Math.min(Math.max(0, overrides.focusIndex), Math.max(0, files.length - 1))
  } else {
    focusIndex = files.length > 0 ? 0 : -1
  }

  const status: ConflictResolutionStatus = ctx.error
    ? "error"
    : files.length === 0
      ? "empty"
      : ctx.loading
        ? "resolving"
        : "ready"

  // When in error state, clear the focused path so the view shows no file details.
  const focusedPath = status === "error" ? null : focusIndex >= 0 && focusIndex < files.length ? files[focusIndex].path : null
  const stale = ctx.loading && files.length > 0

  const filterQuery = overrides.filterQuery ?? ""
  const filteredFiles = filterQuery ? filterFiles(files, filterQuery) : files

  const previewOpen = overrides.previewOpen ?? false
  const previewFileIndex = overrides.previewFileIndex ?? (focusIndex >= 0 ? focusIndex : -1)

  const conflictRegionsTotal = files.reduce((sum, f) => sum + (f.conflictRegions ?? 0), 0)

  return {
    operation,
    files,
    focusIndex,
    focusedPath,
    resolved: report.resolved,
    unresolved: report.unresolved,
    allResolved: report.allResolved,
    narrow,
    stale,
    status,
    summaryText: summary(operation, files, ctx),
    previewOpen,
    previewFileIndex,
    previewFocus: overrides.previewFocus ?? "list",
    filterQuery,
    filteredFiles,
    conflictRegionsTotal,
  }
}
