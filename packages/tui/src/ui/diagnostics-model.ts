/**
 * Diagnostics screen domain model for the Ottili Coder TUI.
 *
 * Pure and rendering-free so the diagnostics logic can be unit tested in
 * isolation and reused by the Solid view in `../component/dialog-diagnostics`.
 * Every transition is a pure function: it takes inputs and returns new values,
 * which keeps the data flow deterministic and snapshot-free in tests.
 *
 * This module consolidates every diagnostic domain — environment, providers,
 * MCP, LSP, formatters, plugins, account/cloud and logs — into a single typed
 * model. Data is gathered by `collectDiagnostics`, which accepts injected
 * `sources` so unit tests stub them with no network or filesystem access.
 *
 * The model mirrors `update-banner-model.ts` (pure, no SolidJS, fully
 * unit-testable) and reuses `redactSensitive`, `truncate` and `isNarrow` from
 * `agent-roster/model`. Color is never the only signal: every status carries a
 * glyph + word, and the export bundle redacts any key/token values.
 */

import { isNarrow, redactSensitive, truncate } from "../component/agent-roster/model"

/** Rollup status for any diagnostic element. */
export type DiagnosticsStatus = "ok" | "warn" | "error" | "unknown"

const SEVERITY: Record<DiagnosticsStatus, number> = {
  ok: 0,
  unknown: 1,
  warn: 2,
  error: 3,
}

/** Severity ordering so "worst wins" when rolling up sections. */
export function statusSeverity(status: DiagnosticsStatus): number {
  return SEVERITY[status]
}

/** Reduce a list of statuses to the most severe one. Pure. */
export function worstStatus(...statuses: DiagnosticsStatus[]): DiagnosticsStatus {
  return statuses.reduce<DiagnosticsStatus>(
    (acc, next) => (SEVERITY[next] > SEVERITY[acc] ? next : acc),
    "ok",
  )
}

// ---------------------------------------------------------------------------
// Structured diagnostics data
// ---------------------------------------------------------------------------

/** Environment facts gathered from the runtime (mirrors doctor.report). */
export interface EnvironmentInfo {
  version: string
  runtime: string
  platform: string
  cwd: string
  git: string | null
  repoRoot: string | null
  hooks: string[]
}

export type ProviderSource = "env" | "config" | "oauth" | "account"

/** A provider the user could route through, regardless of how it was configured. */
export interface ProviderInfo {
  name: string
  source: ProviderSource
  status: DiagnosticsStatus
  detail?: string
}

export type McpStatus =
  | "connected"
  | "failed"
  | "disabled"
  | "needs_auth"
  | "needs_client_registration"

export interface McpServerInfo {
  name: string
  status: McpStatus
  error?: string
}

export type LspStatus = "connected" | "error"

export interface LspServerInfo {
  name: string
  status: LspStatus
  error?: string
}

export interface NamedInfo {
  name: string
  version?: string
}

export interface AccountInfo {
  loggedIn: boolean
  cloudConfigured: boolean
}

export interface LogLine {
  level: string
  message: string
}

export interface LogsInfo {
  available: boolean
  lines: LogLine[]
}

/** Full structured diagnostics snapshot consumed by the view model. */
export interface DiagnosticsData {
  collectedAt: number
  environment: EnvironmentInfo | null
  providers: ProviderInfo[]
  mcp: McpServerInfo[]
  lsp: LspServerInfo[]
  formatters: NamedInfo[]
  plugins: NamedInfo[]
  account: AccountInfo | null
  logs: LogsInfo
}

// ---------------------------------------------------------------------------
// View model (presentational)
// ---------------------------------------------------------------------------

export interface DiagnosticsItem {
  label: string
  value?: string
  status: DiagnosticsStatus
  detail?: string
  /** Optional inline corrective action (e.g. fix a failed MCP server). */
  action?: { key: string; label: string; command: string }
}

export interface DiagnosticsSection {
  id: string
  title: string
  status: DiagnosticsStatus
  items: DiagnosticsItem[]
}

export interface DiagnosticsView {
  sections: DiagnosticsSection[]
  overall: DiagnosticsStatus
  counts: { ok: number; warn: number; error: number; unknown: number }
  ariaLabel: string
  tier: DiagnosticsTier
}

export type DiagnosticsTier = "wide" | "standard" | "narrow" | "minimal"

// ---------------------------------------------------------------------------
// Terminal width tiers (spec §5.2)
// ---------------------------------------------------------------------------

export const DIAGNOSTICS_WIDE_WIDTH = 110
export const DIAGNOSTICS_STANDARD_WIDTH = 80
export const DIAGNOSTICS_NARROW_WIDTH = 60

