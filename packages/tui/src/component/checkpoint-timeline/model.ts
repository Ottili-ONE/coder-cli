/**
 * Checkpoint timeline domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, SDK, or Effect
 * dependencies so the timeline logic can be unit tested in isolation and reused
 * by the Solid component in `./index.tsx` and the web/desktop surfaces. Every
 * transition is pure: it takes raw Cairn checkpoint file contents and returns a
 * new `CheckpointTimelineState`, which keeps the data flow deterministic and
 * snapshot-free in tests.
 *
 * The timeline is the user-visible surface for the Cairn execution doctrine.
 * Its spine is the append-only logs (DECISIONS.md / VALIDATION_LOG.md /
 * KNOWN_PROBLEMS.md); CHECKPOINT.md is the "current state" header. The model
 * mirrors the conventions of `context-meter` and `project-switcher`: a single
 * `parseCheckpointTimeline` entry point, a derived `status`, visible/filtered
 * selection, focus navigation, and a width-aware rendering projection so the
 * same model serves full, compact, narrow and minimal terminal widths.
 *
 * The parsers here read the exact markdown written by
 * `packages/ottili-coder/src/cairn/checkpoint.ts` (serializeCheckpoint and the
 * append* writers). Keeping the reader local to the TUI avoids pulling the
 * Effect/FileSystem-backed cairn service into the TUI bundle while staying
 * wire-compatible with the on-disk format.
 */

// --- core types -------------------------------------------------------------

export type CheckpointEventKind = "milestone" | "decision" | "validation" | "failure" | "resume"

export type CheckpointEventStatus =
  | "pass"
  | "fail"
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"

export type CheckpointEventSeverity = "low" | "medium" | "high"

/** One row in the timeline. */
export interface CheckpointEvent {
  /** Stable id: `${kind}:${index}:${timestamp ?? "none"}`. */
  id: string
  kind: CheckpointEventKind
  /** ISO timestamp from the append-log header, or undefined (e.g. snapshot milestones). */
  timestamp: string | undefined
  /** Human summary (milestone title / command / problem / decision). */
  title: string
  /** Full result / rationale / unblock / notes, shown on expand. */
  detail: string | undefined
  status?: CheckpointEventStatus
  severity?: CheckpointEventSeverity
}

export type CheckpointTimelineStatus =
  | "empty"
  | "populated"
  | "loading"
  | "degraded"
  | "failure"
  | "denied"
  | "offline"
  | "long-content"

/** Harness-level concerns lifted above the raw file contents. */
export interface CheckpointTimelineContext {
  /** A fetch of the cairn files is in flight. */
  loading?: boolean
  /** The cairn read path errored (redacted on render). */
  error?: string
  /** The session/backend is unreachable; keep last-known timeline. */
  offline?: boolean
  /** The caller is not permitted to read these files. */
  denied?: boolean
}

export interface CheckpointTimelineState {
  /** Whether any checkpoint file was present. */
  exists: boolean
  goal: string
  mode: string
  currentMilestone: string | undefined
  nextAction: string | undefined
  blockers: string[]
  lastUpdated: string | undefined
  events: CheckpointEvent[]
  status: CheckpointTimelineStatus
  /** Milestone completion counts for the compact indicator. */
  milestoneDone: number
  milestoneTotal: number
  decisionCount: number
  failureCount: number
  /** The current resume point (nextAction), if any. */
  resume: string | undefined
  /** Index of the keyboard-focused event row, or -1 when nothing is focused. */
  focusIndex: number
  /** True when a refresh is in flight over a populated timeline (keep last-known). */
  stale: boolean
  /** One-line header summary for the indicator. */
  summaryText: string
  /** Banner text for the active lifecycle state (loading / empty / error / …). */
  statusText: string
  /** Events after the performance cap (largest-first, last-known retained). */
  visible: CheckpointEvent[]
  /** Number of events dropped by the cap. */
  truncated: number
  /** True when any title/detail was redacted while parsing. */
  redacted: boolean
  /** Full, screen-reader oriented description of the current state. */
  accessibleSummary: string
}

