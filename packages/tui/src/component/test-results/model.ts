/**
 * Test results domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, or SDK
 * dependencies so the test-results logic can be unit tested in isolation and
 * reused by the Solid component in `./index.tsx`. Every transition is pure:
 * it takes inputs and returns new values, which keeps the data flow
 * deterministic and snapshot-free in tests.
 *
 * The model is the single source of truth for the redesigned Test results pane
 * and provides two cooperating layers:
 *
 *  1. A parser layer (`parseTestOutput`) that projects the raw output of a
 *     `bash` test invocation (`packages/ottili-coder/src/tool/shell.ts`) into a
 *     suite hierarchy, derives run-level summaries, and builds the rerun
 *     command. Today test runs are opaque `bash` output (see
 *     `packages/tui/src/routes/session/index.tsx`, the `Shell` renderer); this
 *     layer makes that output queryable.
 *
 *  2. A hardening layer (this task, T-CLI-0138) that renders the pane across
 *     all eight required lifecycle states (loading, empty, populated,
 *     long-content, failure, denied, offline, degraded) and supplies the
 *     building blocks for accessibility (live-region summary, status labels
 *     that do not rely on color alone), terminal fallbacks (narrow-width
 *     truncation, color-level aware glyphs) and render-budget performance
 *     safeguards (cap on rendered rows, bounded error text, secret redaction).
 */

import stripAnsi from "strip-ansi"
import {
  colorSupport,
  isNarrow,
  NARROW_WIDTH_DEFAULT as AGENT_NARROW_WIDTH,
  redactSensitive,
  truncate,
} from "../agent-roster/model"

// ===========================================================================
// Layer 1 — parser: raw output → suite hierarchy
// ===========================================================================

export type TestStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "todo"

/** Top-level lifecycle of a whole test run. */
export type TestRunStatus = "queued" | "running" | "passed" | "failed"

export type TestRunner = "bun" | "vitest" | "jest" | "pytest" | "unknown"

export interface TestCase {
  readonly id: string
  readonly kind: "case"
  readonly name: string
  readonly status: TestStatus
  readonly durationMs?: number
  /** One-line failure reason, if the case failed (already redacted). */
  readonly error?: string
  /** Trailing log lines associated with the case (stack, stdout). */
  readonly logs: ReadonlyArray<string>
}

export interface TestSuite {
  readonly id: string
  readonly kind: "suite"
  readonly name: string
  readonly status: TestStatus
  readonly children: ReadonlyArray<TestNode>
}

export type TestNode = TestSuite | TestCase

export interface TestRun {
  readonly id: string
  /** The original `bash` command that produced this output. */
  readonly command: string
  readonly runner: TestRunner
  readonly status: TestRunStatus
  /** Synthetic root node holding every detected suite/case. */
  readonly root: TestSuite
  readonly startedAt?: number
  readonly finishedAt?: number
}

export interface TestRunSummary {
  total: number
  passed: number
  failed: number
  skipped: number
  todo: number
  queued: number
  running: number
}

export type TestNodeFilter = "all" | "failed" | "passed" | "skipped"

export interface RerunRequest {
  readonly command: string
  /** Human-readable scope, e.g. a file or "failed only". */
  readonly scope?: string
}

// --- parsing helpers --------------------------------------------------------

const DURATION_RE = /\((\d+(?:\.\d+)?)\s*(ms|s|m)?\)/

function parseDuration(text: string | undefined): number | undefined {
  if (!text) return undefined
  const match = DURATION_RE.exec(text)
  if (!match) return undefined
  const value = Number.parseFloat(match[1])
  const unit = match[2]
  if (unit === "s") return Math.round(value * 1000)
  if (unit === "m") return Math.round(value * 60 * 1000)
  return Math.round(value)
}