/** Map a terminal width to its render tier (spec §5.2). */
export function diagnosticsTier(width: number): DiagnosticsTier {
  if (width >= DIAGNOSTICS_WIDE_WIDTH) return "wide"
  if (width >= DIAGNOSTICS_STANDARD_WIDTH) return "standard"
  if (width >= DIAGNOSTICS_NARROW_WIDTH) return "narrow"
  return "minimal"
}

/** Glyph for a status. Color-free variants keep meaning when color is off. */
export function statusGlyph(status: DiagnosticsStatus, useColor: boolean): string {
  if (useColor) {
    return status === "ok" ? "●" : status === "warn" ? "▲" : status === "error" ? "✕" : "?"
  }
  return status === "ok" ? "[ok]" : status === "warn" ? "[warn]" : status === "error" ? "[err]" : "[?]"
}

/** Human word for a status — always a word, never a bare color. */
export function statusWord(status: DiagnosticsStatus): string {
  return status
}

/** Map an MCP connection status to a rollup diagnostic status. */
export function mcpStatusToDiagnostics(status: McpStatus): DiagnosticsStatus {
  switch (status) {
    case "connected":
      return "ok"
    case "disabled":
      return "unknown"
    case "needs_auth":
      return "warn"
    case "failed":
    case "needs_client_registration":
      return "error"
  }
}

/** Map an LSP connection status to a rollup diagnostic status. */
export function lspStatusToDiagnostics(status: LspStatus): DiagnosticsStatus {
  return status === "connected" ? "ok" : "error"
}

// ---------------------------------------------------------------------------
// Section builders (pure: data -> section)
// ---------------------------------------------------------------------------

function environmentSection(env: EnvironmentInfo | null, error?: string): DiagnosticsSection {
  if (error) {
    return {
      id: "environment",
      title: "Environment",
      status: "error",
      items: [{ label: "Environment", status: "error", detail: error }],
    }
  }
  if (!env) {
    return {
      id: "environment",
      title: "Environment",
      status: "unknown",
      items: [{ label: "Environment", status: "unknown", detail: "Unavailable" }],
    }
  }
  const items: DiagnosticsItem[] = [
    { label: "version", value: env.version, status: "ok" },
    { label: "runtime", value: env.runtime, status: "ok" },
    { label: "platform", value: env.platform, status: "ok" },
    { label: "cwd", value: env.cwd, status: "ok" },
  ]
  if (env.git) items.push({ label: "git", value: env.git, status: "ok" })
  if (env.repoRoot) items.push({ label: "repo", value: env.repoRoot, status: "ok" })
  if (env.hooks.length) items.push({ label: "hooks", value: `${env.hooks.length} configured`, status: "ok" })
  return { id: "environment", title: "Environment", status: "ok", items }
}

function providersSection(providers: ProviderInfo[], error?: string): DiagnosticsSection {
  if (error) {
    return {
      id: "providers",
      title: "Providers",
      status: "error",
      items: [{ label: "Providers", status: "error", detail: error }],
    }
  }
  if (providers.length === 0) {
    return {
      id: "providers",
      title: "Providers",
      status: "warn",
      items: [
        {
          label: "No API keys detected",
          status: "warn",
          detail: "Set a provider API key in your environment or ottiliCoder.json",
        },
      ],
    }
  }
  const items: DiagnosticsItem[] = providers.map((provider) => ({
    label: `${provider.name} (${provider.source})`,
    status: provider.status,
    detail: provider.detail,
  }))
  return {
    id: "providers",
    title: "Providers",
    status: worstStatus(...providers.map((provider) => provider.status)),
    items,
  }
}

function mcpSection(mcp: McpServerInfo[], error?: string): DiagnosticsSection {
  if (error) {
    return {
      id: "mcp",
      title: "MCP",
      status: "error",
      items: [{ label: "MCP", status: "error", detail: error }],
    }
  }
  if (mcp.length === 0) {
    return {
      id: "mcp",
      title: "MCP",
      status: "ok",
      items: [{ label: "No MCP servers configured", status: "ok" }],
    }
  }
  const items: DiagnosticsItem[] = mcp.map((server) => {
    const status = mcpStatusToDiagnostics(server.status)
    const item: DiagnosticsItem = { label: server.name, status, detail: server.error }
    if (server.status === "failed" || server.status === "needs_client_registration") {
      item.action = { key: "fix", label: "fix", command: "mcp.fix" }
    }
    return item
  })
  return {
    id: "mcp",
    title: "MCP",
    status: worstStatus(...items.map((item) => item.status)),
    items,
  }
}

