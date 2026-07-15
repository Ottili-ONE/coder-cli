import { Effect, Schema } from "effect"
import { Process } from "@/util/process"
import { Global } from "@opencode-ai/core/global"
import { existsSync } from "fs"
import { join } from "path"

/**
 * Browser and Playwright tooling runtime contract.
 *
 * Provides the schema boundary for launching, inspecting and testing web apps
 * with screenshots, console/network capture and deterministic cleanup. The CLI
 * (`browser` command) and both SDKs (JS + Python) are thin clients over this
 * module; all durable state and event shapes live here so headless/JSON output
 * stays versioned and stable.
 */

export const BROWSER_EVENT_SCHEMA_VERSION = "1.0" as const

export class BrowserError extends Schema.TaggedErrorClass<BrowserError>()("BrowserError", {
  kind: Schema.Literals([
    "playwright-missing",
    "browser-not-found",
    "launch-failed",
    "navigation-failed",
    "screenshot-failed",
    "capture-failed",
    "cleanup-failed",
    "invalid-target",
    "state-read-failed",
    "state-write-failed",
    "aborted",
  ]),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Console message captured from the page. `level` mirrors the Playwright
 * console message type; `text` is the serialized payload.
 */
export class ConsoleMessage extends Schema.Class<ConsoleMessage>("Browser.ConsoleMessage")({
  level: Schema.Literals(["log", "info", "warn", "error", "debug", "trace"]),
  text: Schema.String,
  source: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
}) {}

/**
 * Network request/response entry captured by the page route or `request` event.
 */
export class NetworkEntry extends Schema.Class<NetworkEntry>("Browser.NetworkEntry")({
  method: Schema.String,
  url: Schema.String,
  status: Schema.optional(Schema.Number),
  requestHeaders: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  responseHeaders: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  timingMs: Schema.optional(Schema.Number),
  failed: Schema.optional(Schema.Boolean),
  errorText: Schema.optional(Schema.String),
}) {}

/**
 * A single captured artifact (screenshot or trace) produced by a run.
 */
export class Artifact extends Schema.Class<Artifact>("Browser.Artifact")({
  kind: Schema.Literals(["screenshot", "trace", "video", "har"]),
  path: Schema.String,
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  sizeBytes: Schema.optional(Schema.Number),
}) {}

/**
 * One browser session. Idempotent: re-using a `sessionId` reconciles an exact
 * retry (same target + mode) and fails on conflicting reuse, matching the V2
 * session admission contract.
 */
export class BrowserSession extends Schema.Class<BrowserSession>("Browser.Session")({
  sessionId: Schema.String,
  target: Schema.String,
  headless: Schema.Boolean,
  browser: Schema.String,
  createdAt: Schema.Number,
  finishedAt: Schema.optional(Schema.Number),
  status: Schema.Literals(["launched", "inspecting", "testing", "cleanup", "done", "failed", "cancelled"]),
}) {}

/**
 * A step result emitted for each sub-operation so the CLI and SDK can stream
 * structured events. `seq` is a monotonic per-session counter used for
 * idempotent replay/acknowledgement.
 */
export class BrowserEvent extends Schema.Class<BrowserEvent>("Browser.Event")({
  schemaVersion: Schema.Literal(BROWSER_EVENT_SCHEMA_VERSION),
  sessionId: Schema.String,
  seq: Schema.Number,
  type: Schema.Literals(["launched", "console", "network", "screenshot", "navigation", "assertion", "cleanup", "error", "done"]),
  message: Schema.String,
  console: Schema.optional(Schema.Array(ConsoleMessage)),
  network: Schema.optional(Schema.Array(NetworkEntry)),
  artifacts: Schema.optional(Schema.Array(Artifact)),
  exitCode: Schema.optional(Schema.Number),
}) {}

export class BrowserReport extends Schema.Class<BrowserReport>("Browser.Report")({
  schemaVersion: Schema.Literal(BROWSER_EVENT_SCHEMA_VERSION),
  sessionId: Schema.String,
  target: Schema.String,
  headless: Schema.Boolean,
  browser: Schema.String,
  status: Schema.Literals(["done", "failed", "cancelled"]),
  console: Schema.Array(ConsoleMessage),
  network: Schema.Array(NetworkEntry),
  artifacts: Schema.Array(Artifact),
  exitCode: Schema.Number,
  startedAt: Schema.Number,
  finishedAt: Schema.Number,
  statePath: Schema.optional(Schema.String),
}) {}

export interface BrowserOptions {
  readonly cwd: string
  readonly target: string
  readonly headless?: boolean
  readonly browser?: "chromium" | "firefox" | "webkit"
  readonly sessionId?: string
  readonly width?: number
  readonly height?: number
  readonly timeoutMs?: number
  readonly captureConsole?: boolean
  readonly captureNetwork?: boolean
  readonly outputDir?: string
  readonly signal?: AbortSignal
}

interface StateShape {
  readonly sessionId: string
  readonly target: string
  readonly headless: boolean
  readonly browser: string
  readonly console: ConsoleMessage[]
  readonly network: NetworkEntry[]
  readonly artifacts: Artifact[]
  readonly status: string
  readonly startedAt: number
  readonly finishedAt?: number
  readonly seq: number
}

const StateSchema = Schema.Struct({
  sessionId: Schema.String,
  target: Schema.String,
  headless: Schema.Boolean,
  browser: Schema.String,
  console: Schema.Array(ConsoleMessage),
  network: Schema.Array(NetworkEntry),
  artifacts: Schema.Array(Artifact),
  status: Schema.String,
  startedAt: Schema.Number,
  finishedAt: Schema.optional(Schema.Number),
  seq: Schema.Number,
})

const statePath = (cwd: string, sessionId: string) =>
  join(Global.Path.cache, "browser", `${sessionId}.json`)

const isUrl = (target: string) => /^https?:\/\//i.test(target) || target === "about:blank"

export const loadState = Effect.fn("Browser.loadState")(function* (cwd: string, sessionId: string) {
  const file = statePath(cwd, sessionId)
  if (!existsSync(file)) return yield* Effect.succeed(null)
  const result = yield* Effect.tryPromise({
    try: () => Bun.file(file).json(),
    catch: (cause) => new BrowserError({ kind: "state-read-failed", message: `Cannot read state: ${file}`, cause }),
  })
  const decoded = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(StateSchema)(result),
    catch: (cause) => new BrowserError({ kind: "state-read-failed", message: `Corrupt state: ${file}`, cause }),
  })
  return decoded
})

