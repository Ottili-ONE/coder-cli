/**
 * Git status & branch bar domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, or SDK
 * dependencies so the bar logic can be unit tested in isolation and reused by
 * the Solid component in `./index.tsx`. Every transition is pure: it takes
 * inputs and returns new values, which keeps the data flow deterministic and
 * snapshot-free in tests.
 *
 * The bar projects the git state of the working tree into a single ordered
 * row of focusable segments — branch, dirty state, ahead/behind sync, worktree
 * and conflict indicators — with a derived lifecycle status that the panel
 * header renders. It mirrors the conventions of the `build-validation` and
 * `task-queue` components: a `gitStatusState` entry point, a derived `status`,
 * visible/filtered selection, and a context object that lifts harness concerns
 * (loading / error) above the raw status so the same model serves live,
 * streaming and failure states.
 */

import stripAnsi from "strip-ansi"

/** A focusable region of the bar. */
export type GitSegmentKind = "branch" | "dirty" | "sync" | "worktree" | "conflict"

/**
 * Sparse git status the harness streams into the bar. All fields are optional
 * so partial updates during streaming can merge over the previous snapshot.
 */
export interface GitRepoStatus {
  /** Current branch name. Undefined when detached or not on a branch. */
  readonly branch?: string
  /** Repository default branch (e.g. main). */
  readonly defaultBranch?: string
  /** Configured upstream ref, e.g. "origin/main". */
  readonly upstream?: string
  /** HEAD is detached (no branch). */
  readonly detached?: boolean
  /** Working tree or index has changes. */
  readonly dirty?: boolean
  /** Count of staged changes. */
  readonly staged?: number
  /** Count of modified (tracked) files. */
  readonly modified?: number
  /** Count of untracked files. */
  readonly untracked?: number
  /** Commits ahead of the upstream. */
  readonly ahead?: number
  /** Commits behind the upstream. */
  readonly behind?: number
  /** The working tree is a git worktree. */
  readonly worktree?: boolean
  /** Path of the worktree, when relevant. */
  readonly worktreePath?: string
  /** Number of unresolved merge/rebase conflicts. */
  readonly conflicts?: number
  /** Number of stashed changes. */
  readonly stash?: number
}

/** Whole-bar lifecycle derived from context + status. */
export type GitBarStatus =
  | "not-git"
  | "clean"
  | "dirty"
  | "conflict"
  | "syncing"
  | "error"

/** Harness-level concerns lifted above the raw status. */
export interface GitBarContext {
  /** The directory is inside a git repository. */
  readonly isGit: boolean
  /** A status refresh is currently in flight (streaming update). */
  readonly loading: boolean
  /** Harness-level error (git crash, repo corruption, permission). Redacted on render. */
  readonly error?: string
}

export interface GitSegment {
  readonly kind: GitSegmentKind
  /** Primary glyph, e.g. "⎇" for the branch. */
  readonly glyph: string
  /** Human label, e.g. "main" or "dirty". */
  readonly label: string
  /** Optional trailing detail, e.g. "↑2 ↓1". */
  readonly detail?: string
  /** Whether the segment is focusable by the keyboard. */
  readonly focusable: boolean
  /** Whether the segment is shown only on standard-width terminals. */
  readonly wideOnly: boolean
}

export interface GitBarState {
  readonly status: GitBarStatus
  readonly segments: ReadonlyArray<GitSegment>
  readonly focusIndex: number
  readonly focusedKind: GitSegmentKind | null
  readonly narrow: boolean
  /** True while a refresh is streaming and the rendered data is stale. */
  readonly stale: boolean
  /** One-line header summary, safe to render verbatim. */
  readonly summaryText: string
}

export const NARROW_WIDTH_DEFAULT = 60
export const ERROR_MAX = 240

// --- input normalization ----------------------------------------------------

function redactSecrets(text: string): string {
  if (!text) return text
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ••••")
    .replace(/\b(token|secret)-[A-Za-z0-9_-]{6,}/gi, "$1-••••")
    .replace(/(sk|pk|api[_-]?key|token|secret|password|bearer)\s*[=:]\s*\S+/gi, (m) =>
      /=\s*$/.test(m) || /:\s*$/.test(m) ? m : m.replace(/\S+$/, "••••"),
    )
    .replace(/(Bearer|sk|pk)-[A-Za-z0-9_-]{8,}/g, (m) => `${m.slice(0, 6)}••••`)
}