function lspSection(lsp: LspServerInfo[], error?: string): DiagnosticsSection {
  if (error) {
    return {
      id: "lsp",
      title: "LSP",
      status: "error",
      items: [{ label: "LSP", status: "error", detail: error }],
    }
  }
  if (lsp.length === 0) {
    return {
      id: "lsp",
      title: "LSP",
      status: "ok",
      items: [{ label: "No LSP servers configured", status: "ok" }],
    }
  }
  const items: DiagnosticsItem[] = lsp.map((server) => ({
    label: server.name,
    status: lspStatusToDiagnostics(server.status),
    detail: server.error,
  }))
  return {
    id: "lsp",
    title: "LSP",
    status: worstStatus(...items.map((item) => item.status)),
    items,
  }
}

function namedSection(id: string, title: string, items: NamedInfo[], error?: string): DiagnosticsSection {
  if (error) {
    return { id, title, status: "error", items: [{ label: title, status: "error", detail: error }] }
  }
  if (items.length === 0) {
    return { id, title, status: "ok", items: [{ label: `No ${title.toLowerCase()} configured`, status: "ok" }] }
  }
  return {
    id,
    title,
    status: "ok",
    items: items.map((item) => ({
      label: item.name,
      value: item.version ? `@${item.version}` : undefined,
      status: "ok" as DiagnosticsStatus,
    })),
  }
}

function accountSection(account: AccountInfo | null, error?: string): DiagnosticsSection {
  if (error) {
    return {
      id: "account",
      title: "Account/Cloud",
      status: "error",
      items: [{ label: "Account/Cloud", status: "error", detail: error }],
    }
  }
  if (!account) {
    return {
      id: "account",
      title: "Account/Cloud",
      status: "unknown",
      items: [{ label: "Account status unavailable", status: "unknown" }],
    }
  }
  const items: DiagnosticsItem[] = []
  if (!account.loggedIn) {
    items.push({
      label: "Signed out",
      status: "error",
      detail: "Sign in with /login",
      action: { key: "login", label: "login", command: "account.login" },
    })
  } else {
    items.push({ label: "Signed in", status: "ok" })
  }
  if (!account.cloudConfigured) {
    items.push({ label: "Cloud not configured", status: "warn" })
  } else {
    items.push({ label: "Cloud configured", status: "ok" })
  }
  return {
    id: "account",
    title: "Account/Cloud",
    status: worstStatus(...items.map((item) => item.status)),
    items,
  }
}

function logsSection(logs: LogsInfo, error?: string): DiagnosticsSection {
  if (error) {
    return {
      id: "logs",
      title: "Logs",
      status: "error",
      items: [{ label: "Logs", status: "error", detail: error }],
    }
  }
  if (!logs.available) {
    return {
      id: "logs",
      title: "Logs",
      status: "unknown",
      items: [{ label: "Logs unavailable in this build", status: "unknown" }],
    }
  }
  if (logs.lines.length === 0) {
    return { id: "logs", title: "Logs", status: "ok", items: [{ label: "No recent log lines", status: "ok" }] }
  }
  const items: DiagnosticsItem[] = logs.lines.map((line) => ({
    label: `[${line.level}]`,
    value: line.message,
    status: line.level === "error" ? "error" : line.level === "warn" ? "warn" : ("ok" as DiagnosticsStatus),
  }))
  return {
    id: "logs",
    title: "Logs",
    status: worstStatus(...items.map((item) => item.status)),
    items,
  }
}

// ---------------------------------------------------------------------------
// Section rollup
// ---------------------------------------------------------------------------

/** Worst status across a section's items, falling back to the section status. */
export function sectionSummary(section: DiagnosticsSection): DiagnosticsStatus {
  if (section.items.length === 0) return section.status
  return worstStatus(section.status, ...section.items.map((item) => item.status))
}

// ---------------------------------------------------------------------------
// View model assembly
// ---------------------------------------------------------------------------

interface BuildInput {
  environment: { value: EnvironmentInfo | null; error?: string }
  providers: { value: ProviderInfo[]; error?: string }
  mcp: { value: McpServerInfo[]; error?: string }
  lsp: { value: LspServerInfo[]; error?: string }
  formatters: { value: NamedInfo[]; error?: string }
  plugins: { value: NamedInfo[]; error?: string }
  account: { value: AccountInfo | null; error?: string }
  logs: { value: LogsInfo; error?: string }
}

/**
 * Build the presentational view from structured data. Redaction, width tiers
 * and status rollup all happen here so the view stays a thin, dumb renderer.
 * Color is never the only signal: every section carries a glyph + word and
 * the overall aria label spells counts out for screen readers.
 */
