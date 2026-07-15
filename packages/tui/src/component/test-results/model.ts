/**
 * Test results domain model for the Ottili Coder TUI.
 *
 * This module is intentionally free of any rendering, Solid, or SDK
 * dependencies so the test-results logic can be unit tested in isolation and
 * reused by the Solid component in `./index.tsx` (a follow-up implementation
 * task). Every transition is pure: it takes inputs and returns new values,
 * which keeps the data flow deterministic and snapshot-free in tests.
 *
 * The model is the single source of truth for the redesigned Test results
 * view: it projects the raw output of a `bash` test invocation
 * (`packages/ottili-coder/src/tool/shell.ts`) into a suite hierarchy with
 * queued/running/passed/failed/skipped/todo states, derives run-level
 * summaries, and builds the rerun command. Today test runs are opaque
 * `bash` output (see `packages/tui/src/routes/session/index.tsx:2102`, the
 * `Shell` renderer); this model makes that output queryable.
 */

import stripAnsi from "strip-ansi"

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
  /** One-line failure reason, if the case failed. */
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
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly todo: number
  readonly queued: number
  readonly running: number
}

export type TestNodeFilter = "all" | "failed" | "passed" | "skipped"

export interface TestResultsState {
  readonly run: TestRun
  readonly selectedId: string | null
  readonly filter: TestNodeFilter
  readonly expandedIds: ReadonlyArray<string>
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
  if (cmd.includes("bun test") || cmd.startsWith("bun") && cmd.includes("test")) return "bun"
  if (/^\s*#\s*tests?\s/.test(output)) return "pytest"
  if (/(Test Files|✓|✗|×|✔)/.test(output)) return "bun"
  if (/^(PASSED|FAILED|SKIPPED|XFAIL|XPASS)\b/m.test(output)) return "pytest"
  return "unknown"
}

function clean(line: string): string {
  return stripAnsi(line ?? "").replace(/\t/g, "  ").trimEnd()
}

/** Classify a single reporter line into a test status, or null if not a case. */
export function classifyCaseLine(line: string): { status: TestStatus; name: string; durationMs?: number } | null {
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
function splitPath(id: string): string[] {
  if (id.includes("::")) return id.split("::").map((s) => s.trim()).filter(Boolean)
  if (id.includes(" > ")) return id.split(" > ").map((s) => s.trim()).filter(Boolean)
  if (id.includes(" › ")) return id.split(" › ").map((s) => s.trim()).filter(Boolean)
  return [id.trim()]
}

function deriveStatus(children: ReadonlyArray<TestNode>): TestStatus {
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

  const root: TestSuite = { id: "suite:root", kind: "suite", name: "All tests", status: "passed", children: [] }
  let failed = 0

  if (runner === "unknown") {
    const cases = lines
      .filter(Boolean)
      .map((line): TestCase => {
        const isErr = /\b(error|err|failed|failure|exception|traceback|fatal|panic)\b/i.test(line)
        const status: TestStatus = isErr ? "failed" : "passed"
        if (isErr) failed++
        return caseFrom(line, status, undefined, isErr ? line : undefined)
      })
    root.children = cases.length ? [groupSuite("Output", cases)] : []
    root.status = deriveStatus(root.children)
    return finish(command, runner, root, opts.id, failed)
  }

  // Map of file/suite path → cases, preserving first-seen order.
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
  root.children = suites
  root.status = deriveStatus(root.children)
  return finish(command, runner, root, opts.id, failed)
}

function groupSuite(name: string, cases: TestCase[]): TestSuite {
  return { id: `suite:${name}`, kind: "suite", name, status: deriveStatus(cases), children: cases }
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

// --- derivation -------------------------------------------------------------

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

// --- visible tree / selection ----------------------------------------------

function visibleNodes(run: TestRun, filter: TestNodeFilter): TestNode[] {
  if (filter === "all") return [...run.root.children]
  const matches = (node: TestNode): boolean => {
    if (node.kind === "case") return node.status === filter
    return node.children.some(matches)
  }
  return run.root.children.filter(matches)
}

export function effectiveSelection(state: TestResultsState): string | null {
  const ids = visibleNodes(state.run, state.filter).flatMap(collectIds)
  if (ids.length === 0) return null
  if (state.selectedId && ids.includes(state.selectedId)) return state.selectedId
  return ids[0]
}

function collectIds(nodes: ReadonlyArray<TestNode>): string[] {
  return nodes.flatMap((n) => (n.kind === "case" ? [n.id] : [n.id, ...collectIds(n.children)]))
}

export function moveSelection(state: TestResultsState, direction: 1 | -1): string | null {
  const ids = visibleNodes(state.run, state.filter).flatMap(collectIds)
  if (ids.length === 0) return null
  const current = effectiveSelection(state)
  const index = current ? ids.indexOf(current) : -1
  if (index === -1) return direction === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, index + direction))
  return ids[next]
}

// --- rerun ------------------------------------------------------------------

export interface RerunRequest {
  readonly command: string
  /** Human-readable scope, e.g. a file or "failed only". */
  readonly scope?: string
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