function truncateError(text: string): string {
  const cleaned = stripAnsi(text ?? "").replace(/\t/g, "  ").trim()
  if (cleaned.length <= ERROR_MAX) return cleaned
  return cleaned.slice(0, ERROR_MAX - 1) + "…"
}

/** Redact and bound a harness error for safe display. */
export function redactError(text: string): string {
  return redactSecrets(truncateError(text))
}

/**
 * Map a raw git error string to a friendly, redacted message. Total: unknown
 * errors fall through to the redacted original so the bar never throws.
 */
export function parseGitError(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const text = redactError(raw)
  if (/not a git repository|not.*git/i.test(text)) return "not a git repository"
  if (/detected dubious ownership/i.test(text)) return "dubious repository ownership — run as the repo owner"
  if (/permission denied|access is denied/i.test(text)) return "git permission denied"
  if (/repository corrupt|bad object|index corrupt/i.test(text)) return "git repository is corrupted"
  return text
}

// --- status derivation ------------------------------------------------------

/** Classify the whole bar lifecycle from harness context + status. */
export function deriveStatus(ctx: GitBarContext, status: GitRepoStatus): GitBarStatus {
  if (!ctx.isGit) return "not-git"
  if (ctx.error) return "error"
  if (ctx.loading) return "syncing"
  if ((status.conflicts ?? 0) > 0) return "conflict"
  if (status.dirty) return "dirty"
  return "clean"
}

// --- segment projection -----------------------------------------------------

const BRANCH_GLYPH = "⎇"
const DIRTY_GLYPH = "●"
const WORKTREE_GLYPH = "⚑"
const CONFLICT_GLYPH = "⚠"

function changeCount(status: GitRepoStatus): number {
  return (
    (status.staged ?? 0) + (status.modified ?? 0) + (status.untracked ?? 0)
  )
}

/** Build the ordered, focusable segment list for the current status. */
export function buildSegments(status: GitRepoStatus): GitSegment[] {
  const segments: GitSegment[] = []

  const branchLabel = status.detached ? "detached" : status.branch ?? "no branch"
  segments.push({ kind: "branch", glyph: BRANCH_GLYPH, label: branchLabel, focusable: true, wideOnly: false })

  if (status.dirty || changeCount(status) > 0) {
    const count = changeCount(status)
    const label = count > 0 ? `dirty ${count}` : "dirty"
    segments.push({ kind: "dirty", glyph: DIRTY_GLYPH, label, focusable: true, wideOnly: false })
  }

  const ahead = status.ahead ?? 0
  const behind = status.behind ?? 0
  if (ahead > 0 || behind > 0) {
    const parts: string[] = []
    if (ahead > 0) parts.push(`↑${ahead}`)
    if (behind > 0) parts.push(`↓${behind}`)
    segments.push({ kind: "sync", glyph: "", label: "sync", detail: parts.join(" "), focusable: true, wideOnly: true })
  }

  if (status.worktree) {
    const label = status.worktreePath ? `worktree ${status.worktreePath}` : "worktree"
    segments.push({ kind: "worktree", glyph: WORKTREE_GLYPH, label, focusable: true, wideOnly: true })
  }

  const conflicts = status.conflicts ?? 0
  if (conflicts > 0) {
    segments.push({
      kind: "conflict",
      glyph: CONFLICT_GLYPH,
      label: "conflict",
      detail: `${conflicts}`,
      focusable: true,
      wideOnly: false,
    })
  }

  return segments
}

// --- state construction -----------------------------------------------------

export interface GitStatusOverrides {
  readonly focusIndex?: number
  readonly focusKind?: GitSegmentKind | null
  /** Actual terminal width. Wide-only segments are dropped below `narrowWidth`. */
  readonly width?: number
  readonly narrowWidth?: number
}

