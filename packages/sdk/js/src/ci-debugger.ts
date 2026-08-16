import spawn from "cross-spawn"

/**
 * Local CI debugger client.
 *
 * Wraps the `ottili-coder ci-debugger` CLI so SDK consumers can discover failed
 * checks, fetch root causes, and rerun only what failed without standing up a
 * server. Output is parsed from the `--json` form.
 */

export interface CIDebuggerOptions {
  cwd?: string
  sha?: string
  patch?: string
  json?: boolean
}

export interface CIRootCause {
  category: string
  summary: string
  detail?: string
  file?: string
  line?: number
  suggestion?: string
}

export interface CICheckRun {
  id: string
  name: string
  status: string
  conclusion?: string
  url?: string
  workflow?: string
  logs?: string
}

export interface CIDebugReport {
  provider: string
  baseRef?: string
  headSha: string
  discovered: CICheckRun[]
  failed: CICheckRun[]
  rootCauses: CIRootCause[]
  reran: string[]
  statePath?: string
}

function run(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  const proc = spawn("ottili-coder", ["ci-debugger", ...args], { cwd })
  const code = proc.exitCode ?? (proc.signalCode ? 1 : 0)
  const stdout = proc.stdout?.toString() ?? ""
  const stderr = proc.stderr?.toString() ?? ""
  if (code !== 0 && !args.includes("--json")) {
    throw new Error(stderr || `ci-debugger exited with code ${code}`)
  }
  return { code, stdout, stderr }
}

export function discoverFailedChecks(opts: CIDebuggerOptions = {}): CIDebugReport {
  const args = ["discover", ...(opts.sha ? [opts.sha] : []), "--json"]
  return JSON.parse(run(args, opts.cwd).stdout) as CIDebugReport
}

export function identifyRootCauses(opts: CIDebuggerOptions = {}): CIRootCause[] {
  const args = ["root-cause", ...(opts.sha ? [opts.sha] : []), "--json"]
  return JSON.parse(run(args, opts.cwd).stdout) as CIRootCause[]
}

export function rerunFailedChecks(opts: CIDebuggerOptions = {}): { reran: string[] } {
  const args = ["rerun", ...(opts.sha ? [opts.sha] : [])]
  if (opts.patch) args.push("--patch", opts.patch)
  args.push("--json")
  return JSON.parse(run(args, opts.cwd).stdout) as { reran: string[] }
}

export function showCIDebugState(cwd?: string): unknown {
  return JSON.parse(run(["state", "--json"], cwd).stdout)
}
