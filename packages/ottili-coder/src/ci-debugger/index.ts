import { Effect, Schema } from "effect"
import { Process } from "@/util/process"
import { Global } from "@opencode-ai/core/global"
import { existsSync } from "fs"
import { join } from "path"

/**
 * CI debugger runtime.
 *
 * Discovers failed CI checks, obtains their logs, identifies the root cause,
 * and reruns only the validations that failed (or were patched). State is
 * persisted to a JSON file under the project cache directory so an interrupted
 * run can be resumed in a later process.
 */

export class CIDebuggerError extends Schema.TaggedErrorClass<CIDebuggerError>()("CIDebuggerError", {
  kind: Schema.Literals([
    "gh-missing",
    "not-a-git-repo",
    "no-remote",
    "no-failed-checks",
    "log-fetch-failed",
    "rerun-failed",
    "patch-failed",
    "unsupported-provider",
    "state-read-failed",
    "state-write-failed",
  ]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export type CheckStatus = "passed" | "failed" | "skipped" | "cancelled" | "pending"

export class CheckRun extends Schema.Class<CheckRun>("CIDebugger.CheckRun")({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  workflow: Schema.optional(Schema.String),
  logs: Schema.optional(Schema.String),
}) {}

export class RootCause extends Schema.Class<RootCause>("CIDebugger.RootCause")({
  category: Schema.String,
  summary: Schema.String,
  detail: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  suggestion: Schema.optional(Schema.String),
}) {}

export class DebugReport extends Schema.Class<DebugReport>("CIDebugger.DebugReport")({
  provider: Schema.String,
  baseRef: Schema.optional(Schema.String),
  headSha: Schema.String,
  discovered: Schema.Array(CheckRun),
  failed: Schema.Array(CheckRun),
  rootCauses: Schema.Array(RootCause),
  reran: Schema.Array(Schema.String),
  statePath: Schema.optional(Schema.String),
}) {}

const LOG_SIGNATURES = [
  {
    category: "typescript",
    pattern: /error TS\d+: /,
    suggestion: "Fix the TypeScript compile error reported above and rerun the typecheck.",
  },
  {
    category: "test-failure",
    pattern: /(FAIL|✗|failed|✕)\s.*(\.test\.|\.spec\.|tests?\/)/,
    suggestion: "Inspect the failing test assertion and adjust the implementation or the test.",
  },
  {
    category: "lint",
    pattern: /(eslint|biome|prettier|ruff|flake8|lint):?\s+(error|warning)/i,
    suggestion: "Run the linter locally and fix the reported issues before pushing.",
  },
  {
    category: "build",
    pattern: /(build failed|vite build|next build|rollup|webpack|tsc|esbuild):?\s.*(error|failed)/i,
    suggestion: "Resolve the build failure and rerun the build step.",
  },
  {
    category: "dependency",
    pattern: /(Cannot find module|MODULE_NOT_FOUND|npm ERR!|pnpm ERR!|yarn ERR!|dependencies must be installed)/,
    suggestion: "Reinstall dependencies and verify the lockfile is committed.",
  },
  {
    category: "permission",
    pattern: /(permission denied|EACCES|denied by policy)/,
    suggestion: "Fix file or execution permissions for the failing step.",
  },
  {
    category: "timeout",
    pattern: /(timed out|Timeout|exceeded the maximum allowed time)/,
    suggestion: "Increase the step timeout or optimize the slow task.",
  },
] as const

function identifyRootCause(name: string, logs: string): RootCause[] {
  const causes: RootCause[] = []
  for (const sig of LOG_SIGNATURES) {
    const match = logs.match(sig.pattern)
    if (!match) continue
    causes.push(
      new RootCause({
        category: sig.category,
        summary: `${name}: ${sig.category} failure`,
        detail: match[0],
        suggestion: sig.suggestion,
      }),
    )
  }
  if (causes.length === 0 && logs.trim().length > 0) {
    causes.push(
      new RootCause({
        category: "unknown",
        summary: `${name}: unclassified failure`,
        detail: logs.split("\n").filter(Boolean).slice(-10).join("\n"),
        suggestion: "Review the tail of the log and reproduce locally to isolate the failure.",
      }),
    )
  }
  return causes
}

export interface DebugOptions {
  readonly cwd: string
  readonly sha?: string
  readonly repo?: string
  readonly patchPath?: string
  readonly rerun?: boolean
  readonly signal?: AbortSignal
}

interface StateShape {
  readonly headSha: string
  readonly discovered: CheckRun[]
  readonly failed: CheckRun[]
  readonly rootCauses: RootCause[]
  readonly reran: string[]
  readonly updatedAt: number
}

const StateSchema = Schema.Struct({
  headSha: Schema.String,
  discovered: Schema.Array(CheckRun),
  failed: Schema.Array(CheckRun),
  rootCauses: Schema.Array(RootCause),
  reran: Schema.Array(Schema.String),
  updatedAt: Schema.Number,
})

const statePath = (cwd: string) => join(Global.Path.cache, "ci-debugger", `${Buffer.from(cwd).toString("hex")}.json`)

export const loadState = Effect.fn("CIDebugger.loadState")(function* (cwd: string) {
  const file = statePath(cwd)
  if (!existsSync(file)) return yield* Effect.succeed(null)
  const result = yield* Effect.tryPromise({
    try: () => Bun.file(file).json(),
    catch: (cause) => new CIDebuggerError({ kind: "state-read-failed", message: `Cannot read state: ${file}`, cause }),
  })
  const decoded = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(StateSchema)(result),
    catch: (cause) =>
      new CIDebuggerError({ kind: "state-read-failed", message: `Corrupt state: ${file}`, cause }),
  })
  return decoded
})

export const saveState = Effect.fn("CIDebugger.saveState")(function* (cwd: string, state: StateShape) {
  const file = statePath(cwd)
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.write(file, JSON.stringify(state, null, 2))
    },
    catch: (cause) => new CIDebuggerError({ kind: "state-write-failed", message: `Cannot write state: ${file}`, cause }),
  })
})