export function gitStatusState(
  status: GitRepoStatus,
  ctx: GitBarContext,
  overrides: GitStatusOverrides = {},
): GitBarState {
  const narrowWidth = overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT
  const width = overrides.width ?? narrowWidth
  const narrow = isNarrowTerminal(width, narrowWidth)
  const segments = buildSegments(status).filter((s) => !s.wideOnly || !narrow)
  const focusable = segments.filter((s) => s.focusable)

  let focusIndex: number
  if (overrides.focusKind != null) {
    const idx = focusable.findIndex((s) => s.kind === overrides.focusKind)
    focusIndex = idx >= 0 ? idx : 0
  } else if (overrides.focusIndex != null) {
    focusIndex = Math.min(Math.max(0, overrides.focusIndex), Math.max(0, focusable.length - 1))
  } else {
    focusIndex = focusable.length > 0 ? 0 : -1
  }

  const focusedKind = focusIndex >= 0 && focusIndex < focusable.length ? focusable[focusIndex].kind : null
  const barStatus = deriveStatus(ctx, status)
  const stale = ctx.loading && barStatus !== "not-git" && barStatus !== "error"

  return {
    status: barStatus,
    segments,
    focusIndex,
    focusedKind,
    narrow,
    stale,
    summaryText: summary(barStatus, status, ctx),
  }
}

// --- keyboard navigation & focus -------------------------------------------

/** Move the focus between segments. Clamps at the ends (no wrap). */
export function moveFocus(state: GitBarState, direction: 1 | -1): number {
  const count = state.segments.filter((s) => s.focusable).length
  if (count === 0) return -1
  if (state.focusIndex < 0) return direction === 1 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, state.focusIndex + direction))
}

/** Index of a segment kind, or -1 when not present/focusable. */
export function focusIndexForKind(state: GitBarState, kind: GitSegmentKind): number {
  return state.segments.filter((s) => s.focusable).findIndex((s) => s.kind === kind)
}

/** Action emitted when the focused segment is activated (enter). */
export type GitBarAction =
  | { type: "branch" }
  | { type: "changes" }
  | { type: "sync" }
  | { type: "worktree" }
  | { type: "resolve" }

export function actionFor(kind: GitSegmentKind | null): GitBarAction | null {
  switch (kind) {
    case "branch":
      return { type: "branch" }
    case "dirty":
      return { type: "changes" }
    case "sync":
      return { type: "sync" }
    case "worktree":
      return { type: "worktree" }
    case "conflict":
      return { type: "resolve" }
    default:
      return null
  }
}

// --- streaming reconciliation ------------------------------------------------

/**
 * Merge a partial status update into the previous snapshot, preserving fields
 * the partial update omits. Used when the harness streams incremental git
 * state (e.g. dirty flag flips before ahead/behind resolves). Total.
 */
export function mergeStatus(prev: GitRepoStatus, partial: Partial<GitRepoStatus>): GitRepoStatus {
  return { ...prev, ...partial }
}

// --- presentation helpers ---------------------------------------------------

export function isNarrowTerminal(width: number, narrowWidth: number = NARROW_WIDTH_DEFAULT): boolean {
  return width < narrowWidth
}

export function fitWidth(text: string, width: number): string {
  if (width <= 0) return ""
  const clean = stripAnsi(text ?? "").trim()
  if (clean.length <= width) return clean
  if (width === 1) return clean.slice(0, 1) + "…"
  return clean.slice(0, width - 1) + "…"
}

export function segmentGlyph(segment: GitSegment, useColor: boolean): string {
  if (!segment.glyph) return ""
  if (!useColor) return segment.kind === "dirty" ? "M" : segment.glyph
  return segment.glyph
}

/** One-line header summary, mirroring the other panels' phrasing. */
export function summary(status: GitBarStatus, repo: GitRepoStatus, ctx: GitBarContext): string {
  if (status === "not-git") return "Not a git repository"
  if (status === "error") return `Git status unavailable — ${parseGitError(ctx.error) ?? "unknown error"}`
  if (status === "syncing") return "Syncing git status…"

  const branch = repo.detached ? "detached HEAD" : repo.branch ?? "no branch"
  if (status === "conflict") return `Git — ${branch} · ${repo.conflicts ?? 0} conflict${(repo.conflicts ?? 0) === 1 ? "" : "s"}`
  if (status === "dirty") {
    const ahead = repo.ahead ?? 0
    const behind = repo.behind ?? 0
    const sync = ahead || behind ? ` · ↑${ahead} ↓${behind}` : ""
    return `Git — ${branch} · dirty${sync}`
  }
  const ahead = repo.ahead ?? 0
  const behind = repo.behind ?? 0
  if (ahead > 0 || behind > 0) return `Git — ${branch} · clean · ↑${ahead} ↓${behind}`
  return `Git — ${branch} · clean`
}