// --- width tiers ------------------------------------------------------------

/** Full header + absolute timestamps (HH:MM) + kind + summary + inline detail. */
export const WIDE_WIDTH = 100
/** Drop absolute timestamps → relative; keep kind + summary. */
export const STANDARD_WIDTH = 60
/** Drop relative time; glyph + one-line summary only. */
export const MINIMAL_WIDTH = 40

export function isNarrowTerminal(width: number): boolean {
  return width < STANDARD_WIDTH
}

export function isMinimalTerminal(width: number): boolean {
  return width < MINIMAL_WIDTH
}

// --- hardening constants & helpers -------------------------------------

/** Maximum number of events rendered before the tail is merged into "and N more". */
export const CHECKPOINT_TIMELINE_MAX_EVENTS = 200

/** Maximum cadence (ms) at which a live, streaming timeline re-samples its source. */
export const RENDER_BUDGET_MS = 400

/** Maximum length of a redacted harness error / diagnostic. */
export const ERROR_MAX = 240

/** True when the environment cannot render color (NO_COLOR or a dumb terminal). */
export function detectNoColor(): boolean {
  if (typeof process !== "undefined" && process.env.NO_COLOR) return true
  if (typeof process !== "undefined" && process.env.TERM === "dumb") return true
  return false
}

/** Redact secret material from an arbitrary user-visible string. */
export function redactText(text: string): string {
  if (!text) return text
  return text.replace(
    /(sk|AKIA|gh[pousr]_|Bearer|pk|api|token|secret|key|password)([-_]?)[A-Za-z0-9_-]{6,}/gi,
    (match, scheme: string, sep: string) => `${scheme}${sep}••••`,
  )
}

function truncateError(text: string): string {
  const cleaned = text.replace(/\t/g, "  ").trim()
  if (cleaned.length <= ERROR_MAX) return cleaned
  return cleaned.slice(0, ERROR_MAX - 1) + "…"
}

/** Redact and bound a harness error for safe display and diagnostics. */
export function redactError(text: string): string {
  return redactText(truncateError(text))
}

/** Map a raw read error to a friendly, redacted lifecycle status. */
export function classifyCheckpointError(raw: string | undefined): CheckpointTimelineStatus | undefined {
  if (!raw) return undefined
  const text = redactError(raw)
  if (/econnrefused|timed? ?out|503|service unavailable|network|offline|enotfound|enoent/i.test(text))
    return "offline"
  if (/403|forbidden|401|unauthorized|permission|access denied|eacces/i.test(text)) return "denied"
  return "failure"
}

/** Glyph for a lifecycle status (Claude Code-like density, Ottili palette). */
export const STATUS_GLYPH: Record<CheckpointTimelineStatus, string> = {
  empty: "·",
  populated: "▮",
  loading: "↻",
  degraded: "≈",
  failure: "⚠",
  denied: "⊘",
  offlline: "≈",
  "long-content": "▤",
}

/** Theme palette token name for a lifecycle status (component maps token → color). */
export function statusColorToken(status: CheckpointTimelineStatus): string {
  switch (status) {
    case "failure":
    case "denied":
      return "error"
    case "offline":
    case "degraded":
      return "warning"
    case "long-content":
      return "info"
    case "populated":
      return "success"
    default:
      return "text"
  }
}

/** Whether the status shows the event list (vs. a bare banner). */
export function checkpointStatusIsEventful(status: CheckpointTimelineStatus): boolean {
  return (
    status === "populated" ||
    status === "long-content" ||
    status === "degraded" ||
    status === "offline"
  )
}


// --- glyph & color projection ----------------------------------------------

/** Glyph for an event kind/status (Claude Code-like density, Ottili palette). */
export function glyphFor(event: CheckpointEvent, noColor: boolean = false): string {
  switch (event.kind) {
    case "decision":
      return noColor ? "*" : "◆"
    case "validation":
      return noColor ? "~" : "⌁"
    case "failure":
      return noColor ? "!" : "⊘"
    case "resume":
      return noColor ? "<-" : "↩"
    case "milestone":
      if (event.status === "completed") return noColor ? "[x]" : "✓"
      if (event.status === "blocked") return noColor ? "[!]" : "⊘"
      return noColor ? ">" : "▸"
  }
}

