import spawn from "cross-spawn"

/**
 * Local browser/Playwright client.
 *
 * Wraps the `ottili-coder browser` CLI so SDK consumers can launch, inspect and
 * test web apps with screenshots, console/network capture and deterministic
 * cleanup without standing up a server. Output is parsed from the `--json` form.
 */

export interface BrowserOptions {
  cwd?: string
  headless?: boolean
  browser?: "chromium" | "firefox" | "webkit"
  session?: string
  outputDir?: string
  timeout?: number
  captureConsole?: boolean
  captureNetwork?: boolean
  json?: boolean
}

export interface ConsoleMessage {
  level: "log" | "info" | "warn" | "error" | "debug" | "trace"
  text: string
  source?: string
  location?: string
}

export interface NetworkEntry {
  method: string
  url: string
  status?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  timingMs?: number
  failed?: boolean
  errorText?: string
}

export interface Artifact {
  kind: "screenshot" | "trace" | "video" | "har"
  path: string
  width?: number
  height?: number
  sizeBytes?: number
}

export interface BrowserReport {
  schemaVersion: string
  sessionId: string
  target: string
  headless: boolean
  browser: string
  status: "done" | "failed" | "cancelled"
  console: ConsoleMessage[]
  network: NetworkEntry[]
  artifacts: Artifact[]
  exitCode: number
  startedAt: number
  finishedAt: number
  statePath?: string
}

function run(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  const proc = spawn("ottili-coder", ["browser", ...args], { cwd })
  const code = proc.exitCode ?? (proc.signalCode ? 1 : 0)
  const stdout = proc.stdout?.toString() ?? ""
  const stderr = proc.stderr?.toString() ?? ""
  if (code !== 0 && !args.includes("--json")) {
    throw new Error(stderr || `browser exited with code ${code}`)
  }
  return { code, stdout, stderr }
}

function baseArgs(opts: BrowserOptions, sub: string, target: string): string[] {
  const args = [sub, target, "--json"]
  if (opts.headless === false) args.push("--no-headless")
  if (opts.browser && opts.browser !== "chromium") args.push("--browser", opts.browser)
  if (opts.session) args.push("--session", opts.session)
  if (opts.outputDir) args.push("--output-dir", opts.outputDir)
  if (opts.timeout) args.push("--timeout", String(opts.timeout))
  return args
}

export function launch(target: string, opts: BrowserOptions = {}): BrowserReport {
  return JSON.parse(run(baseArgs(opts, "launch", target), opts.cwd).stdout) as BrowserReport
}

export function screenshot(target: string, opts: BrowserOptions = {}): BrowserReport {
  return JSON.parse(run(baseArgs(opts, "screenshot", target), opts.cwd).stdout) as BrowserReport
}

export function test(target: string, opts: BrowserOptions = {}): BrowserReport {
  const args = baseArgs(opts, "test", target)
  if (opts.captureConsole === false) args.push("--no-capture-console")
  if (opts.captureNetwork === false) args.push("--no-capture-network")
  return JSON.parse(run(args, opts.cwd).stdout) as BrowserReport
}

export function showState(session: string, cwd?: string): unknown {
  return JSON.parse(run(["state", session, "--json"], cwd).stdout)
}