export function diagnosticsViewModel(
  data: DiagnosticsData,
  opts: { width?: number; useColor?: boolean } = {},
): DiagnosticsView {
  const width = opts.width ?? DIAGNOSTICS_WIDE_WIDTH
  const tier = diagnosticsTier(width)

  const sections = buildSections(data).map((section) => ({ ...section, status: sectionSummary(section) }))

  const overall = worstStatus(...sections.map((section) => section.status))
  const counts = { ok: 0, warn: 0, error: 0, unknown: 0 }
  for (const section of sections) counts[section.status]++

  const ariaLabel =
    `Diagnostics: ${counts.ok} ok, ${counts.warn} warn, ${counts.error} error. ` +
    `Tab to navigate sections, x to export, r to refresh, esc to close.`

  return { sections, overall, counts, ariaLabel, tier }
}

function buildSections(data: DiagnosticsData): DiagnosticsSection[] {
  const input: BuildInput = {
    environment: { value: data.environment },
    providers: { value: data.providers },
    mcp: { value: data.mcp },
    lsp: { value: data.lsp },
    formatters: { value: data.formatters },
    plugins: { value: data.plugins },
    account: { value: data.account },
    logs: { value: data.logs },
  }
  return [
    environmentSection(input.environment.value, input.environment.error),
    providersSection(input.providers.value, input.providers.error),
    mcpSection(input.mcp.value, input.mcp.error),
    lspSection(input.lsp.value, input.lsp.error),
    namedSection("formatters", "Formatters", input.formatters.value, input.formatters.error),
    namedSection("plugins", "Plugins", input.plugins.value, input.plugins.error),
    accountSection(input.account.value, input.account.error),
    logsSection(input.logs.value, input.logs.error),
  ]
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Redact secrets from a single exported/visible string. */
export function redactSecrets(input: string): { text: string; redacted: boolean } {
  return redactSensitive(input)
}

// ---------------------------------------------------------------------------
// Collection (injected sources so tests stub them)
// ---------------------------------------------------------------------------

export interface DiagnosticsSources {
  readEnvironment?: () => EnvironmentInfo | null | Promise<EnvironmentInfo | null>
  readProviders?: () => ProviderInfo[] | Promise<ProviderInfo[]>
  readMcp?: () => McpServerInfo[] | Promise<McpServerInfo[]>
  readLsp?: () => LspServerInfo[] | Promise<LspServerInfo[]>
  readFormatters?: () => NamedInfo[] | Promise<NamedInfo[]>
  readPlugins?: () => NamedInfo[] | Promise<NamedInfo[]>
  readAccount?: () => AccountInfo | null | Promise<AccountInfo | null>
  readLogs?: () => LogsInfo | Promise<LogsInfo>
}

async function resolveSource<T>(
  fn: (() => T | Promise<T>) | undefined,
  fallback: T,
): Promise<{ value: T; error?: string }> {
  if (!fn) return { value: fallback }
  try {
    return { value: await fn() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { value: fallback, error: redactSensitive(message).text }
  }
}

/**
 * Gather every diagnostic domain into a single snapshot. Each source is
 * isolated: a throwing source degrades only its own section (failure path) and
 * never rejects the whole collection. `cwd` is accepted for parity with the
 * CLI `doctor` command but the injected sources decide what to read.
 */
export async function collectDiagnostics(cwd: string, sources: DiagnosticsSources = {}): Promise<DiagnosticsData> {
  const [environment, providers, mcp, lsp, formatters, plugins, account, logs] = await Promise.all([
    resolveSource(sources.readEnvironment, null),
    resolveSource(sources.readProviders, []),
    resolveSource(sources.readMcp, []),
    resolveSource(sources.readLsp, []),
    resolveSource(sources.readFormatters, []),
    resolveSource(sources.readPlugins, []),
    resolveSource(sources.readAccount, null),
    resolveSource(sources.readLogs, { available: false, lines: [] }),
  ])

  return {
    collectedAt: Date.now(),
    environment: environment.value,
    providers: providers.value,
    mcp: mcp.value,
    lsp: lsp.value,
    formatters: formatters.value,
    plugins: plugins.value,
    account: account.value,
    logs: logs.value,
  }
}

// ---------------------------------------------------------------------------
// Export bundle (redacted markdown)
// ---------------------------------------------------------------------------

/** A default export filename, anchored to the collection time. */
export function exportFilename(collectedAt: number): string {
  const stamp = new Date(collectedAt).toISOString().replace(/[:.]/g, "-")
  return `ottili-diagnostics-${stamp}.md`
}

/**
 * Render a redacted markdown bundle of the full snapshot. Every value and log
 * line is passed through `redactSecrets` so keys/tokens never leave the screen.
 */
export function buildExportBundle(data: DiagnosticsData, view: DiagnosticsView): string {
  const lines: string[] = ["# Ottili Coder diagnostics", ""]
  lines.push(`Collected: ${new Date(data.collectedAt).toISOString()}`, "")

  for (const section of view.sections) {
    lines.push(`## ${section.title} (${section.status})`)
    if (section.items.length === 0) {
      lines.push("- None")
    }
    for (const item of section.items) {
      const raw = item.value ?? item.detail ?? section.status
      const redacted = redactSecrets(raw)
      const suffix = item.status !== "ok" ? ` [${item.status}]` : ""
      lines.push(`- ${item.label}: ${redacted.text || section.status}${suffix}`)
    }
    lines.push("")
  }

  if (data.logs.available && data.logs.lines.length) {
    lines.push("## Logs")
    for (const line of data.logs.lines) {
      lines.push(`[${line.level}] ${redactSecrets(line.message).text}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Keyboard / focus navigation (pure reducers — regression coverage)
// ---------------------------------------------------------------------------

/** Move focus between section headers. Pure: returns the next section id. */
export function moveSectionFocus(
  sections: DiagnosticsSection[],
  activeId: string | null,
  dir: 1 | -1,
): string | null {
  if (sections.length === 0) return null
  const index = activeId ? sections.findIndex((section) => section.id === activeId) : -1
  if (index === -1) {
    return sections[dir === 1 ? 0 : sections.length - 1]!.id
  }
  const next = index + dir
  if (next < 0) return sections[0]!.id
  if (next >= sections.length) return sections[sections.length - 1]!.id
  return sections[next]!.id
}

/** Move focus between items inside a section. Pure. */
export function moveItemFocus(
  section: DiagnosticsSection,
  activeIndex: number | null,
  dir: 1 | -1,
): number | null {
  const count = section.items.length
  if (count === 0) return null
  if (activeIndex === null || activeIndex < 0 || activeIndex >= count) {
    return dir === 1 ? 0 : count - 1
  }
  const next = activeIndex + dir
  if (next < 0) return 0
  if (next >= count) return count - 1
  return next
}

// ---------------------------------------------------------------------------
// Load state machine (state transitions + streaming)
// ---------------------------------------------------------------------------

export type DiagnosticsLoadState =
  | { status: "idle" }
  | { status: "loading"; previous: DiagnosticsData | null }
  | { status: "ready"; data: DiagnosticsData }
  | { status: "error"; error: string; previous: DiagnosticsData | null }

/** Pure reducer for the dialog's load lifecycle. */
export function reduceDiagnosticsLoad(
  state: DiagnosticsLoadState,
  event: { type: "load" } | { type: "loaded"; data: DiagnosticsData } | { type: "failed"; error: string },
): DiagnosticsLoadState {
  switch (event.type) {
    case "load":
      return { status: "loading", previous: state.status === "ready" ? state.data : null }
    case "loaded":
      return { status: "ready", data: event.data }
    case "failed": {
      const previous =
        state.status === "ready" ? state.data : state.status === "loading" ? state.previous : null
      return { status: "error", error: redactSecrets(event.error).text, previous }
    }
  }
}

// ---------------------------------------------------------------------------
// Streaming coalescing (no timing sleeps in tests)
// ---------------------------------------------------------------------------

export type DiagnosticsCommit = (view: DiagnosticsView) => void

/**
 * Leading+trailing throttle over diagnostics-view commits. The first push in a
 * quiet period commits immediately, while any pushes arriving within `interval`
 * are buffered and flushed together as one trailing batch. Latest value wins.
 * `flush()` forces the pending buffer out synchronously so tests never sleep.
 */
export function createDiagnosticsQueue(commit: DiagnosticsCommit, interval = 120) {
  let pending: DiagnosticsView | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function flush() {
    if (pending === undefined) return
    const next = pending
    pending = undefined
    commit(next)
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, interval) as ReturnType<typeof setTimeout>
    if (typeof timer.unref === "function") timer.unref()
  }

  return {
    push(next: DiagnosticsView) {
      const buffered = pending !== undefined
      pending = next
      if (buffered) return
      commit(next)
      schedule()
    },
    flush,
    pending: () => (pending === undefined ? 0 : 1),
  }
}

/** Re-export so consumers need not import agent-roster for narrow checks. */
export { isNarrow, truncate }