/** ASCII fallback glyphs for no-color terminals. */
export const ASCII_GLYPH: Record<CheckpointEventKind, string> = {
  milestone: ">",
  decision: "*",
  validation: "~",
  failure: "!",
  resume: "<-",
}

/** Theme palette token name for an event (component maps token → color). */
export function colorTokenFor(event: CheckpointEvent): string {
  switch (event.kind) {
    case "decision":
      return "info"
    case "resume":
      return "textMuted"
    case "validation":
      return event.status === "fail" ? "error" : "success"
    case "failure":
      return event.severity === "high" ? "error" : "warning"
    case "milestone":
      if (event.status === "completed") return "success"
      if (event.status === "blocked") return "error"
      if (event.status === "in_progress") return "warning"
      return "secondary"
  }
}

// --- CHECKPOINT.md parser ---------------------------------------------------

export interface ParsedCheckpoint {
  mode: string
  goal: string
  milestones: { title: string; status: CheckpointEventStatus; notes?: string }[]
  currentMilestone: string | undefined
  nextAction: string | undefined
  blockers: string[]
  lastUpdated: string | undefined
}

/**
 * Parse the CHECKPOINT.md markdown written by `serializeCheckpoint`. Returns
 * undefined when there is neither a goal nor any milestone (matches the
 * upstream `parseCheckpoint` "nothing to reconstruct" contract).
 */
export function parseCheckpointMd(content: string | undefined): ParsedCheckpoint | undefined {
  if (!content) return undefined
  const lines = content.split("\n")
  let mode = "build"
  let goal = ""
  let currentMilestone: string | undefined
  let nextAction: string | undefined
  const milestones: { title: string; status: CheckpointEventStatus; notes?: string }[] = []
  const blockers: string[] = []
  let section = ""
  let lastUpdated: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("**Last updated:**")) {
      lastUpdated = trimmed.slice(16).trim() || undefined
      continue
    }
    if (trimmed.startsWith("## ")) {
      section = trimmed.slice(3).toLowerCase()
      continue
    }
    if (trimmed.startsWith("**Mode:**")) {
      mode = trimmed.slice(9).trim() || "build"
      continue
    }
    if (trimmed.startsWith("**Goal:**")) {
      goal = trimmed.slice(9).trim()
      continue
    }
    if (section === "milestones" && trimmed.startsWith("- [")) {
      const completed = trimmed.startsWith("- [x]")
      const rest = trimmed.slice(completed ? 6 : 5)
      const dashIdx = rest.indexOf("—")
      if (dashIdx > 0) {
        const title = rest.slice(0, dashIdx).replace(/\*\*/g, "").trim()
        const afterDash = rest.slice(dashIdx + 1).trim()
        const notesIdx = afterDash.indexOf(" — ")
        const status = notesIdx > 0 ? afterDash.slice(0, notesIdx).trim() : afterDash.trim()
        const notes = notesIdx > 0 ? afterDash.slice(notesIdx + 3).trim() : undefined
        milestones.push({
          title,
          status: completed
            ? "completed"
            : status === "in_progress"
              ? "in_progress"
              : status === "blocked"
                ? "blocked"
                : "pending",
          notes,
        })
      }
      continue
    }
    if (section === "current milestone" && trimmed && !trimmed.startsWith("_(")) {
      currentMilestone = trimmed
      continue
    }
    if (section === "next action" && trimmed && !trimmed.startsWith("_(")) {
      nextAction = trimmed
      continue
    }
    if (section === "blockers" && trimmed.startsWith("- ")) {
      blockers.push(trimmed.slice(2).trim())
      continue
    }
  }

  if (!goal && milestones.length === 0) return undefined
  return { mode, goal, milestones, currentMilestone, nextAction, blockers, lastUpdated }
}

// --- append-log parsers -----------------------------------------------------

export interface ParsedDecision {
  timestamp: string | undefined
  decision: string
  rationale: string
}

