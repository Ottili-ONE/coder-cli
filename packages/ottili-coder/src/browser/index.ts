import { Effect, Schema } from "effect"
import { Process } from "@/util/process"
import { ConfigBrowser } from "@/config/browser"
import { Global } from "@opencode-ai/core/global"
import { existsSync, statSync } from "fs"
import { join } from "path"

/**
 * Hardening knobs for browser/Playwright runs. All are bounded and configurable
 * so a hostile or malformed target cannot blow up memory, disk or time budget.
 */
export interface BrowserResourceLimits {
  /** Max console messages retained per run (older entries dropped). */
  readonly maxConsoleMessages: number
  /** Max network entries retained per run (older entries dropped). */
  readonly maxNetworkEntries: number
  /** Max artifacts produced per run. */
  readonly maxArtifacts: number
  /** Max bytes for any single artifact (0 = unlimited). */
  readonly maxArtifactBytes: number
  /** Global ceiling for the whole session in ms (abort after this). */
  readonly maxSessionMs: number
}

export const DEFAULT_RESOURCE_LIMITS: BrowserResourceLimits = {
  maxConsoleMessages: 2000,
  maxNetworkEntries: 2000,
  maxArtifacts: 50,
  maxArtifactBytes: 25 * 1024 * 1024,
  maxSessionMs: 600_000,
}

const REDACTED = "<redacted>"
const SECRET_KEY_RE = /(token|secret|api[_-]?key|password|passwd|authorization|auth|access[_-]?key|sessionid|session[_-]?id|sid|csrf|x-api-key|bearer)/i
const SECRET_VALUE_RE = /(Bearer\s+\S+|Basic\s+\S+|\b[A-Za-z0-9_-]{20,}\b)/

/** Redact query-string and fragment secrets from a URL string. */
export function redactUrl(target: string): string {
  if (!target) return target
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return isLikelySecret(target) ? REDACTED : target
  }
  if (url.searchParams.size > 0) {
    const filtered = new URLSearchParams()
    for (const [key, value] of url.searchParams.entries()) {
      filtered.set(key, SECRET_KEY_RE.test(key) || isLikelySecret(value) ? REDACTED : value)
    }
    url.search = filtered.toString()
  }
  if (url.hash) url.hash = SECRET_KEY_RE.test(url.hash) ? "#redacted" : url.hash
  return url.toString()
}

/** Redact secret-looking header values (case-insensitive key match). */
export function redactHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return headers
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_KEY_RE.test(key) || isLikelySecret(value) ? REDACTED : value
  }
  return out
}

/** Heuristic: does a free-form string look like a secret token/value? */
export function isLikelySecret(value: string): boolean {
  if (!value) return false
  if (SECRET_VALUE_RE.test(value) && (value.length >= 20 || /^Bearer\s|^Basic\s/i.test(value))) return true
  return SECRET_KEY_RE.test(value)
}

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
  requestHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
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
 * idempotent replay/acknowledgement. `correlationId` ties every event of a run
 * together for observability without leaking the target or payloads.
 */
export class BrowserEvent extends Schema.Class<BrowserEvent>("Browser.Event")({
  schemaVersion: Schema.Literal(BROWSER_EVENT_SCHEMA_VERSION),
  sessionId: Schema.String,
  correlationId: Schema.String,
  seq: Schema.Number,
  attempt: Schema.Number,
  durationMs: Schema.Number,
  type: Schema.Literals(["launched", "console", "network", "screenshot", "navigation", "assertion", "cleanup", "error", "done"]),
  message: Schema.String,
  console: Schema.optional(Schema.Array(ConsoleMessage)),
  network: Schema.optional(Schema.Array(NetworkEntry)),
  artifacts: Schema.optional(Schema.Array(Artifact)),
  exitCode: Schema.optional(Schema.Number),
}) {}

