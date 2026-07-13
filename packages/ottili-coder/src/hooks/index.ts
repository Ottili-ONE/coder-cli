export * as Hooks from "./index"

import { Schema, Effect, Exit } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buffer } from "node:stream/consumers"
import { Process } from "@/util/process"

/**
 * User-facing hooks, modeled after Claude Code's hook framework.
 *
 * Hooks are configured in `hooks.json` files:
 *   - user global:  ~/.agents/hooks.json  and  ~/.claude/hooks.json
 *   - project:      <dir>/.ottili-coder/hooks.json  and  <dir>/.claude/hooks.json
 *                   (walked upward from the current working directory)
 *
 * Each event maps to an array of matchers. A matcher has an optional `matcher`
 * (tool-name filter) and a list of hook commands. A command is a shell script
 * that receives a JSON description of the event on stdin and may influence the
 * run by printing JSON on stdout (see `runHookCommand`).
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
])
export type HookEvent = typeof HookEvent.Type

export class HookCommand extends Schema.Class<HookCommand>("HookCommand")({
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
  matcher: Schema.optional(Schema.String),
  type: Schema.optional(Schema.Literals(["command"])),
}) {}

export class HookMatcher extends Schema.Class<HookMatcher>("HookMatcher")({
  matcher: Schema.optional(Schema.String),
  hooks: Schema.Array(HookCommand),
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
})
export type HooksConfig = typeof HooksConfig.Type

export interface HookResult {
  blocked: boolean
  blockReason?: string
  updatedInput?: unknown
  additionalContext?: string
}

const DEFAULT_TIMEOUT_SECONDS = 120

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

const EVENTS = [
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
] as const

export function load(cwd: string): HooksConfig {
  const merged: Record<string, HookMatcher[]> = {}
  for (const file of hookFiles(cwd)) {
    try {
      if (!fs.existsSync(file)) continue
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
      for (const event of EVENTS) {
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

export async function runHookCommand(hook: HookCommand, input: unknown, cwd: string): Promise<HookResult> {
  const proc = Process.spawn(["bash", "-lc", hook.command], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout: (hook.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
  })
  if (proc.stdin) {
    proc.stdin.write(JSON.stringify(input))
    proc.stdin.end()
  }
  const [code, out, err] = await Promise.all([
    proc.exited,
    proc.stdout ? buffer(proc.stdout) : Promise.resolve(Buffer.alloc(0)),
    proc.stderr ? buffer(proc.stderr) : Promise.resolve(Buffer.alloc(0)),
  ]).catch(() => [1, Buffer.alloc(0), Buffer.from("hook execution failed")] as const)

  const stdout = out.toString().trim()
  const stderr = err.toString().trim()
  const result: HookResult = { blocked: false }

  if (code === 2) {
    result.blocked = true
    result.blockReason = stderr || stdout || "blocked by hook (exit code 2)"
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
  return result
}

async function runMatchers(
  matchers: readonly HookMatcher[] | undefined,
  name: string,
  input: unknown,
  cwd: string,
): Promise<HookResult> {
  const acc: HookResult = { blocked: false }
  if (!matchers) return acc
  for (const matcher of matchers) {
    if (!matches(matcher.matcher, name)) continue
    for (const hook of matcher.hooks) {
      const r = await runHookCommand(hook, input, cwd)
      if (r.blocked) {
        acc.blocked = true
        acc.blockReason = r.blockReason ?? acc.blockReason
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
  )
}

export function sessionStart(opts: { sessionID: string; cwd: string; source: string }): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.SessionStart,
    "SessionStart",
    { session_id: opts.sessionID, cwd: opts.cwd, source: opts.source },
    opts.cwd,
  )
}

export function sessionEnd(opts: { sessionID: string; cwd: string; reason: string }): Promise<HookResult> {
  const cfg = load(opts.cwd)
  return runMatchers(
    cfg.SessionEnd,
    "SessionEnd",
    { session_id: opts.sessionID, cwd: opts.cwd, reason: opts.reason },
    opts.cwd,
  )
}

export function list(cwd: string): HooksConfig {
  return load(cwd)
}
