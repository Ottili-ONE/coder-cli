/**
 * Diagnostics domain model for the Ottili Coder TUI.
 *
 * Pure and rendering-free so the diagnostics logic can be unit tested in
 * isolation and reused by the Solid view in `../component/dialog-diagnostics.tsx`.
 * Every transition is a pure function: it takes inputs and returns new values,
 * which keeps the data flow deterministic and snapshot-free in tests.
 *
 * The model mirrors the patterns established by `update-banner-model.ts` and
 * `agent-roster/model.ts`. It reuses `redactSensitive`, `truncate` and
 * `isNarrow` from the agent roster model, exactly as `update-banner-model.ts`
 * already does, so secrets are never rendered and the surface stays within a
 * predictable render budget.
 *
 * Data collection is fully injectable: `collectDiagnostics` accepts a
 * `DiagnosticsSources` object that the view assembles from real application
 * state (`useSync()`, `process`, `useSDK()`). Unit tests pass stubbed sources
 * so no network or filesystem access is required.
 */

import { redactSensitive, truncate, isNarrow } from "../component/agent-roster/model"

/** Rollup health of a single diagnostics domain (section) or the whole surface. */
export type DiagnosticsStatus = "ok" | "warn" | "error" | "unknown"

/** A single key/value field rendered as `key: value` (env, runtime, cwd, …). */
export interface DiagnosticsField {
  key: string
  value: string
  /** When true the value is run through `redactSecrets` before display/export. */
  redact?: boolean
}

/** A single row inside a section (an MCP server, a provider, an account, …). */
export interface DiagnosticsItem {
  label: string
  detail?: string
  status: DiagnosticsStatus
  /** Optional corrective deep-link, e.g. open the MCP dialog to fix a failed server. */
  fix?: { command: string; label: string }
}

/** A collapsible diagnostics section shown in the dialog. */
export interface DiagnosticsSection {
  id: string
  title: string
  status: DiagnosticsStatus
  collapsed: boolean
  fields: DiagnosticsField[]
  items: DiagnosticsItem[]
  /** Shown when the section is empty or otherwise has nothing actionable. */
  note?: string
}

/** The full structured diagnostics payload consumed by the view. */
export interface DiagnosticsData {
  sections: DiagnosticsSection[]
}

// ---------------------------------------------------------------------------
// Source shapes (structural; the view maps SDK types into these)
// ---------------------------------------------------------------------------

export interface DiagnosticsMcpLike {
  status: "connected" | "failed" | "disabled" | "needs_auth" | "needs_client_registration"
  error?: string
}

export interface DiagnosticsLspLike {
  id: string
  root: string
  status: "connected" | "error"
}

export interface DiagnosticsFormatterLike {
  name: string
  enabled: boolean
}

export interface DiagnosticsPluginLike {
  name: string
  version?: string
}

export interface DiagnosticsProviderSource {
  name: string
  source: "env" | "config" | "oauth" | "account"
  status: DiagnosticsStatus
}

export interface DiagnosticsAccountLike {
  loggedIn: boolean
  email?: string
  orgName?: string
}

export interface DiagnosticsCloudLike {
  configured: boolean
  activeJobs?: number
}

export interface DiagnosticsLogsLike {
  available: boolean
  lines: string[]
}

/**
 * Everything `collectDiagnostics` needs, gathered by the view from real state.
 * Keeping this the single input keeps the model pure and unit-testable.
 */
export interface DiagnosticsSources {
  version: string
  cwd: string
  env: Record<string, string | undefined>
  runtime: { bun?: string; node: string }
  platform: { platform: string; arch: string }
  git?: { version?: string; root?: string; branch?: string }
  hooks?: string[]
  providers: DiagnosticsProviderSource[]
  mcp: Record<string, DiagnosticsMcpLike>
  lsp: DiagnosticsLspLike[]
  formatter: DiagnosticsFormatterLike[]
  plugins: DiagnosticsPluginLike[]
  accountStatus: DiagnosticsAccountLike
  cloudStatus: DiagnosticsCloudLike
  logs?: DiagnosticsLogsLike
}

// ---------------------------------------------------------------------------
// Status rollup helpers
// ---------------------------------------------------------------------------