const runProcess = (cmd: string[], cwd: string, signal?: AbortSignal) =>
  Effect.promise(() =>
    Process.run(cmd, { cwd, nothrow: true, abort: signal, timeout: 120_000 }).then((res) => ({
      code: res.code,
      stdout: res.stdout.toString("utf8"),
      stderr: res.stderr.toString("utf8"),
    })),
  )

export const isGhAvailable = Effect.fn("CIDebugger.isGhAvailable")(function* () {
  const res = yield* runProcess(["gh", "--version"], process.cwd())
  return res.code === 0
})

const resolveHeadSha = Effect.fnUntraced(function* (cwd: string, sha?: string) {
  if (sha) return sha
  const res = yield* runProcess(["git", "rev-parse", "HEAD"], cwd)
  if (res.code !== 0) {
    return yield* new CIDebuggerError({ kind: "not-a-git-repo", message: res.stderr || "not a git repository" })
  }
  return res.stdout.trim()
})

const fetchFailedChecks = Effect.fnUntraced(function* (cwd: string, sha: string) {
  const primary = yield* runProcess(
    ["gh", "api", `repos/{owner}/{repo}/commits/${sha}/check-runs`, "--jq", ".check_runs[]"],
    cwd,
  )
  const list =
    primary.code === 0
      ? primary
      : yield* runProcess(
          ["gh", "run", "list", "--commit", sha, "--json", "databaseId,name,status,conclusion,url,workflowName"],
          cwd,
        )
  if (list.code !== 0) {
    return yield* new CIDebuggerError({
      kind: "no-failed-checks",
      message: list.stderr || "gh could not list checks",
    })
  }
  const discovered: CheckRun[] = []
  const failed: CheckRun[] = []
  for (const raw of splitJsonLines(list.stdout)) {
    const run = parseCheckRun(raw)
    if (!run) continue
    discovered.push(run)
    if (run.status === "failed" || run.conclusion === "failure") failed.push(run)
  }
  return { discovered, failed }
})