/** Parse DECISIONS.md: a sequence of `## <ISO>` blocks with Decision/Rationale. */
export function parseDecisions(content: string | undefined): ParsedDecision[] {
  if (!content) return []
  return splitBlocks(content).map((block) => {
    const timestamp = block.header
    const decision = field(block.body, "Decision") ?? ""
    const rationale = field(block.body, "Rationale") ?? ""
    return { timestamp, decision: decision.trim(), rationale: rationale.trim() }
  })
}

export interface ParsedValidation {
  timestamp: string | undefined
  command: string
  result: string
  status: "pass" | "fail" | undefined
}

/** Parse VALIDATION_LOG.md: `## <ISO>` blocks with Command + fenced Result. */
export function parseValidations(content: string | undefined): ParsedValidation[] {
  if (!content) return []
  return splitBlocks(content).map((block) => {
    const timestamp = block.header
    const command = (field(block.body, "Command") ?? "").replace(/^`|`$/g, "").trim()
    const result = fenced(block.body).trim()
    return { timestamp, command, result, status: validationStatus(result) }
  })
}

export interface ParsedKnownProblem {
  timestamp: string | undefined
  severity: CheckpointEventSeverity
  problem: string
  unblock: string
}

/** Parse KNOWN_PROBLEMS.md: `## <ISO>` blocks with Severity/Problem/Unblock. */
export function parseKnownProblems(content: string | undefined): ParsedKnownProblem[] {
  if (!content) return []
  return splitBlocks(content).map((block) => {
    const timestamp = block.header
    const rawSeverity = (field(block.body, "Severity") ?? "medium").trim().toLowerCase()
    const severity: CheckpointEventSeverity =
      rawSeverity === "high" ? "high" : rawSeverity === "low" ? "low" : "medium"
    const problem = (field(block.body, "Problem") ?? "").trim()
    const unblock = (field(block.body, "Unblock") ?? "").trim()
    return { timestamp, severity, problem, unblock }
  })
}

// --- block splitting helpers ------------------------------------------------

interface Block {
  header: string | undefined
  body: string
}

/** Split an append-log file into `## <header>` … blocks (newest appended last). */
function splitBlocks(content: string): Block[] {
  const lines = content.split("\n")
  const blocks: Block[] = []
  let current: Block | undefined
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("## ")) {
      if (current) blocks.push(current)
      current = { header: trimmed.slice(3).trim() || undefined, body: "" }
      continue
    }
    if (!current) continue
    current.body += line + "\n"
  }
  if (current) blocks.push(current)
  return blocks
}

