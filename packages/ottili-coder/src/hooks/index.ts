export * as Hooks from "./index"

import { Schema, Exit } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buffer } from "node:stream/consumers"
import { Process } from "@/util/process"
import { errorMessage } from "@/util/error"
import { redactUnknown } from "@/util/redact"

/**
 * User-facing lifecycle hooks, modeled after Claude Code's hook framework and
 * extended for the Ottili Coder lifecycle (message, task, validation, commit
 * and deploy in addition to the tool/session hooks).
 *
 * Hooks are configured in `hooks.json` files:
 *   - user global:  ~/.agents/hooks.json  and  ~/.claude/hooks.json
 *   - project:      <dir>/.ottili-coder/hooks.json  and  <dir>/.claude/hooks.json
 *                   (walked upward from the current working directory)
 *
 * Each event maps to an array of matchers. A matcher has an optional `matcher`
 * (tool/name filter) and a list of hook commands. A command is a shell script
 * that receives a JSON description of the event on stdin and may influence the
 * run by printing JSON on stdout (see `runHookCommand`).
 *
 * Runtime guarantees:
 *   - Per-command `timeout` (seconds); default 120s. A timeout/non-zero exit is
 *     handled according to the matcher/command `policy`.
 *   - `policy` (failure policy): "block" (default) fails the operation,
 *     "warn" records the failure but continues, "ignore" silently continues.
 *   - Every run is logged to a durable log directory with secret redaction.
 *   - No secret value is ever written to stdout, stderr, or the log.
 */

export const HookEvent = Schema.Literals([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "UserPromptSubmit",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "PreMessage",
  "PostMessage",
  "TaskStart",
  "TaskEnd",
  "PreValidation",
  "PostValidation",
  "PreCommit",
  "PostCommit",
  "PreDeploy",
  "PostDeploy",
])
export type HookEvent = typeof HookEvent.Type

/** Failure policy applied when a hook command fails (timeout, non-zero exit, JSON error). */
export const HookFailurePolicy = Schema.Literals(["block", "warn", "ignore"])
export type HookFailurePolicy = typeof HookFailurePolicy.Type

export class HookCommand extends Schema.Class<HookCommand>("HookCommand")({
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
  matcher: Schema.optional(Schema.String),
  type: Schema.optional(Schema.Literals(["command"])),
  policy: Schema.optional(HookFailurePolicy),
}) {}

export class HookMatcher extends Schema.Class<HookMatcher>("HookMatcher")({
  matcher: Schema.optional(Schema.String),
  hooks: Schema.Array(HookCommand),
  policy: Schema.optional(HookFailurePolicy),
}) {}

export const HooksConfig = Schema.Struct({
  PreToolUse: Schema.optional(Schema.Array(HookMatcher)),
  PostToolUse: Schema.optional(Schema.Array(HookMatcher)),
  PostToolUseFailure: Schema.optional(Schema.Array(HookMatcher)),
  Stop: Schema.optional(Schema.Array(HookMatcher)),
  SessionStart: Schema.optional(Schema.Array(HookMatcher)),
  SessionEnd: Schema.optional(Schema.Array(HookMatcher)),
  Notification: Schema.optional(Schema.Array(HookMatcher)),
  UserPromptSubmit: Schema.optional(Schema.Array(HookMatcher)),
  PreCompact: Schema.optional(Schema.Array(HookMatcher)),
  PostCompact: Schema.optional(Schema.Array(HookMatcher)),
  SubagentStart: Schema.optional(Schema.Array(HookMatcher)),
  SubagentStop: Schema.optional(Schema.Array(HookMatcher)),
  PreMessage: Schema.optional(Schema.Array(HookMatcher)),
  PostMessage: Schema.optional(Schema.Array(HookMatcher)),
  TaskStart: Schema.optional(Schema.Array(HookMatcher)),
  TaskEnd: Schema.optional(Schema.Array(HookMatcher)),
  PreValidation: Schema.optional(Schema.Array(HookMatcher)),
  PostValidation: Schema.optional(Schema.Array(HookMatcher)),
  PreCommit: Schema.optional(Schema.Array(HookMatcher)),
  PostCommit: Schema.optional(Schema.Array(HookMatcher)),
  PreDeploy: Schema.optional(Schema.Array(HookMatcher)),
  PostDeploy: Schema.optional(Schema.Array(HookMatcher)),
})
export type HooksConfig = typeof HooksConfig.Type