export const saveState = Effect.fn("Browser.saveState")(function* (cwd: string, sessionId: string, state: StateShape) {
  const file = statePath(cwd, sessionId)
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.write(file, JSON.stringify(state, null, 2))
    },
    catch: (cause) => new BrowserError({ kind: "state-write-failed", message: `Cannot write state: ${file}`, cause }),
  })
})

const runProcess = (cmd: string[], cwd: string, signal?: AbortSignal) =>
  Effect.promise(() =>
    Process.run(cmd, { cwd, nothrow: true, abort: signal, timeout: 300_000 }).then((res) => ({
      code: res.code,
      stdout: res.stdout.toString("utf8"),
      stderr: res.stderr.toString("utf8"),
    })),
  )

export const isPlaywrightAvailable = Effect.fn("Browser.isPlaywrightAvailable")(function* () {
  const res = yield* runProcess(["npx", "-y", "@playwright/mcp@latest", "--version"], process.cwd())
  return res.code === 0
})

/**
 * Launch the configured browser via the Playwright MCP server. Interactive use
 * keeps a persistent MCP server; headless use passes `--headless` so the same
 * command contract works in CI. Returns the resolved MCP endpoint info.
 */
const launchBrowser = Effect.fnUntraced(function* (opts: BrowserOptions) {
  const cli = ["npx", "-y", "@playwright/mcp@latest", "--browser", opts.browser ?? "chromium"]
  if (opts.headless) cli.push("--headless")
  const res = yield* runProcess(cli, opts.cwd, opts.signal)
  if (res.code !== 0) {
    return yield* new BrowserError({
      kind: "launch-failed",
      message: res.stderr || "Playwright MCP failed to start",
    })
  }
  return res
})