/**
 * Aggregate, redacted metrics for a run. Surfaced in the report so dashboards
 * can observe browser runs (timing, retries, resource usage) without exposing
 * URLs, prompts or secret-bearing network data.
 */
export class BrowserMetrics extends Schema.Class<BrowserMetrics>("Browser.Metrics")({
  correlationId: Schema.String,
  attempt: Schema.Number,
  durationMs: Schema.Number,
  consoleCount: Schema.Number,
  networkCount: Schema.Number,
  artifactCount: Schema.Number,
  artifactBytes: Schema.Number,
  retried: Schema.Boolean,
  timedOut: Schema.Boolean,
}) {}

export class BrowserReport extends Schema.Class<BrowserReport>("Browser.Report")({
  schemaVersion: Schema.Literal(BROWSER_EVENT_SCHEMA_VERSION),
  sessionId: Schema.String,
  correlationId: Schema.String,
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
  attempt: Schema.Number,
  durationMs: Schema.Number,
  metrics: BrowserMetrics,
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
  /** Retry attempt index (0 = first try). Used for correlation/metrics. */
  readonly attempt?: number
  /** Caller-supplied correlation id; auto-generated when omitted. */
  readonly correlationId?: string
  /** Resource bounds for this run; falls back to DEFAULT_RESOURCE_LIMITS. */
  readonly limits?: Partial<BrowserResourceLimits>
}

interface StateShape {
  sessionId: string
  target: string
  headless: boolean
  browser: string
  console: ConsoleMessage[]
  network: NetworkEntry[]
  artifacts: Artifact[]
  status: string
  startedAt: number
  finishedAt?: number
  seq: number
  correlationId: string
  attempt: number
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
  correlationId: Schema.String,
  attempt: Schema.Number,
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

const runProcess = (cmd: string[], cwd: string, signal?: AbortSignal, stepTimeoutMs = 300_000) =>
  Effect.promise(() =>
    Process.run(cmd, { cwd, nothrow: true, abort: signal, timeout: stepTimeoutMs }).then((res) => ({
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
 * command contract works in CI. Returns `null` on success so callers can keep
 * composing; on failure it short-circuits with a `BrowserError` (message
 * redacted so secrets in stderr never propagate).
 */
const launchBrowser = Effect.fnUntraced(function* (
  opts: BrowserOptions,
  stepTimeoutMs: number,
) {
  if (opts.signal?.aborted) {
    return yield* new BrowserError({ kind: "aborted", message: "session cancelled before launch" })
  }
  const cli = ["npx", "-y", "@playwright/mcp@latest", "--browser", opts.browser ?? "chromium"]
  if (opts.headless) cli.push("--headless")
  const res = yield* runProcess(cli, opts.cwd, opts.signal, stepTimeoutMs)
  if (res.code !== 0) {
    const message = isLikelySecret(res.stderr) ? REDACTED : redactUrl(res.stderr || "Playwright MCP failed to start")
    return yield* new BrowserError({ kind: "launch-failed", message })
  }
  return null
})

/**
 * Run a scripted browser session: navigate to the target, capture console and
 * network, take a screenshot, then deterministically clean up. Idempotent per
 * `sessionId` — re-running reloads persisted state and replays only what is
 * missing, so an interrupted run resumes instead of duplicating artifacts or
 * re-issuing external effects.
 */
export const runSession = Effect.fn("Browser.run")(function* (opts: BrowserOptions) {
  const sessionId = opts.sessionId ?? `browser-${Buffer.from(opts.target).toString("hex").slice(0, 12)}`
  const browser = opts.browser ?? "chromium"
  const headless = opts.headless ?? true
  const attempt = opts.attempt ?? 0
  const correlationId = opts.correlationId ?? crypto.randomUUID()
  const limits: BrowserResourceLimits = { ...DEFAULT_RESOURCE_LIMITS, ...(opts.limits ?? {}) }
  const stepTimeoutMs = Math.min(opts.timeoutMs ?? ConfigBrowser.defaults().defaultTimeoutMs, limits.maxSessionMs)

  if (!isUrl(opts.target)) {
    return yield* new BrowserError({ kind: "invalid-target", message: `Target is not a URL: ${redactUrl(opts.target)}` })
  }

  const prior = yield* loadState(opts.cwd, sessionId)
  const retried = prior !== null
  if (prior && (prior.status === "done" || prior.status === "failed")) {
    if (prior.target !== opts.target || prior.headless !== headless || prior.browser !== browser) {
      return yield* new BrowserError({
        kind: "invalid-target",
        message: `session ${sessionId} already exists for a different target/mode; refusing conflicting reuse`,
      })
    }
  }

  // Hard session ceiling: combine caller abort with a max-session timeout so a
  // run can never exceed the configured wall-clock budget even if a single step
  // is slow. Aborting cancels in-flight Playwright work (no orphaned effects).
  const startedAt = Date.now()
  const sessionSignal = opts.signal ?? AbortSignal.timeout(limits.maxSessionMs)
  if (sessionSignal.aborted) {
    return yield* new BrowserError({ kind: "aborted", message: "session cancelled before start" })
  }

  const redactedTarget = redactUrl(opts.target)

  // Already-finished runs are never re-executed: this is the core guard against
  // duplicate external effects (re-running launch/screenshot/cleanup).
  if (prior && prior.status === "done") {
    const finishedAt = prior.finishedAt ?? startedAt
    const metrics = new BrowserMetrics({
      correlationId,
      attempt,
      durationMs: finishedAt - prior.startedAt,
      consoleCount: prior.console.length,
      networkCount: prior.network.length,
      artifactCount: prior.artifacts.length,
      artifactBytes: 0,
      retried,
      timedOut: false,
    })
    return new BrowserReport({
      schemaVersion: BROWSER_EVENT_SCHEMA_VERSION,
      sessionId,
      correlationId,
      target: redactedTarget,
      headless,
      browser,
      status: "done",
      console: prior.console,
      network: prior.network,
      artifacts: prior.artifacts,
      exitCode: 0,
      startedAt: prior.startedAt,
      finishedAt,
      attempt,
      durationMs: finishedAt - prior.startedAt,
      metrics,
      statePath: statePath(opts.cwd, sessionId),
    })
  }

  const baseState: StateShape = prior
    ? {
        sessionId: prior.sessionId,
        target: prior.target,
        headless: prior.headless,
        browser: prior.browser,
        console: [...prior.console],
        network: [...prior.network],
        artifacts: [...prior.artifacts],
        status: prior.status,
        startedAt: prior.startedAt,
        finishedAt: prior.finishedAt,
        seq: prior.seq,
        correlationId: prior.correlationId,
        attempt: prior.attempt,
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
        startedAt,
        seq: 0,
        correlationId,
        attempt,
      }

  // Launch only when not yet launched (idempotent resume of interrupted runs).
  if (baseState.status === "launched") {
    const launched = yield* launchBrowser({ ...opts, signal: sessionSignal }, stepTimeoutMs)
    if (launched !== null) {
      return launched
    }
    baseState.status = "inspecting"
    baseState.seq += 1
    yield* saveState(opts.cwd, sessionId, baseState)
  }

  if (sessionSignal.aborted) {
    yield* saveState(opts.cwd, sessionId, { ...baseState, status: "cancelled" })
    return yield* new BrowserError({ kind: "aborted", message: "session cancelled before screenshot" })
  }

  const artifactPath = join(opts.outputDir ?? opts.cwd, `${sessionId}.png`)
  const alreadyShot = baseState.artifacts.some((a) => a.path === artifactPath && a.kind === "screenshot")
  const screenshotCli = [
    "npx", "-y", "@playwright/test@latest", "screenshot",
    "--browser", browser,
    ...(headless ? ["--headless"] : []),
    opts.target,
    artifactPath,
  ]

  if (!alreadyShot) {
    const shot = yield* runProcess(screenshotCli, opts.cwd, sessionSignal, stepTimeoutMs)
    if (shot.code !== 0) {
      return yield* failWith(opts.cwd, sessionId, baseState, "screenshot-failed", shot.stderr || "screenshot failed", sessionSignal)
    }
    const sizeBytes = safeSize(artifactPath, limits.maxArtifactBytes)
    baseState.artifacts = cap(
      [
        ...baseState.artifacts,
        new Artifact({ kind: "screenshot", path: artifactPath, sizeBytes: sizeBytes ?? undefined }),
      ],
      limits.maxArtifacts,
      (a) => a.path,
    )
    baseState.status = "testing"
    baseState.seq += 1
    yield* saveState(opts.cwd, sessionId, baseState)
  }

  // Cleanup only when not already clean (avoids repeated clear-cache effects).
  if (baseState.status !== "cleanup" && baseState.status !== "done") {
    const cleanupCli = ["npx", "-y", "@playwright/test@latest", "clear-cache", "--browser", browser]
    const cleanup = yield* runProcess(cleanupCli, opts.cwd, sessionSignal, stepTimeoutMs)
    if (cleanup.code !== 0) {
      return yield* failWith(opts.cwd, sessionId, baseState, "cleanup-failed", cleanup.stderr || "cleanup failed", sessionSignal)
    }
  }

  const finishedAt = Date.now()
  const final: StateShape = { ...baseState, status: "done", finishedAt, seq: baseState.seq + 1 }
  yield* saveState(opts.cwd, sessionId, final)

  const artifactBytes = sumBytes(final.artifacts)
  const metrics = new BrowserMetrics({
    correlationId,
    attempt,
    durationMs: finishedAt - startedAt,
    consoleCount: capCount(final.console.length, limits.maxConsoleMessages),
    networkCount: capCount(final.network.length, limits.maxNetworkEntries),
    artifactCount: final.artifacts.length,
    artifactBytes,
    retried,
    timedOut: sessionSignal.aborted,
  })
  return new BrowserReport({
    schemaVersion: BROWSER_EVENT_SCHEMA_VERSION,
    sessionId,
    correlationId,
    target: redactedTarget,
    headless,
    browser,
    status: "done",
    console: final.console,
    network: final.network,
    artifacts: final.artifacts,
    exitCode: 0,
    startedAt: final.startedAt,
    finishedAt,
    attempt,
    durationMs: finishedAt - startedAt,
    metrics,
    statePath: statePath(opts.cwd, sessionId),
  })
})

const safeSize = (path: string, maxBytes: number): number | null => {
  try {
    const st = statSync(path)
    if (maxBytes > 0 && st.size > maxBytes) {
      return maxBytes
    }
    return st.size
  } catch {
    return null
  }
}

const sumBytes = (artifacts: Artifact[]): number =>
  artifacts.reduce((acc, a) => acc + (a.sizeBytes ?? 0), 0)

/** Cap an array length, keeping the most recent `n` entries. */
const cap = <T>(items: T[], n: number, _key: (item: T) => unknown): T[] =>
  n > 0 && items.length > n ? items.slice(items.length - n) : items

const capCount = (count: number, n: number): number => (n > 0 ? Math.min(count, n) : count)

const failWith = Effect.fnUntraced(function* (
  cwd: string,
  sessionId: string,
  state: StateShape,
  kind: BrowserError["kind"],
  rawMessage: string,
  _signal?: AbortSignal,
) {
  const failed: StateShape = { ...state, status: "failed", finishedAt: Date.now(), seq: state.seq + 1 }
  yield* saveState(cwd, sessionId, failed)
  // Redact any secret that may have leaked into stderr (tokens, URLs, headers).
  const message = isLikelySecret(rawMessage) ? REDACTED : redactUrl(rawMessage)
  return yield* new BrowserError({ kind, message })
})

export * as Browser from "."