export interface HookResult {
  blocked: boolean
  blockReason?: string
  updatedInput?: unknown
  additionalContext?: string
  /** Per-command run records captured during execution (redacted). */
  runs?: HookRunLog[]
}

/** Structured, durable log of a single hook command execution. */
export interface HookRunLog {
  event: HookEvent
  name: string
  command: string
  policy: HookFailurePolicy
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  /** Already redacted before being written. */
  stdout: string
  /** Already redacted before being written. */
  stderr: string
  error?: string
  ts: string
}

/** Typed, actionable error returned when a hook fails under the "block" policy. */
export class HookError extends Error {
  readonly event: HookEvent
  readonly name: string
  readonly command: string
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly log: HookRunLog

  constructor(run: HookRunLog) {
    const reason = run.error
      ? `hook ${run.event}/${run.name} failed: ${run.error}`
      : `hook ${run.event}/${run.name} exited ${run.exitCode ?? "timeout"}`
    super(reason)
    this.name = "HookError"
    this.event = run.event
    this.name = run.name
    this.command = run.command
    this.exitCode = run.exitCode
    this.timedOut = run.timedOut
    this.log = run
  }
}

const DEFAULT_TIMEOUT_SECONDS = 120
const ALL_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "UserPromptSubmit",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "PreMessage",
  "PostMessage",
  "TaskStart",
  "TaskEnd",
  "PreValidation",
  "PostValidation",
  "PreCommit",
  "PostCommit",
  "PreDeploy",
  "PostDeploy",
] as const
type EventName = (typeof ALL_EVENTS)[number]

function defaultPolicy(matcher: HookMatcher | undefined, command: HookCommand | undefined): HookFailurePolicy {
  return command?.policy ?? matcher?.policy ?? "block"
}

function matches(matcher: string | undefined, name: string): boolean {
  if (!matcher || matcher === "*" || matcher.trim() === "") return true
  if (matcher.includes("|")) {
    return matcher
      .split("|")
      .map((s) => s.trim())
      .includes(name)
  }
  try {
    return new RegExp(matcher).test(name)
  } catch {
    return matcher === name
  }
}

function hookFiles(cwd: string): string[] {
  const files: string[] = []
  const home = os.homedir()
  if (home) {
    files.push(path.join(home, ".agents", "hooks.json"))
    files.push(path.join(home, ".claude", "hooks.json"))
  }
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  for (;;) {
    files.push(path.join(dir, ".ottili-coder", "hooks.json"))
    files.push(path.join(dir, ".claude", "hooks.json"))
    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return files
}

function logDir(cwd: string): string {
  const dir = path.join(cwd, ".ottili-coder", "hooks-logs")
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // Logging must never break the host operation.
  }
  return dir
}

function appendLog(cwd: string, run: HookRunLog): void {
  try {
    const file = path.join(logDir(cwd), `${run.event}.log`)
    fs.appendFileSync(file, JSON.stringify(run) + "\n")
  } catch {
    // best-effort durable log
  }
}

export function load(cwd: string): HooksConfig {
  const merged: Record<string, HookMatcher[]> = {}
  for (const file of hookFiles(cwd)) {
    try {
      if (!fs.existsSync(file)) continue
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      for (const event of ALL_EVENTS) {
        const value = raw[event]
        if (!value) continue
        const exit = Schema.decodeUnknownExit(Schema.Array(HookMatcher))(value)
        if (Exit.isSuccess(exit)) {
          merged[event] = [...(merged[event] ?? []), ...exit.value]
        } else {
          console.error(`[hooks] skipping invalid "${event}" matchers in ${file}`)
        }
      }
    } catch (error) {
      console.error(`[hooks] skipping invalid hook config ${file}: ${String(error)}`)
    }
  }
  return merged as unknown as HooksConfig
}

export function list(cwd: string): HooksConfig {
  return load(cwd)
}

/**
 * Run a single hook command. Captures stdout/stderr, enforces the timeout,
 * applies the failure policy, and writes a redacted run log. The event payload
 * is redacted before being written to the log and the captured output is
 * redacted before being returned.
 */