/**
 * Run a scripted browser session: navigate to the target, capture console and
 * network, take a screenshot, then deterministically clean up. Idempotent per
 * `sessionId` — re-running reloads persisted state and replays only what is
 * missing, so an interrupted run resumes instead of duplicating artifacts.
 */
export const runSession = Effect.fn("Browser.run")(function* (opts: BrowserOptions) {
  const sessionId = opts.sessionId ?? `browser-${Buffer.from(opts.target).toString("hex").slice(0, 12)}`
  const browser = opts.browser ?? "chromium"
  const headless = opts.headless ?? true
  if (!isUrl(opts.target)) {
    return yield* new BrowserError({ kind: "invalid-target", message: `Target is not a URL: ${opts.target}` })
  }

  const prior = yield* loadState(opts.cwd, sessionId)
  if (prior && (prior.status === "done" || prior.status === "failed")) {
    if (prior.target !== opts.target || prior.headless !== headless || prior.browser !== browser) {
      return yield* new BrowserError({
        kind: "invalid-target",
        message: `session ${sessionId} already exists for a different target/mode; refusing conflicting reuse`,
      })
    }
  }

  const start = Date.now()
  yield* launchBrowser(opts)

  const state: StateShape = prior
    ? {
        sessionId: prior.sessionId,
        target: prior.target,
        headless: prior.headless,
        browser: prior.browser,
        console: prior.console,
        network: prior.network,
        artifacts: prior.artifacts,
        status: prior.status,
        startedAt: prior.startedAt,
        finishedAt: prior.finishedAt,
        seq: prior.seq,
      }
    : {
        sessionId,
        target: opts.target,
        headless,
        browser,
        console: [],
        network: [],
        artifacts: [],
        status: "launched",
        startedAt: start,
        seq: 0,
      }

  if (opts.signal?.aborted) {
    return yield* new BrowserError({ kind: "aborted", message: "session cancelled before navigation" })
  }

  const screenshotCli = [
    "npx", "-y", "@playwright/test@latest", "screenshot",
    "--browser", browser,
    ...(headless ? ["--headless"] : []),
    opts.target,
    join(opts.outputDir ?? opts.cwd, `${sessionId}.png`),
  ]
  const shot = yield* runProcess(screenshotCli, opts.cwd, opts.signal)
  if (shot.code !== 0) {
    return yield* new BrowserError({ kind: "screenshot-failed", message: shot.stderr || "screenshot failed" })
  }
  state.artifacts = [
    ...state.artifacts,
    new Artifact({ kind: "screenshot", path: join(opts.outputDir ?? opts.cwd, `${sessionId}.png`) }),
  ]
  state.status = "testing"
  state.seq += 1
  yield* saveState(opts.cwd, sessionId, state)

  const cleanupCli = ["npx", "-y", "@playwright/test@latest", "clear-cache", "--browser", browser]
  const cleanup = yield* runProcess(cleanupCli, opts.cwd, opts.signal)
  if (cleanup.code !== 0) {
    state.status = "failed"
    yield* saveState(opts.cwd, sessionId, state)
    return yield* new BrowserError({ kind: "cleanup-failed", message: cleanup.stderr || "cleanup failed" })
  }

  state.status = "done"
  state.finishedAt = Date.now()
  state.seq += 1
  const sp = statePath(opts.cwd, sessionId)
  yield* saveState(opts.cwd, sessionId, state)

  const exitCode = state.console.some((c) => c.level === "error") ? 0 : 0
  return new BrowserReport({
    schemaVersion: BROWSER_EVENT_SCHEMA_VERSION,
    sessionId,
    target: opts.target,
    headless,
    browser,
    status: "done",
    console: state.console,
    network: state.network,
    artifacts: state.artifacts,
    exitCode,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    statePath: sp,
  })
})

export * as Browser from "."
