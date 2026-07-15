/**
 * Build & validation panel domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, or SDK
 * dependencies so the panel logic can be unit tested in isolation and reused
 * by the Solid component in `./index.tsx`. Every transition is pure: it takes
 * inputs and returns new values, which keeps the data flow deterministic and
 * snapshot-free in tests.
 *
 * The panel projects the status of five validation checks — lint, typecheck,
 * build, smoke and release-gate — into a single ordered list with a derived
 * release-gate summary. It mirrors the conventions of the `task-queue` and
 * (in-progress) `test-results` components: a `buildState` entry point, a
 * derived `status`, visible/filtered selection, and a context object that
 * lifts harness concerns (offline, permission, loading, partial, error) above
 * the raw check list so the same model serves both live and offline states.
 */

import stripAnsi from "strip-ansi"

/** The five validation checks surfaced by the panel, in display order. */
export type CheckKind = "lint" | "typecheck" | "build" | "smoke" | "release-gate"

export type CheckStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "skipped"

/**
 * Static metadata for each check. The harness supplies only a sparse
 * `CheckInput` (id + status + optional extras); the panel fills label,
 * description, default command and the release-blocking flag from here so the
 * display stays consistent and the metadata table is the single source of
 * truth for what "the build and validation panel" actually shows.
 */
export interface CheckMeta {
  readonly id: CheckKind
  readonly label: string
  /** One-line description shown in the expanded detail row. */
  readonly description: string
  /** Default command the harness runs for this check. */
  readonly command: string
  /** Release is blocked while a required check is not passing. */
  readonly required: boolean
}

export const BUILD_CHECKS: ReadonlyArray<CheckMeta> = [
  { id: "lint", label: "Lint", description: "Style and lint rules", command: "bun run lint", required: true },
  { id: "typecheck", label: "Typecheck", description: "Static type checking", command: "bun run typecheck", required: true },
  { id: "build", label: "Build", description: "Production build", command: "bun run build", required: true },
  { id: "smoke", label: "Smoke", description: "Smoke / integration checks", command: "bun run test:smoke", required: false },
  { id: "release-gate", label: "Release gate", description: "Release readiness gate", command: "bun run release:gate", required: true },
]

const CHECK_ORDER: ReadonlyArray<CheckKind> = BUILD_CHECKS.map((c) => c.id)

function metaFor(id: CheckKind): CheckMeta {
  const meta = BUILD_CHECKS.find((c) => c.id === id)
  if (!meta) throw new Error(`Unknown check kind: ${id}`)
  return meta
}

/** Sparse update the harness streams; label/required/command come from metadata. */
export interface CheckInput {
  readonly id: CheckKind
  readonly status: CheckStatus
  readonly durationMs?: number
  /** Failure reason, if the check failed. Redacted on normalize. */
  readonly error?: string
  /** Short metric lines, e.g. "2 errors", "5 warnings". */
  readonly details?: ReadonlyArray<string>
  /** Override the default command (e.g. a package-scoped invocation). */
  readonly command?: string
  /** User has permission to run this check. Defaults to true. */
  readonly permitted?: boolean
}

export interface ValidationCheck {
  readonly id: CheckKind
  readonly label: string
  readonly description: string
  readonly status: CheckStatus
  readonly durationMs?: number
  /** Redacted failure reason, if the check failed. */
  readonly error?: string
  /** Short metric lines. */
  readonly details: ReadonlyArray<string>
  readonly command: string
  readonly required: boolean
  readonly permitted: boolean
}

export type CheckFilter = "all" | "failed" | "passed" | "running" | "skipped"

export type ReleaseGateStatus = "ready" | "warning" | "blocked" | "unknown"

/** Whole-panel lifecycle derived from context + checks. */
export type PanelStatus =
  | "offline"
  | "denied"
  | "failure"
  | "loading"
  | "empty"
  | "degraded"
  | "long-content"
  | "populated"

/** Harness-level concerns lifted above the raw check list. */
export interface BuildValidationContext {
  readonly connected: boolean
  readonly permitted: boolean
  /** A validation run is currently executing. */
  readonly running: boolean
  /** Initial discovery / first load is in flight. */
  readonly loading: boolean
  /** The run finished but some checks could not be collected or executed. */
  readonly partial: boolean
  /** Harness-level error (crash, discovery error). Redacted on render. */
  readonly error?: string
}

export interface BuildValidationState {
  readonly checks: Record<string, ValidationCheck>
  readonly order: ReadonlyArray<CheckKind>
  readonly byId: Record<string, ValidationCheck>
  readonly selectedId: string | null
  readonly filter: CheckFilter
  readonly showAll: boolean
  readonly renderBudget: number
  readonly narrowWidth: number
  readonly status: PanelStatus
  readonly context: BuildValidationContext
}

export const RENDER_BUDGET_DEFAULT = 5
export const NARROW_WIDTH_DEFAULT = 60
export const ERROR_MAX = 240

// --- input normalization ----------------------------------------------------