/** Pull the value of a `**Key:** value` line from a block body. */
function field(body: string, key: string): string | undefined {
  const match = body.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.*)`, "i"))
  return match ? match[1].trim() : undefined
}

/** Extract the contents of the first fenced code block in a block body. */
function fenced(body: string): string {
  const match = body.match(/```[\s\S]*?\n([\s\S]*?)```/)
  return match ? match[1] : body.replace(/\*\*/g, "").trim()
}

/**
 * Classify a validation result as pass/fail. Scans for explicit FAIL cues and
 * non-zero exit lines; returns undefined when ambiguous rather than guessing.
 */
export function validationStatus(result: string): "pass" | "fail" | undefined {
  const text = result.toLowerCase()
  if (/\bfail\b|failed|✗|error:|exception|traceback/.test(text)) return "fail"
  if (/exit code: [1-9]|\bexit [1-9]\b|non-zero/.test(text)) return "fail"
  if (/\bpass\b|passed|✓|ok\b/.test(text)) return "pass"
  return undefined
}

// --- event assembly ---------------------------------------------------------

function milestoneEvents(checkpoint: ParsedCheckpoint | undefined): CheckpointEvent[] {
  if (!checkpoint) return []
  return checkpoint.milestones.map((m, i) => ({
    id: `milestone:${i}:none`,
    kind: "milestone" as const,
    timestamp: undefined,
    title: m.title,
    detail: m.notes,
    status: m.status,
  }))
}

function decisionEvents(decisions: ParsedDecision[]): CheckpointEvent[] {
  return decisions.map((d, i) => ({
    id: `decision:${i}:${d.timestamp ?? "none"}`,
    kind: "decision" as const,
    timestamp: d.timestamp,
    title: d.decision,
    detail: d.rationale || undefined,
  }))
}

function validationEvents(validations: ParsedValidation[]): CheckpointEvent[] {
  return validations.map((v, i) => ({
    id: `validation:${i}:${v.timestamp ?? "none"}`,
    kind: "validation" as const,
    timestamp: v.timestamp,
    title: v.command,
    detail: v.result || undefined,
    status: v.status,
  }))
}

function failureEvents(problems: ParsedKnownProblem[]): CheckpointEvent[] {
  return problems.map((p, i) => ({
    id: `failure:${i}:${p.timestamp ?? "none"}`,
    kind: "failure" as const,
    timestamp: p.timestamp,
    title: p.problem,
    detail: p.unblock || undefined,
    severity: p.severity,
  }))
}

function resumeEvent(checkpoint: ParsedCheckpoint | undefined): CheckpointEvent[] {
  if (!checkpoint?.nextAction) return []
  return [
    {
      id: `resume:0:${checkpoint.lastUpdated ?? "none"}`,
      kind: "resume",
      timestamp: checkpoint.lastUpdated,
      title: checkpoint.nextAction,
      detail: undefined,
    },
  ]
}

/** Merge and sort events newest-first (timestamp desc; undefined kept in order). */
export function sortEvents(events: CheckpointEvent[]): CheckpointEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestamp && b.timestamp) return b.timestamp.localeCompare(a.timestamp)
    if (a.timestamp) return -1
    if (b.timestamp) return 1
    return 0
  })
}

// --- main parser ------------------------------------------------------------

export interface ParseCheckpointTimelineArgs {
  checkpoint?: string
  decisions?: string
  validations?: string
  knownProblems?: string
}

/**
 * Parse raw Cairn checkpoint file contents into a timeline state. The pure
 * parse (no harness context) yields `status: "populated"` when any file is
 * present, or `status: "empty"` when nothing is present. Pass a `ctx` to model
 * loading / degraded / failure states, and `overrides` for width-aware
 * projection and focused-row assertions.
 */
export function parseCheckpointTimeline(
  args: ParseCheckpointTimelineArgs,
  ctx: CheckpointTimelineContext = {},
  overrides: { width?: number } = {},
): CheckpointTimelineState {
  const checkpoint = parseCheckpointMd(args.checkpoint)
  const decisions = parseDecisions(args.decisions)
  const validations = parseValidations(args.validations)
  const problems = parseKnownProblems(args.knownProblems)
  const exists = !!(checkpoint || decisions.length || validations.length || problems.length)

  const rawEvents = sortEvents([
    ...milestoneEvents(checkpoint),
    ...decisionEvents(decisions),
    ...validationEvents(validations),
    ...failureEvents(problems),
    ...resumeEvent(checkpoint),
  ])

  // Redact any secrets from user-visible text before projection.
  let redacted = false
  const events = rawEvents.map((event) => {
    const title = redactText(event.title)
    const detail = event.detail ? redactText(event.detail) : event.detail
    if (title !== event.title || detail !== event.detail) redacted = true
    return { ...event, title, detail }
  })

  const milestoneTotal = checkpoint?.milestones.length ?? 0
  const milestoneDone = checkpoint?.milestones.filter((m) => m.status === "completed").length ?? 0
  const decisionCount = decisions.length
  const failureCount = problems.length
  const resume = checkpoint?.nextAction ? redactText(checkpoint.nextAction) : checkpoint?.nextAction

  let status: CheckpointTimelineStatus
  if (ctx.denied) status = "denied"
  else if (ctx.offline) status = "offline"
  else if (ctx.error) status = "failure"
  else if (ctx.loading && !exists) status = "loading"
  else if (ctx.loading && exists) status = "degraded"
  else if (!exists) status = "empty"
  else if (events.length > CHECKPOINT_TIMELINE_MAX_EVENTS) status = "long-content"
  else status = "populated"

  const stale = status === "degraded"
  const visible = events.length > CHECKPOINT_TIMELINE_MAX_EVENTS
    ? events.slice(0, CHECKPOINT_TIMELINE_MAX_EVENTS)
    : events
  const truncated = Math.max(0, events.length - visible.length)

  const noColor = detectNoColor()
  const accessibleSummary = buildAccessibleSummary({
    exists,
    milestoneDone,
    milestoneTotal,
    decisionCount,
    failureCount,
    resume,
  })

  const statusText = statusBanner(status, ctx.error)

  return {
    exists,
    goal: redactText(checkpoint?.goal ?? ""),
    mode: checkpoint?.mode ?? "build",
    currentMilestone: checkpoint?.currentMilestone,
    nextAction: checkpoint?.nextAction,
    blockers: checkpoint?.blockers ?? [],
    lastUpdated: checkpoint?.lastUpdated,
    events,
    status,
    milestoneDone,
    milestoneTotal,
    decisionCount,
    failureCount,
    resume,
    focusIndex: -1,
    stale,
    summaryText: renderIndicatorText(
      { milestoneDone, milestoneTotal, decisionCount, failureCount, resume, exists },
      overrides.width ?? WIDE_WIDTH,
      noColor,
    ),
    statusText,
    visible,
    truncated,
    redacted,
    accessibleSummary,
  }
}

function buildAccessibleSummary(args: {
  exists: boolean
  milestoneDone: number
  milestoneTotal: number
  decisionCount: number
  failureCount: number
  resume: string | undefined
}): string {
  if (!args.exists) return "No checkpoint yet for this session"
  const parts = [`${args.milestoneDone} of ${args.milestoneTotal} milestones complete`]
  if (args.decisionCount > 0) parts.push(`${args.decisionCount} decisions`)
  if (args.failureCount > 0) parts.push(`${args.failureCount} failure${args.failureCount === 1 ? "" : "s"}`)
  if (args.resume) parts.push(`resume: ${args.resume}`)
  return parts.join(", ")
}

// --- indicator rendering ----------------------------------------------------

export interface IndicatorCounts {
  milestoneDone: number
  milestoneTotal: number
  decisionCount: number
  failureCount: number
  resume: string | undefined
  exists: boolean
}

/**
 * Compact status line for the sidebar footer. Width tiers:
 *  - < MINIMAL_WIDTH: indicator counts only (no prose)
 *  - < STANDARD_WIDTH: drop the resume prose
 *  - >= STANDARD_WIDTH: full line with truncated resume point
 * When there is no checkpoint, renders `· no checkpoint` (never a "clean" badge).
 */
export function renderIndicatorText(
  counts: IndicatorCounts,
  width: number = WIDE_WIDTH,
  noColor: boolean = false,
): string {
  if (!counts.exists) return "· no checkpoint"
  const segments: string[] = []
  const check = noColor ? "[x]" : "✓"
  const resumeGlyph = noColor ? "resume" : "↩"
  segments.push(`${check} ${counts.milestoneDone}/${counts.milestoneTotal}`)
  if (counts.decisionCount > 0) segments.push(`${counts.decisionCount} decisions`)
  if (counts.failureCount > 0) segments.push(`${counts.failureCount} failure${counts.failureCount === 1 ? "" : "s"}`)
  if (counts.resume && width >= STANDARD_WIDTH) {
    const resume = counts.resume.length > 32 ? redactText(counts.resume).slice(0, 31) + "…" : redactText(counts.resume)
    segments.push(`${resumeGlyph} resume: ${resume}`)
  }
  if (width < MINIMAL_WIDTH) {
    return segments[0]
  }
  return segments.join(" · ")
}

// --- event row rendering (width-aware) --------------------------------------

/**
 * Render one timeline event as a single text line, degrading right-to-left:
 * drop detail → time → kind label, keeping glyph + summary last.
 */
export function formatEventLine(
  event: CheckpointEvent,
  width: number,
  opts: { now?: number; noColor?: boolean } = {},
): string {
  const glyph = glyphFor(event, opts.noColor)
  const summary = event.title
  if (width < MINIMAL_WIDTH) {
    return `${glyph} ${summary}`.slice(0, Math.max(1, width))
  }
  if (width < STANDARD_WIDTH) {
    return `${glyph} ${summary}`
  }
  const kindLabel = event.kind
  const time = event.timestamp ? formatTime(event.timestamp, opts.now) : ""
  const detail = event.detail ? ` → ${truncate(redactText(event.detail).replace(/\s+/g, " ").trim(), 40)}` : ""
  if (width >= WIDE_WIDTH) {
    return `${glyph} ${time} ${kindLabel} ${summary}${detail}`.trim()
  }
  return `${glyph} ${time} ${kindLabel} ${summary}`.trim()
}

/** Banner text for the active lifecycle state (redacts diagnostics). */
export function statusBanner(status: CheckpointTimelineStatus, error?: string): string {
  switch (status) {
    case "loading":
      return "↻ loading checkpoint…"
    case "empty":
      return "· no checkpoint yet"
    case "failure":
      return `⚠ checkpoint unavailable — ${redactError(error ?? "unknown error")}`
    case "denied":
      return "⊘ checkpoint access denied"
    case "offline":
      return "≈ checkpoint offline — showing last known"
    case "degraded":
      return "≈ checkpoint stale — showing last known"
    case "long-content":
      return "▤ checkpoint — large history, showing recent"
    case "populated":
      return "▮ checkpoint"
  }
}

/** Compact HH:MM (wide) or relative "12m ago" (standard) timestamp. */
export function formatTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diffMs = now - t
  if (diffMs < 0) return ""
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}

// --- focus navigation & keyboard --------------------------------------------

/** Move focus between events, clamping at the ends (no wrap). */
export function moveFocus(state: CheckpointTimelineState, direction: 1 | -1): number {
  const count = state.events.length
  if (count === 0) return -1
  if (state.focusIndex < 0) return direction === 1 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, state.focusIndex + direction))
}

/** Index of the first event of a kind, or -1 when absent. */
export function focusIndexForKind(state: CheckpointTimelineState, kind: CheckpointEventKind): number {
  return state.events.findIndex((e) => e.kind === kind)
}

/** Cycle the type filter: all → milestones → decisions → validations → failures → resume → all. */
export function nextFilter(current: CheckpointEventKind | "all"): CheckpointEventKind | "all" {
  const order: (CheckpointEventKind | "all")[] = [
    "all",
    "milestone",
    "decision",
    "validation",
    "failure",
    "resume",
  ]
  const idx = order.indexOf(current)
  return order[(idx + 1) % order.length]
}

/** Apply a type filter, keeping event order. */
export function filterEvents(state: CheckpointTimelineState, filter: CheckpointEventKind | "all"): CheckpointEvent[] {
  if (filter === "all") return state.events
  return state.events.filter((e) => e.kind === filter)
}

/** Toggle expand/collapse of the focused row's detail. */
export function toggleExpanded(expanded: Set<string>, id: string): Set<string> {
  const next = new Set(expanded)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// --- streaming merge --------------------------------------------------------

/**
 * Merge a previously parsed timeline with freshly appended raw files. Used when
 * the cairn files grow while the dialog is open. The merge re-parses both the
 * previous and incoming raw contents, deduplicates by stable event id, and
 * re-sorts newest-first so streaming updates never duplicate or reorder rows.
 */
export function mergeCheckpointTimeline(
  prevRaw: ParseCheckpointTimelineArgs,
  nextRaw: ParseCheckpointTimelineArgs,
  ctx: CheckpointTimelineContext = {},
): CheckpointTimelineState {
  const prev = parseCheckpointTimeline(prevRaw)
  const next = parseCheckpointTimeline(nextRaw, ctx)
  const seen = new Set(next.events.map((e) => e.id))
  const merged = [...next.events]
  for (const e of prev.events) {
    if (!seen.has(e.id)) merged.push(e)
  }
  const state = parseCheckpointTimeline(nextRaw, ctx)
  return {
    ...state,
    events: sortEvents(merged),
    status: next.status,
    stale: !!ctx.loading && next.status === "populated",
  }
}