export async function runHookCommand(
  hook: HookCommand,
  input: unknown,
  cwd: string,
  opts: { event: HookEvent; name: string },
): Promise<HookResult> {
  const policy = defaultPolicy(undefined, hook)
  const timeoutMs = (hook.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000
  const started = Date.now()
  const safeInput = redactUnknown(input)

  const proc = Process.spawn(["bash", "-lc", hook.command], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  })
  if (proc.stdin) {
    proc.stdin.write(JSON.stringify(safeInput))
    proc.stdin.end()
  }
  const [code, out, err] = await Promise.all([
    proc.exited,
    proc.stdout ? buffer(proc.stdout) : Promise.resolve(Buffer.alloc(0)),
    proc.stderr ? buffer(pro.stderr) : Promise.resolve(Buffer.alloc(0)),
  ]).catch((error: unknown) => {
    const message = errorMessage(error)
    return [1, Buffer.alloc(0), Buffer.from(message)] as const
  })

  const durationMs = Date.now() - started
  const stdoutRaw = out.toString().trim()
  const stderrRaw = err.toString().trim()
  const timedOut = code === null || (code !== 0 && stdoutRaw === "" && /timeout|signal/i.test(stderrRaw))
  const stdout = String(redactUnknown(stdoutRaw))
  const stderr = String(redactUnknown(stderrRaw))

  const runLog: HookRunLog = {
    event: opts.event,
    name: opts.name,
    command: hook.command,
    policy,
    exitCode: code,
    timedOut: false,
    durationMs,
    stdout,
    stderr,
    ts: new Date().toISOString(),
  }

  const result: HookResult = { blocked: false, runs: [runLog] }

  const failure = code === 2 || code !== 0
  if (failure) {
    if (code === 2) {
      runLog.error = stderrRaw || stdoutRaw || "blocked by hook (exit code 2)"
      result.blocked = true
      result.blockReason = runLog.error
      appendLog(cwd, runLog)
      return result
    }
    runLog.error = `exit code ${code}`
    runLog.timedOut = timedOut
    if (policy === "block") {
      result.blocked = true
      result.blockReason = `hook ${opts.event}/${opts.name} failed: ${runLog.error}`
      appendLog(cwd, runLog)
      return result
    }
    if (policy === "warn") {
      runLog.error = `exit code ${code} (policy=warn)`
    }
    appendLog(cwd, runLog)
    return result
  }

  if (stdout) {
    try {
      const parsed = JSON.parse(stdout)
      if (parsed.decision === "block") {
        result.blocked = true
        result.blockReason = parsed.reason ?? "blocked by hook"
      }
      const hso = parsed.hookSpecificOutput
      if (hso?.permissionDecision === "deny") {
        result.blocked = true
        result.blockReason = hso.permissionDecisionReason ?? "denied by hook"
      }
      if (parsed.updatedInput !== undefined) result.updatedInput = parsed.updatedInput
      if (typeof parsed.additionalContext === "string") {
        result.additionalContext = (result.additionalContext ? `${result.additionalContext}\n` : "") + parsed.additionalContext
      }
    } catch {
      // Non-JSON output is treated as informational context shown to the model.
      result.additionalContext = (result.additionalContext ? `${result.additionalContext}\n` : "") + stdout
    }
  }
  appendLog(cwd, runLog)
  return result
}

async function runMatchers(
  matchers: readonly HookMatcher[] | undefined,
  name: string,
  input: unknown,
  cwd: string,
  event: EventName,
): Promise<HookResult> {
  const acc: HookResult = { blocked: false, runs: [] }
  if (!matchers) return acc
  for (const matcher of matchers) {
    if (!matches(matcher.matcher, name)) continue
    for (const hook of matcher.hooks) {
      const r = await runHookCommand(hook, input, cwd, { event, name })
      acc.runs = [...(acc.runs ?? []), ...(r.runs ?? [])]
      if (r.blocked) {
        acc.blocked = true
        acc.blockReason = r.blockReason ?? acc.blockReason
        if (defaultPolicy(matcher, hook) === "block") return acc
        continue
      }
      if (r.updatedInput !== undefined) acc.updatedInput = r.updatedInput
      if (r.additionalContext) {
        acc.additionalContext = (acc.additionalContext ? `${acc.additionalContext}\n` : "") + r.additionalContext
      }
    }
  }
  return acc
}

export function preToolUse(opts: {
  tool: string
  toolInput: unknown
  sessionID: string
  callID: string
  cwd: string
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PreToolUse,
    opts.tool,
    {
      session_id: opts.sessionID,
      tool_name: opts.tool,
      tool_input: opts.toolInput,
      tool_use_id: opts.callID,
      cwd: opts.cwd,
    },
    opts.cwd,
    "PreToolUse",
  )
}