/** Worst-case status across a set (error > warn > unknown > ok). */
export function worstStatus(statuses: DiagnosticsStatus[]): DiagnosticsStatus {
  if (statuses.includes("error")) return "error"
  if (statuses.includes("warn")) return "warn"
  if (statuses.includes("unknown")) return "unknown"
  return "ok"
}

/** Single-glyph status marker; color is never the only signal (a word always accompanies it). */
export function statusGlyph(status: DiagnosticsStatus, useColor = true): string {
  if (useColor) {
    switch (status) {
      case "ok":
        return "●"
      case "warn":
        return "▲"
      case "error":
        return "✕"
      case "unknown":
        return "?"
    }
  }
  switch (status) {
    case "ok":
      return "[ok]"
    case "warn":
      return "[warn]"
    case "error":
      return "[err]"
    case "unknown":
      return "[?]"
  }
}

/** Spelled-out status word so color-blind / no-color terminals stay legible. */
export function statusWord(status: DiagnosticsStatus): string {
  switch (status) {
    case "ok":
      return "ok"
    case "warn":
      return "warn"
    case "error":
      return "error"
    case "unknown":
      return "unknown"
  }
}

/** Color-role token the view maps onto an Ottili palette color. */
export function statusColorRole(status: DiagnosticsStatus): "success" | "warning" | "error" | "info" | "text" {
  switch (status) {
    case "ok":
      return "success"
    case "warn":
      return "warning"
    case "error":
      return "error"
    case "unknown":
      return "info"
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/** Environment: version, runtime, platform, cwd, git and hooks. */
export function buildEnvironmentSection(s: DiagnosticsSources): DiagnosticsSection {
  const fields: DiagnosticsField[] = [
    { key: "version", value: s.version },
    { key: "runtime", value: `bun ${s.runtime.bun ?? "n/a"} / node ${s.runtime.node}` },
    { key: "platform", value: `${s.platform.platform} ${s.platform.arch}` },
    { key: "cwd", value: s.cwd },
  ]
  if (s.git) {
    fields.push({ key: "git", value: s.git.version ?? "unknown" })
    if (s.git.root) fields.push({ key: "repo root", value: s.git.root })
    if (s.git.branch) fields.push({ key: "branch", value: s.git.branch })
  } else {
    fields.push({ key: "git", value: "not a git repository" })
  }
  if (s.hooks && s.hooks.length) fields.push({ key: "hooks", value: s.hooks.join(", ") })

  return { id: "environment", title: "Environment", status: "ok", collapsed: false, fields, items: [] }
}

/** Providers: unified from env keys, config and account sign-in. */
export function buildProvidersSection(s: DiagnosticsSources): DiagnosticsSection {
  const items: DiagnosticsItem[] = s.providers.map((p) => ({
    label: p.name,
    detail: `source: ${p.source}`,
    status: p.status,
  }))

  if (items.length === 0) {
    return {
      id: "providers",
      title: "Providers",
      status: "warn",
      collapsed: false,
      fields: [],
      items: [],
      note: "No API keys detected — set a provider API key in your environment or configure it via ottiliCoder.json / your account.",
    }
  }

  return { id: "providers", title: "Providers", status: worstStatus(items.map((i) => i.status)), collapsed: false, fields: [], items }
}

/** MCP servers with corrective deep-links for failed / needs-auth states. */
export function buildMcpSection(mcp: Record<string, DiagnosticsMcpLike>): DiagnosticsSection {
  const items: DiagnosticsItem[] = Object.entries(mcp).map(([name, m]) => {
    switch (m.status) {
      case "connected":
        return { label: name, detail: "Connected", status: "ok" }
      case "disabled":
        return { label: name, detail: "Disabled in configuration", status: "ok" }
      case "failed":
        return {
          label: name,
          detail: m.error ?? "Failed",
          status: "error",
          fix: { command: "ottiliCoder.mcp", label: "fix" },
        }
      case "needs_auth":
        return {
          label: name,
          detail: `Needs authentication (run: ottili-coder mcp auth ${name})`,
          status: "warn",
          fix: { command: "ottiliCoder.mcp", label: "fix" },
        }
      case "needs_client_registration":
        return {
          label: name,
          detail: m.error ?? "Needs client registration",
          status: "error",
          fix: { command: "ottiliCoder.mcp", label: "fix" },
        }
    }
  })

  if (items.length === 0) {
    return { id: "mcp", title: "MCP", status: "ok", collapsed: false, fields: [], items, note: "None configured" }
  }

  return { id: "mcp", title: "MCP", status: worstStatus(items.map((i) => i.status)), collapsed: false, fields: [], items }
}

/** LSP servers. */
export function buildLspSection(lsp: DiagnosticsLspLike[]): DiagnosticsSection {
  const items = lsp.map((l) => ({ label: l.id, detail: l.root, status: l.status === "connected" ? "ok" : "error" }))
  if (items.length === 0) {
    return { id: "lsp", title: "LSP", status: "ok", collapsed: false, fields: [], items, note: "None configured" }
  }
  return { id: "lsp", title: "LSP", status: worstStatus(items.map((i) => i.status)), collapsed: false, fields: [], items }
}

/** Enabled formatters. */
export function buildFormattersSection(formatter: DiagnosticsFormatterLike[]): DiagnosticsSection {
  const items = formatter
    .filter((f) => f.enabled)
    .map((f) => ({ label: f.name, status: "ok" as DiagnosticsStatus }))
  if (items.length === 0) {
    return { id: "formatters", title: "Formatters", status: "ok", collapsed: false, fields: [], items, note: "None configured" }
  }
  return { id: "formatters", title: "Formatters", status: "ok", collapsed: false, fields: [], items }
}

/** Installed plugins. */
export function buildPluginsSection(plugins: DiagnosticsPluginLike[]): DiagnosticsSection {
  const items = plugins.map((p) => ({
    label: p.version ? `${p.name} @${p.version}` : p.name,
    status: "ok" as DiagnosticsStatus,
  }))
  if (items.length === 0) {
    return { id: "plugins", title: "Plugins", status: "ok", collapsed: false, fields: [], items, note: "None configured" }
  }
  return { id: "plugins", title: "Plugins", status: "ok", collapsed: false, fields: [], items }
}

/** Account / Cloud sign-in and connection state. */
export function buildAccountCloudSection(
  account: DiagnosticsAccountLike,
  cloud: DiagnosticsCloudLike,
): DiagnosticsSection {
  const items: DiagnosticsItem[] = []

  if (account.loggedIn) {
    const org = account.orgName ? ` · ${account.orgName}` : ""
    items.push({ label: "Ottili Account", detail: `${account.email ?? "signed in"}${org}`, status: "ok" })
  } else {
    items.push({
      label: "Ottili Account",
      detail: "Not signed in",
      status: "warn",
      fix: { command: "ottiliCoder.account.login", label: "sign in" },
    })
  }

  if (cloud.configured) {
    const jobs = cloud.activeJobs !== undefined ? ` · ${cloud.activeJobs} active job(s)` : ""
    items.push({ label: "Ottili Cloud", detail: `configured${jobs}`, status: "ok" })
  } else {
    items.push({ label: "Ottili Cloud", detail: "Not configured", status: "warn" })
  }

  return { id: "account-cloud", title: "Account / Cloud", status: worstStatus(items.map((i) => i.status)), collapsed: false, fields: [], items }
}

/** Recent logs. Honest fallback when no readable source exists (no fabrication). */
export function buildLogsSection(logs?: DiagnosticsLogsLike): DiagnosticsSection {
  if (!logs || !logs.available) {
    return {
      id: "logs",
      title: "Logs",
      status: "unknown",
      collapsed: false,
      fields: [],
      items: [],
      note: "Logs unavailable in this build",
    }
  }
  const items = logs.lines
    .slice(-200)
    .map((line) => ({ label: line, status: "ok" as DiagnosticsStatus }))
  return { id: "logs", title: "Logs", status: "ok", collapsed: true, fields: [], items }
}

/** Assemble the full structured payload from injected sources. */
export function collectDiagnostics(sources: DiagnosticsSources): DiagnosticsData {
  return {
    sections: [
      buildEnvironmentSection(sources),
      buildProvidersSection(sources),
      buildMcpSection(sources.mcp),
      buildLspSection(sources.lsp),
      buildFormattersSection(sources.formatter),
      buildPluginsSection(sources.plugins),
      buildAccountCloudSection(sources.accountStatus, sources.cloudStatus),
      buildLogsSection(sources.logs),
    ],
  }
}

// ---------------------------------------------------------------------------
// Rollups + view model
// ---------------------------------------------------------------------------

/** Summary status of a section (its own rolled-up status). */
export function sectionSummary(section: DiagnosticsSection): DiagnosticsStatus {
  return section.status
}

/** Worst status across every section — the dialog's headline status. */
export function overallStatus(data: DiagnosticsData): DiagnosticsStatus {
  return worstStatus(data.sections.map((s) => s.status))
}

/** Count of sections per status, used by the compact/width-tiered layouts. */
export function diagnosticsCounts(data: DiagnosticsData): { ok: number; warn: number; error: number; unknown: number } {
  const counts = { ok: 0, warn: 0, error: 0, unknown: 0 }
  for (const section of data.sections) counts[section.status]++
  return counts
}

// ---------------------------------------------------------------------------
// Terminal width tiers (spec §5.2)
// ---------------------------------------------------------------------------

export const DIAGNOSTICS_WIDE_WIDTH = 110
export const DIAGNOSTICS_STANDARD_WIDTH = 80
export const DIAGNOSTICS_NARROW_WIDTH = 60

export type DiagnosticsTier = "wide" | "standard" | "narrow" | "minimal"

/** Map a terminal width to its render tier (spec §5.2). */
export function diagnosticsTier(width: number): DiagnosticsTier {
  if (width >= DIAGNOSTICS_WIDE_WIDTH) return "wide"
  if (width >= DIAGNOSTICS_STANDARD_WIDTH) return "standard"
  if (width >= DIAGNOSTICS_NARROW_WIDTH) return "narrow"
  return "minimal"
}

/** Is the width too small for descriptive columns? */
export function isDiagnosticsNarrow(width: number): boolean {
  return isNarrow(width, DIAGNOSTICS_NARROW_WIDTH)
}

/** Presentational view of the data, width-aware. The view stays a thin renderer. */
export interface DiagnosticsView {
  tier: DiagnosticsTier
  overall: DiagnosticsStatus
  counts: { ok: number; warn: number; error: number; unknown: number }
  ariaLabel: string
  sections: DiagnosticsSection[]
}

/** Map data to a presentational view. Width tiers drive truncation in the view. */
export function diagnosticsViewModel(data: DiagnosticsData, opts: { width?: number } = {}): DiagnosticsView {
  const width = opts.width ?? DIAGNOSTICS_WIDE_WIDTH
  const tier = diagnosticsTier(width)
  const overall = overallStatus(data)
  const counts = diagnosticsCounts(data)
  const ariaLabel = `Diagnostics: ${counts.ok} ok, ${counts.warn} warn, ${counts.error} error. Tab to navigate sections, x to export, r to refresh, esc to close.`
  return { tier, overall, counts, ariaLabel, sections: data.sections }
}

// ---------------------------------------------------------------------------
// Redaction + export
// ---------------------------------------------------------------------------

/** Redact secrets from a single user-facing string. */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  return redactSensitive(text)
}

/** Render a section to its markdown lines (redacting sensitive field values). */
function sectionToMarkdown(section: DiagnosticsSection): string[] {
  const lines: string[] = [`## ${section.title} (${statusWord(section.status)})`]
  if (section.note) lines.push("", section.note)
  for (const field of section.fields) {
    const value = field.redact ? redactSensitive(field.value).text : field.value
    lines.push(`- **${field.key}**: ${value}`)
  }
  for (const item of section.items) {
    const detail = item.detail ? ` — ${redactSensitive(item.detail).text}` : ""
    lines.push(`- ${statusGlyph(item.status, false)} ${item.label}${detail}`)
  }
  return lines
}

/**
 * Render the full diagnostics payload as a redacted markdown bundle suitable for
 * export. Secrets are never written: field values marked `redact` and every item
 * detail pass through `redactSecrets`.
 */
export function exportDiagnosticsBundle(data: DiagnosticsData): string {
  const lines: string[] = ["# Ottili Coder Diagnostics", ""]
  for (const section of data.sections) {
    lines.push(...sectionToMarkdown(section), "")
  }
  return lines.join("\n")
}

/** Cap a user-visible value to a render budget. Pure. */
export function withinDiagnosticsBudget(value: string, max: number): string {
  return truncate(value, max)
}