function redactSecrets(text: string): string {
  if (!text) return text
  const masked = text
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ••••")
    .replace(/\b(token|secret)-[A-Za-z0-9_-]{6,}/gi, "$1-••••")
    .replace(/(sk|pk|api[_-]?key|token|secret|password|bearer)\s*[=:]\s*\S+/gi, (m) =>
      /=\s*$/.test(m) || /:\s*$/.test(m) ? m : m.replace(/\S+$/, "••••"),
    )
    .replace(/(Bearer|sk|pk)-[A-Za-z0-9_-]{8,}/g, (m) => `${m.slice(0, 6)}••••`)
  return masked
}

function truncateError(text: string): string {
  const cleaned = stripAnsi(text ?? "").replace(/\t/g, "  ").trim()
  if (cleaned.length <= ERROR_MAX) return cleaned
  return cleaned.slice(0, ERROR_MAX - 1) + "…"
}

/** Merge a sparse harness input with static metadata and redact the error. */
export function normalizeCheck(input: CheckInput): ValidationCheck {
  const meta = metaFor(input.id)
  return {
    id: meta.id,
    label: meta.label,
    description: meta.description,
    status: input.status,
    durationMs: input.durationMs,
    error: input.error ? redactSecrets(truncateError(input.error)) : undefined,
    details: input.details ?? [],
    command: input.command ?? meta.command,
    required: meta.required,
    permitted: input.permitted ?? true,
  }
}

// --- raw output parsing -----------------------------------------------------

const ERROR_RE = /\b(\d+)\s*(?:error|errors|err)\b/i
const WARNING_RE = /\b(\d+)\s*(?:warning|warnings|warn)\b/i

/**
 * Best-effort projection of raw check output into a status + metric lines.
 * Total and used by the harness when it only has command stdout/stderr and
 * not a structured result. Detection is forgiving: anything that looks like a
 * failure (non-zero exit markers, stack traces, "error" counts) fails the
 * check; otherwise it passes. The function is total — empty output yields a
 * neutral `queued` check the caller can overwrite once the real status lands.
 */
export function parseCheckOutput(
  kind: CheckKind,
  output: string,
): { status: CheckStatus; details: string[]; error?: string } {
  const lines = stripAnsi(output ?? "").split("\n").map((l) => l.trim())
  const nonEmpty = lines.filter(Boolean)
  if (nonEmpty.length === 0) return { status: "queued", details: [] }

  const text = nonEmpty.join("\n")
  const looksFailed = /\b(error|err|failed|failure|exception|traceback|fatal|panic|cannot find|does not exist)\b/i.test(text)
  const status: CheckStatus = looksFailed ? "failed" : "passed"

  const details: string[] = []
  const errors = ERROR_RE.exec(text)
  if (errors) details.push(`${errors[1]} error${errors[1] === "1" ? "" : "s"}`)
  const warnings = WARNING_RE.exec(text)
  if (warnings) details.push(`${warnings[1]} warning${warnings[1] === "1" ? "" : "s"}`)

  const error = status === "failed" ? nonEmpty[nonEmpty.length - 1] : undefined
  return { status, details, error }
}

// --- state construction -----------------------------------------------------

export function deriveStatus(
  ctx: BuildValidationContext,
  checks: ReadonlyArray<ValidationCheck>,
  renderBudget: number,
  showAll: boolean,
): PanelStatus {
  if (!ctx.connected) return "offline"
  if (!ctx.permitted) return "denied"
  if (ctx.error) return "failure"
  if (ctx.loading || (ctx.running && checks.length === 0)) return "loading"
  if (checks.length === 0) return "empty"
  if (ctx.partial) return "degraded"
  if (checks.length > renderBudget && !showAll) return "long-content"
  return "populated"
}

export interface BuildValidationOverrides {
  readonly selectedId?: string | null
  readonly filter?: CheckFilter
  readonly showAll?: boolean
  readonly renderBudget?: number
  readonly narrowWidth?: number
}

export function buildState(
  checks: ReadonlyArray<CheckInput> | undefined,
  ctx: BuildValidationContext,
  overrides: BuildValidationOverrides = {},
): BuildValidationState {
  const list = (checks ?? []).map(normalizeCheck)
  const byId: Record<string, ValidationCheck> = {}
  for (const check of list) byId[check.id] = check

  // Preserve BUILD_CHECKS display order; surface unknown checks at the end.
  const known = CHECK_ORDER.filter((id) => byId[id])
  const extra = list.filter((c) => !CHECK_ORDER.includes(c.id)).map((c) => c.id)
  const order = [...known, ...extra]

  const renderBudget = overrides.renderBudget ?? RENDER_BUDGET_DEFAULT
  const narrowWidth = overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT
  const showAll = overrides.showAll ?? false
  const filter = overrides.filter ?? "all"
  const selectedId = overrides.selectedId ?? null

  const status = deriveStatus(ctx, list, renderBudget, showAll)
  return {
    checks: byId,
    order,
    byId,
    selectedId,
    filter,
    showAll,
    renderBudget,
    narrowWidth,
    status,
    context: ctx,
  }
}

// --- selection / filtering --------------------------------------------------