/** Best-effort runner detection from the command and/or output. */
export function detectRunner(command: string, output = ""): TestRunner {
  const cmd = command.toLowerCase()
  if (cmd.includes("pytest") || cmd.includes("python -m pytest")) return "pytest"
  if (cmd.includes("vitest")) return "vitest"
  if (cmd.includes("jest")) return "jest"
  if (cmd.includes("bun test") || (cmd.startsWith("bun") && cmd.includes("test"))) return "bun"
  if (/^\s*#\s*tests?\s/.test(output)) return "pytest"
  if (/(Test Files|✓|✗|×|✔)/.test(output)) return "bun"
  if (/^(PASSED|FAILED|SKIPPED|XFAIL|XPASS)\b/m.test(output)) return "pytest"
  return "unknown"
}

function clean(line: string): string {
  return stripAnsi(line ?? "").replace(/\t/g, "  ").trimEnd()
}

/** Classify a single reporter line into a test status, or null if not a case. */
export function classifyCaseLine(
  line: string,
): { status: TestStatus; name: string; durationMs?: number } | null {
  const text = clean(line)
  if (!text) return null

  // bun / vitest / jest markers
  const jsMarker = /^[›\s]*[✓✔√.]+\s+(.+?)(?:\s+\((\d+(?:\.\d+)?\s*(?:ms|s|m)?)\))?\s*$/
  const jsFail = /^[›\s]*[✗×✘]\s+(.+?)(?:\s+\((\d+(?:\.\d+)?\s*(?:ms|s|m)?)\))?\s*$/
  const jsSkip = /^[›\s]*[↓∅~]\s+(.+?)(?:\s+\(skipped\))?\s*$/
  const jsTodo = /^[›\s]*[◌◯]\s+(.+?)\s*$/

  let m = jsFail.exec(text)
  if (m) return { status: "failed", name: m[1].trim(), durationMs: parseDuration(m[2]) }
  m = jsSkip.exec(text)
  if (m) return { status: "skipped", name: m[1].trim() }
  m = jsTodo.exec(text)
  if (m) return { status: "todo", name: m[1].trim() }
  m = jsMarker.exec(text)
  if (m) return { status: "passed", name: m[1].trim(), durationMs: parseDuration(m[2]) }

  // pytest: "path::Class::test_name PASSED"
  const py = /^(.+?)\s+(PASSED|FAILED|SKIPPED|XFAIL|XPASS)\s*$/.exec(text)
  if (py) {
    const status: TestStatus =
      py[2] === "FAILED" ? "failed"
        : py[2] === "SKIPPED" ? "skipped"
          : py[2] === "XFAIL" || py[2] === "XPASS" ? "skipped"
            : "passed"
    return { status, name: py[1].trim() }
  }
  return null
}

/** Split a test id into [file, ...suites, caseName]. */
export function splitPath(id: string): string[] {
  if (id.includes("::")) return id.split("::").map((s) => s.trim()).filter(Boolean)
  if (id.includes(" > ")) return id.split(" > ").map((s) => s.trim()).filter(Boolean)
  if (id.includes(" › ")) return id.split(" › ").map((s) => s.trim()).filter(Boolean)
  return [id.trim()]
}

function deriveSuiteStatus(children: ReadonlyArray<TestNode>): TestStatus {
  if (children.some((c) => c.status === "failed")) return "failed"
  if (children.some((c) => c.status === "running")) return "running"
  if (children.some((c) => c.status === "queued")) return "queued"
  if (children.some((c) => c.status === "skipped")) return "skipped"
  if (children.some((c) => c.status === "todo")) return "todo"
  return "passed"
}

function caseFrom(name: string, status: TestStatus, durationMs?: number, error?: string): TestCase {
  return { id: `case:${name}`, kind: "case", name, status, durationMs, error, logs: [] }
}

/**
 * Parse raw test-runner output into a suite hierarchy.
 *
 * Detection is forgiving: bun/vitest/jest and pytest are parsed into
 * file → suite → case trees where the id is informative; unknown runners
 * collapse to a single synthetic suite whose cases are the per-line
 * classified output (failed if the line looks like an error, else passed).
 * The function is total — malformed input yields an empty-but-valid run.
 */
export function parseTestOutput(opts: { command: string; output: string; id?: string }): TestRun {
  const command = opts.command ?? ""
  const lines = opts.output.split("\n").map(clean)
  const runner = detectRunner(command, opts.output)
  let failed = 0
  let children: TestNode[]

  if (runner === "unknown") {
    const cases = lines
      .filter(Boolean)
      .map((line): TestCase => {
        const isErr = /\b(error|err|failed|failure|exception|traceback|fatal|panic)\b/i.test(line)
        const status: TestStatus = isErr ? "failed" : "passed"
        if (isErr) failed++
        return caseFrom(line, status, undefined, isErr ? redactSensitive(line).text : undefined)
      })
    children = cases.length ? [groupSuite("Output", cases)] : []
  } else {
    const fileMap = new Map<string, TestCase[]>()
    const loose: TestCase[] = []

    for (const line of lines) {
      const hit = classifyCaseLine(line)
      if (!hit) continue
      if (hit.status === "failed") failed++
      const parts = splitPath(hit.name)
      const file = parts[0]
      if (parts.length > 1 || runner === "pytest") {
        const list = fileMap.get(file) ?? []
        list.push(caseFrom(hit.name, hit.status, hit.durationMs))
        fileMap.set(file, list)
      } else {
        loose.push(caseFrom(hit.name, hit.status, hit.durationMs))
      }
    }

    const suites: TestNode[] = []
    for (const [file, cases] of fileMap) {
      suites.push(groupSuite(file, cases))
    }
    if (loose.length) suites.push(...loose)
    children = suites
  }

  const root: TestSuite = {
    id: "suite:root",
    kind: "suite",
    name: "All tests",
    status: deriveSuiteStatus(children),
    children,
  }
  return finish(command, runner, root, opts.id, failed)
}

function groupSuite(name: string, cases: TestCase[]): TestSuite {
  return { id: `suite:${name}`, kind: "suite", name, status: deriveSuiteStatus(cases), children: cases }
}

function finish(
  command: string,
  runner: TestRunner,
  root: TestSuite,
  id: string | undefined,
  failed: number,
): TestRun {
  const status: TestRunStatus = root.children.length === 0 ? "queued" : failed > 0 ? "failed" : "passed"
  return { id: id ?? `run:${command}`, command, runner, status, root }
}

/** Flatten every case in a run into a single list. */
export function flattenCases(run: TestRun): TestCase[] {
  const out: TestCase[] = []
  const walk = (nodes: ReadonlyArray<TestNode>) => {
    for (const node of nodes) {
      if (node.kind === "case") out.push(node)
      else walk(node.children)
    }
  }
  walk(run.root.children)
  return out
}

export function countByStatus(run: TestRun): TestRunSummary {
  const summary: TestRunSummary = {
    total: 0, passed: 0, failed: 0, skipped: 0, todo: 0, queued: 0, running: 0,
  }
  for (const node of flattenCases(run)) {
    summary.total++
    summary[node.status]++
  }
  return summary
}

/** Derive the run lifecycle from whether any case failed. */
export function deriveRunStatus(run: TestRun): TestRunStatus {
  return countByStatus(run).failed > 0 ? "failed" : "passed"
}

/** Color/mono-aware glyph for a parsed test status. */
export function statusGlyph(status: TestStatus, useColor: boolean): string {
  if (useColor) {
    switch (status) {
      case "passed": return "✓"
      case "failed": return "✗"
      case "skipped": return "↓"
      case "todo": return "◌"
      case "running": return "▶"
      case "queued": return "•"
    }
  }
  switch (status) {
    case "passed": return "[pass]"
    case "failed": return "[fail]"
    case "skipped": return "[skip]"
    case "todo": return "[todo]"
    case "running": return "[run]"
    case "queued": return "[queued]"
  }
}

export function statusLabel(status: TestStatus): string {
  return status
}

/**
 * Build the command to rerun the whole run, or only its failed cases when
 * `onlyFailed` is set. For pytest we append the failed node ids; for
 * bun/vitest/jest we append a path filter when a single file failed. The
 * original command is preserved verbatim as a fallback for unknown runners.
 */
export function buildRerun(run: TestRun, opts: { onlyFailed?: boolean } = {}): RerunRequest {
  if (!opts.onlyFailed) return { command: run.command }

  const failed = flattenCases(run).filter((c) => c.status === "failed")
  if (failed.length === 0) return { command: run.command, scope: "no failures" }

  if (run.runner === "pytest") {
    const ids = failed.map((c) => c.name).join(" ")
    return { command: `${run.command} ${ids}`, scope: `${failed.length} failed` }
  }
  if (run.runner === "bun" || run.runner === "vitest" || run.runner === "jest") {
    const files = [...new Set(failed.map((c) => splitPath(c.name)[0]))]
    if (files.length === 1) {
      return { command: `${run.command} ${files[0]}`, scope: `${failed.length} failed` }
    }
    return { command: run.command, scope: `${failed.length} failed across ${files.length} files` }
  }
  return { command: run.command, scope: `${failed.length} failed` }
}

// ===========================================================================
// Layer 2 — hardening: 8-state pane model, accessibility, fallbacks, budget
// ===========================================================================

/** Outcome of a single (already-parsed) test case as consumed by the pane. */
export type TestCaseStatus = "passed" | "failed" | "skipped" | "todo"

/**
 * Raw description of a single test case. Kept decoupled from any external
 * schema so the model stays unit testable and can be produced either directly
 * by a caller or via {@link flattenCases}.
 */
export interface TestCaseInput {
  id: string
  name: string
  file?: string
  status: TestCaseStatus
  durationMs?: number
  /** Failure message; may contain secrets and is redacted before display. */
  error?: string
  stdout?: string
}

/** Normalized, redacted, presentable view of a single test case. */
export interface TestCaseView {
  id: string
  name: string
  file: string
  status: TestCaseStatus
  durationMs: number
  /** Redacted + truncated failure message, safe to render and log. */
  error: string
  redacted: boolean
}

/** The eight intentionally-rendered test-results states required by the redesign. */
export type TestResultsStatus =
  | "loading"
  | "offline"
  | "denied"
  | "failure"
  | "empty"
  | "degraded"
  | "long-content"
  | "populated"

/** Environmental context that decides which top-level state the pane is in. */
export interface TestResultsContext {
  connected: boolean
  permitted: boolean
  /** A test run is currently executing (cases may already be streaming in). */
  running: boolean
  /** Initial discovery / first load is in flight. */
  loading: boolean
  /** The run finished but some suites could not be collected or executed. */
  partial: boolean
  /** Harness-level error (build failure, crash, discovery error). */
  error?: string
}

/** Which rows are shown after the result filter is applied. */
export type FilterMode = "all" | "passed" | "failed" | "skipped" | "todo"

/** Derivable, memoizable test-results state consumed by the component. */
export interface TestResultsState {
  tests: TestCaseView[]
  byId: Record<string, TestCaseView>
  status: TestResultsStatus
  context: TestResultsContext
  selectedId: string | null
  filter: FilterMode
  showAll: boolean
  renderBudget: number
  narrowWidth: number
}

export interface TestResultsOverrides {
  selectedId?: string | null
  filter?: FilterMode
  showAll?: boolean
  renderBudget?: number
  narrowWidth?: number
}

/** Aggregate counts over the full test set. */
export interface TestCounts {
  total: number
  passed: number
  failed: number
  skipped: number
  todo: number
  /** Sum of durations across every case, in milliseconds. */
  durationMs: number
  /** True when at least one error was redacted for display. */
  redacted: boolean
}

/** Max rows rendered before the budget cap kicks in (press `e` to expand). */
export const RENDER_BUDGET_DEFAULT = 200

/** Terminal width below which secondary columns are dropped. */
export const NARROW_WIDTH_DEFAULT = AGENT_NARROW_WIDTH

/** Max characters kept from a failure message before it is truncated. */
export const MAX_ERROR_LEN = 240

/** Visible-name width cap used when not in narrow mode. */
export const NAME_WIDTH_DEFAULT = 48

const STATUS_ORDER: TestCaseStatus[] = ["failed", "todo", "skipped", "passed"]

/** Single-character glyph per status; color-aware so no-color terminals differ. */
export function testStatusGlyph(status: TestCaseStatus, useColor: boolean): string {
  if (useColor) {
    return { passed: "✓", failed: "✗", skipped: "⏭", todo: "☐" }[status]
  }
  return { passed: "P", failed: "X", skipped: "S", todo: "T" }[status]
}

/** Human-readable status label; always present so color is never the only cue. */
export function testStatusLabel(status: TestCaseStatus): string {
  return { passed: "passed", failed: "failed", skipped: "skipped", todo: "todo" }[status]
}

/** Format a duration in ms as a compact, terminal-safe string. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

/**
 * Normalize a raw test case into a presentable view. Redacts secrets from the
 * failure message and bounds its length so a huge stack trace can never blow
 * the render budget. Pure and total — never throws on missing fields.
 */
export function normalizeTest(input: TestCaseInput): TestCaseView {
  const red = redactSensitive(input.error ?? "")
  return {
    id: input.id,
    name: input.name ?? "",
    file: input.file ?? "",
    status: input.status,
    durationMs: input.durationMs ?? 0,
    error: truncate(red.text, MAX_ERROR_LEN),
    redacted: red.redacted,
  }
}

/**
 * Normalize a parsed {@link TestCase} (from the parser layer) into a presentable
 * view, preserving redaction and the bounded error.
 */
export function normalizeParsedCase(input: TestCase): TestCaseView {
  const red = redactSensitive(input.error ?? "")
  return {
    id: input.id,
    name: input.name,
    file: splitPath(input.name)[0] ?? "",
    status: input.status === "queued" || input.status === "running" ? "todo" : (input.status as TestCaseStatus),
    durationMs: input.durationMs ?? 0,
    error: truncate(red.text, MAX_ERROR_LEN),
    redacted: red.redacted,
  }
}

/**
 * Classify the pane's top-level state. Blocking/transient states win over
 * presentational ones so the user always sees the most actionable message:
 * offline → denied → failure → loading → empty → degraded → long-content →
 * populated.
 */
export function deriveStatus(
  context: TestResultsContext,
  tests: TestCaseView[],
  renderBudget: number,
  showAll: boolean,
): TestResultsStatus {
  if (!context.connected) return "offline"
  if (!context.permitted) return "denied"
  if (context.error) return "failure"
  if (context.loading || (context.running && tests.length === 0)) return "loading"
  if (tests.length === 0) return "empty"
  if (context.partial) return "degraded"
  if (!showAll && tests.length > renderBudget) return "long-content"
  return "populated"
}

export function buildState(
  inputs: TestCaseInput[],
  context: TestResultsContext,
  overrides: TestResultsOverrides = {},
): TestResultsState {
  const tests = (inputs ?? []).map(normalizeTest)
  const renderBudget = overrides.renderBudget ?? RENDER_BUDGET_DEFAULT
  const showAll = overrides.showAll ?? false
  const status = deriveStatus(context, tests, renderBudget, showAll)
  return {
    tests,
    byId: Object.fromEntries(tests.map((test) => [test.id, test])),
    status,
    context,
    selectedId: overrides.selectedId ?? null,
    filter: overrides.filter ?? "all",
    showAll,
    renderBudget,
    narrowWidth: overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT,
  }
}

/** Aggregate counts over the full test set (ignores the active filter). */
export function testCounts(tests: TestCaseView[]): TestCounts {
  const counts: TestCounts = {
    total: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    durationMs: 0,
    redacted: false,
  }
  for (const test of tests) {
    counts[test.status] += 1
    counts.durationMs += test.durationMs
    if (test.redacted) counts.redacted = true
  }
  return counts
}

/** Apply the active result filter. */
export function filterTests(tests: TestCaseView[], filter: FilterMode): TestCaseView[] {
  if (filter === "all") return tests
  return tests.filter((test) => test.status === filter)
}

/** Visible rows after the filter and the render-budget cap are applied. */
export function visibleTests(state: TestResultsState): TestCaseView[] {
  const filtered = filterTests(state.tests, state.filter)
  if (state.showAll) return filtered
  return filtered.slice(0, state.renderBudget)
}

/** Count of rows hidden by the render budget (0 when expanded). */
export function hiddenTestCount(state: TestResultsState): number {
  const filtered = filterTests(state.tests, state.filter)
  return state.showAll ? 0 : Math.max(0, filtered.length - state.renderBudget)
}

/** Order used when no explicit ordering is supplied: failures first, then todo, skipped, passed. */
export function sortBySeverity(tests: TestCaseView[]): TestCaseView[] {
  return [...tests].sort((a, b) => {
    const diff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name)
  })
}