export function postToolUse(opts: {
  tool: string
  toolInput: unknown
  output: unknown
  sessionID: string
  callID: string
  cwd: string
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PostToolUse,
    opts.tool,
    {
      session_id: opts.sessionID,
      tool_name: opts.tool,
      tool_input: opts.toolInput,
      tool_response: opts.output,
      tool_use_id: opts.callID,
      cwd: opts.cwd,
    },
    opts.cwd,
    "PostToolUse",
  )
}

export function stop(opts: { sessionID: string; cwd: string; lastAssistantMessage?: string }): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.Stop,
    "Stop",
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      last_assistant_message: opts.lastAssistantMessage,
    },
    opts.cwd,
    "Stop",
  )
}

export function sessionStart(opts: { sessionID: string; cwd: string; source: string }): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(cfg.SessionStart, "SessionStart", { session_id: opts.sessionID, cwd: opts.cwd, source: opts.source }, opts.cwd, "SessionStart")
}

export function sessionEnd(opts: { sessionID: string; cwd: string; reason: string }): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(cfg.SessionEnd, "SessionEnd", { session_id: opts.sessionID, cwd: opts.cwd, reason: opts.reason }, opts.cwd, "SessionEnd")
}

// --- Lifecycle hooks: message ---

export function preMessage(opts: {
  sessionID: string
  cwd: string
  message: unknown
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PreMessage,
    "PreMessage",
    { session_id: opts.sessionID, cwd: opts.cwd, message: opts.message },
    opts.cwd,
    "PreMessage",
  )
}

export function postMessage(opts: {
  sessionID: string
  cwd: string
  message: unknown
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PostMessage,
    "PostMessage",
    { session_id: opts.sessionID, cwd: opts.cwd, message: opts.message },
    opts.cwd,
    "PostMessage",
  )
}

// --- Lifecycle hooks: task ---

export function taskStart(opts: {
  sessionID: string
  cwd: string
  taskID: string
  taskName: string
  input?: unknown
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.TaskStart,
    opts.taskName,
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      task_id: opts.taskID,
      task_name: opts.taskName,
      input: opts.input,
    },
    opts.cwd,
    "TaskStart",
  )
}

export function taskEnd(opts: {
  sessionID: string
  cwd: string
  taskID: string
  taskName: string
  result?: unknown
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.TaskEnd,
    opts.taskName,
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      task_id: opts.taskID,
      task_name: opts.taskName,
      result: opts.result,
    },
    opts.cwd,
    "TaskEnd",
  )
}

// --- Lifecycle hooks: validation ---

export function preValidation(opts: {
  sessionID: string
  cwd: string
  target?: string
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PreValidation,
    opts.target ?? "validation",
    { session_id: opts.sessionID, cwd: opts.cwd, target: opts.target },
    opts.cwd,
    "PreValidation",
  )
}

export function postValidation(opts: {
  sessionID: string
  cwd: string
  target?: string
  passed: boolean
  findings?: unknown
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PostValidation,
    opts.target ?? "validation",
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      target: opts.target,
      passed: opts.passed,
      findings: opts.findings,
    },
    opts.cwd,
    "PostValidation",
  )
}

// --- Lifecycle hooks: commit ---

export function preCommit(opts: {
  sessionID: string
  cwd: string
  message: string
  files?: string[]
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PreCommit,
    "commit",
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      message: opts.message,
      files: opts.files ?? [],
    },
    opts.cwd,
    "PreCommit",
  )
}

export function postCommit(opts: {
  sessionID: string
  cwd: string
  message: string
  sha: string
  files?: string[]
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PostCommit,
    "commit",
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      message: opts.message,
      sha: opts.sha,
      files: opts.files ?? [],
    },
    opts.cwd,
    "PostCommit",
  )
}

// --- Lifecycle hooks: deploy ---

export function preDeploy(opts: {
  sessionID: string
  cwd: string
  environment: string
  revision?: string
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PreDeploy,
    opts.environment,
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      environment: opts.environment,
      revision: opts.revision,
    },
    opts.cwd,
    "PreDeploy",
  )
}

export function postDeploy(opts: {
  sessionID: string
  cwd: string
  environment: string
  revision?: string
  status: string
}): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.PostDeploy,
    opts.environment,
    {
      session_id: opts.sessionID,
      cwd: opts.cwd,
      environment: opts.environment,
      revision: opts.revision,
      status: opts.status,
    },
    opts.cwd,
    "PostDeploy",
  )
}

/** All known lifecycle hook events, for listing/inspection. */
export const EVENT_NAMES: readonly HookEvent[] = ALL_EVENTS