function matchesFilter(check: ValidationCheck, filter: CheckFilter): boolean {
  if (filter === "all") return true
  return check.status === filter
}

export function filterChecks(order: ReadonlyArray<CheckKind>, byId: Record<string, ValidationCheck>, filter: CheckFilter): CheckKind[] {
  return order.filter((id) => byId[id] && matchesFilter(byId[id], filter))
}

export function visibleCheckIds(state: BuildValidationState): CheckKind[] {
  const filtered = filterChecks(state.order, state.byId, state.filter)
  if (state.showAll) return filtered
  return filtered.slice(0, state.renderBudget)
}

export function hiddenCheckCount(state: BuildValidationState): number {
  const filtered = filterChecks(state.order, state.byId, state.filter)
  if (state.showAll) return 0
  return Math.max(0, filtered.length - state.renderBudget)
}

export function effectiveSelection(state: BuildValidationState): string | null {
  const ids = visibleCheckIds(state)
  if (ids.length === 0) return null
  if (state.selectedId && ids.includes(state.selectedId as CheckKind)) return state.selectedId
  return ids[0]
}

export function moveSelection(state: BuildValidationState, direction: 1 | -1): string | null {
  const ids = visibleCheckIds(state)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current as CheckKind) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

export const FILTER_CYCLE: CheckFilter[] = ["all", "failed", "passed", "running", "skipped"]

export function nextFilter(mode: CheckFilter): CheckFilter {
  return FILTER_CYCLE[(FILTER_CYCLE.indexOf(mode) + 1) % FILTER_CYCLE.length]
}

// --- release gate -----------------------------------------------------------

export interface ReleaseGate {
  readonly status: ReleaseGateStatus
  readonly label: string
  readonly detail: string
}

/**
 * Aggregate release readiness. A required check that is failed, skipped or
 * still queued/running blocks the release; a non-required check failing only
 * warns. An all-pass board is ready. This is the single number the panel's
 * header banner renders and the keyboard `g` shortcut jumps to.
 */
export function releaseGate(state: BuildValidationState): ReleaseGate {
  const checks = state.order.map((id) => state.byId[id]).filter(Boolean)
  if (checks.length === 0) return { status: "unknown", label: "release gate", detail: "no checks" }

  const required = checks.filter((c) => c.required)
  const requiredFailed = required.filter((c) => c.status === "failed" || c.status === "skipped")
  const requiredPending = required.filter((c) => c.status === "queued" || c.status === "running")
  const optionalFailed = checks.filter((c) => !c.required && c.status === "failed")

  if (requiredFailed.length > 0) {
    return {
      status: "blocked",
      label: "release blocked",
      detail: `${requiredFailed.length} required check${requiredFailed.length === 1 ? "" : "s"} failing`,
    }
  }
  if (requiredPending.length > 0) {
    return {
      status: "warning",
      label: "release pending",
      detail: `${requiredPending.length} required check${requiredPending.length === 1 ? "" : "s"} in progress`,
    }
  }
  if (optionalFailed.length > 0) {
    return {
      status: "warning",
      label: "release ready (warnings)",
      detail: `${optionalFailed.length} optional check${optionalFailed.length === 1 ? "" : "s"} failing`,
    }
  }
  return { status: "ready", label: "release ready", detail: `${checks.length} checks passing` }
}

// --- presentation helpers ---------------------------------------------------

export function checkStatusGlyph(status: CheckStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "passed": return "✓"
      case "failed": return "✗"
      case "skipped": return "↓"
      case "running": return "▶"
      case "queued": return "•"
    }
  }
  switch (status) {
    case "passed": return "P"
    case "failed": return "X"
    case "skipped": return "S"
    case "running": return "R"
    case "queued": return "Q"
  }
}

export function checkStatusLabel(status: CheckStatus): string {
  return status
}

export function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${seconds}s`
}

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

export function supportsColor(level: number | undefined): boolean {
  return (level ?? 3) > 0
}

export function redactFailure(text: string): string {
  return redactSecrets(truncateError(text))
}

/** Header summary line, mirroring test-results `testSummary` phrasing. */
export function summary(state: BuildValidationState): string {
  const ctx = state.context
  if (state.status === "loading") return "Validating…"
  if (state.status === "offline") return "Build & validation unavailable — offline"
  if (state.status === "denied") return "Build & validation hidden — insufficient permission"
  if (state.status === "failure") return `Build & validation failed: ${redactFailure(ctx.error ?? "unknown error")}`
  if (state.status === "empty") return "No validation checks"

  const checks = state.order.map((id) => state.byId[id]).filter(Boolean)
  const passed = checks.filter((c) => c.status === "passed").length
  const failed = checks.filter((c) => c.status === "failed").length
  const running = checks.filter((c) => c.status === "running" || c.status === "queued").length
  const skipped = checks.filter((c) => c.status === "skipped").length

  const parts: string[] = [`${passed} passed`]
  if (failed > 0) parts.push(`${failed} failed`)
  if (running > 0) parts.push(`${running} running`)
  if (skipped > 0) parts.push(`${skipped} skipped`)
  return `Build & validation — ${parts.join(" · ")}`
}