/**
 * Selection that stays valid across streaming updates and filtering. If the
 * stored selection is no longer visible, it falls back to the first visible
 * row. This keeps focus from being lost or trapped as results arrive.
 */
export function effectiveSelection(state: TestResultsState): string | null {
  const ids = visibleTests(state).map((test) => test.id)
  if (ids.length === 0) return null
  if (state.selectedId && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

/** Move the selection by `direction` (-1 up, 1 down), clamped to visible rows. */
export function moveSelection(state: TestResultsState, direction: 1 | -1): string | null {
  const ids = visibleTests(state).map((test) => test.id)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

/** Cycle the result filter: all → failed → passed → skipped → todo → all. */
export function nextFilter(filter: FilterMode): FilterMode {
  const order: FilterMode[] = ["all", "failed", "passed", "skipped", "todo"]
  return order[(order.indexOf(filter) + 1) % order.length]!
}

/** A terminal is "narrow" when secondary columns must be dropped. */
export function isNarrowTerminal(width: number, threshold = NARROW_WIDTH_DEFAULT): boolean {
  return isNarrow(width, threshold)
}

/** Truncate a single value to fit a narrow terminal without dropping its meaning. */
export function fitWidth(value: string, max: number): string {
  return truncate(value, max)
}

/** Single-line summary used as the accessible live-region label and header. */
export function testSummary(state: TestResultsState): string {
  const c = testCounts(state.tests)
  switch (state.status) {
    case "loading":
      return `Test results: loading — ${c.total} collected so far`
    case "offline":
      return "Test results: unavailable — offline"
    case "denied":
      return "Test results: hidden — insufficient permission to run tests"
    case "failure":
      return `Test results: run failed — ${redactSensitive(state.context.error ?? "unknown error").text}`
    case "empty":
      return "Test results: no tests found"
    case "degraded":
      return `Test results: partial — ${c.passed} passed, ${c.failed} failed (${c.total} total)`
    case "long-content":
      return `Test results: ${c.total} tests — ${c.passed} passed, ${c.failed} failed (showing ${Math.min(state.renderBudget, c.total)})`
    case "populated":
      return `Test results: ${c.total} tests — ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped`
  }
}

/** Redact secrets from a failure message so it can be shown safely. */
export function redactFailure(message: string): string {
  return redactSensitive(message).text
}

/** Whether the active color level supports color output at all. */
export function supportsColor(colorLevel?: number): boolean {
  return colorSupport(colorLevel).useColor
}