function splitJsonLines(stdout: string): Record<string, unknown>[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return undefined
      }
    })
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
}

function parseCheckRun(raw: Record<string, unknown>): CheckRun | null {
  const id = String(raw.id ?? raw.databaseId ?? raw.name ?? "")
  const name = String(raw.name ?? raw.workflowName ?? raw.title ?? "")
  if (!name) return null
  const status = String(raw.status ?? "unknown")
  const conclusion = raw.conclusion ? String(raw.conclusion) : undefined
  const isFailed = status === "completed" && (conclusion === "failure" || conclusion === "timed_out")
  return new CheckRun({
    id,
    name,
    status: isFailed ? "failed" : status,
    conclusion,
    url: raw.url ? String(raw.url) : undefined,
    workflow: raw.workflowName ? String(raw.workflowName) : undefined,
  })
}

const fetchLogs = Effect.fnUntraced(function* (run: CheckRun, cwd: string) {
  const res = yield* runProcess(["gh", "run", "view", run.id, "--log"], cwd)
  if (res.code !== 0) return run
  return new CheckRun({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    url: run.url,
    workflow: run.workflow,
    logs: res.stdout,
  })
})

const applyPatch = Effect.fnUntraced(function* (patchPath: string, cwd: string) {
  if (!existsSync(patchPath)) {
    return yield* new CIDebuggerError({ kind: "patch-failed", message: `Patch not found: ${patchPath}` })
  }
  const res = yield* runProcess(["git", "apply", patchPath], cwd)
  if (res.code !== 0) {
    return yield* new CIDebuggerError({
      kind: "patch-failed",
      message: res.stderr || "git apply failed",
    })
  }
  return yield* Effect.void
})

const rerunChecks = Effect.fnUntraced(function* (failed: CheckRun[], cwd: string) {
  const reran: string[] = []
  for (const run of failed) {
    const res = yield* runProcess(["gh", "workflow", "run", run.workflow ?? run.name], cwd)
    if (res.code !== 0) {
      return yield* new CIDebuggerError({
        kind: "rerun-failed",
        message: `Failed to rerun ${run.name}: ${res.stderr}`,
      })
    }
    reran.push(run.name)
  }
  return reran
})

export { identifyRootCause, parseCheckRun, splitJsonLines }

export const debugCI = Effect.fn("CIDebugger.debug")(function* (opts: DebugOptions) {
  const gh = yield* isGhAvailable()
  if (!gh) {
    return yield* new CIDebuggerError({
      kind: "gh-missing",
      message: "GitHub CLI (gh) is required for CI debugging. Install it and authenticate.",
    })
  }
  const headSha = yield* resolveHeadSha(opts.cwd, opts.sha)
  const { discovered, failed } = yield* fetchFailedChecks(opts.cwd, headSha)
  if (failed.length === 0) {
    return yield* new CIDebuggerError({
      kind: "no-failed-checks",
      message: `No failed checks found for ${headSha}.`,
    })
  }

  const withLogs = yield* Effect.forEach(failed, (run) => fetchLogs(run, opts.cwd), { concurrency: 4 })
  const rootCauses = withLogs.flatMap((run) => identifyRootCause(run.name, run.logs ?? ""))

  let reran: string[] = []
  if (opts.patchPath) {
    yield* applyPatch(opts.patchPath, opts.cwd)
  }
  if (opts.rerun) {
    reran = yield* rerunChecks(withLogs, opts.cwd)
  }

  const sp = statePath(opts.cwd)
  yield* saveState(opts.cwd, {
    headSha,
    discovered,
    failed: withLogs,
    rootCauses,
    reran,
    updatedAt: Date.now(),
  })

  return new DebugReport({
    provider: "github-actions",
    headSha,
    discovered,
    failed: withLogs,
    rootCauses,
    reran,
    statePath: sp,
  })
})

export * as CIDebugger from "."
