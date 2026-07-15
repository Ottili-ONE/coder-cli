/**
 * Settings domain model for the Ottili Coder TUI.
 *
 * Pure and rendering-free so the settings logic can be unit tested in isolation
 * and reused by the Solid view in `../component/dialog-settings.tsx`. Every
 * transition is a pure function: it takes inputs and returns new values, which
 * keeps the data flow deterministic and snapshot-free in tests.
 *
 * The model mirrors the patterns established by `diagnostics-model.ts` and
 * `update-banner-model.ts`. It reuses `redactSensitive`, `truncate` and
 * `isNarrow` from the agent roster model, exactly as the sibling models do, so
 * secrets are never rendered and the surface stays within a predictable render
 * budget.
 *
 * The Settings surface consolidates nine real configuration domains — general,
 * models, permissions, MCP, hooks, Git, appearance, privacy and updates — into
 * a single, keyboard- and mouse-navigable hub. Each row carries an optional
 * `action` that deep-links to the existing, real editing surface for that
 * domain (the model dialog, MCP dialog, theme list, git status dialog, the
 * config editor, …). The hub does not re-implement those editors; it surfaces
 * real application state and routes to the canonical editor, which keeps a
 * single source of truth and avoids a duplicated legacy view.
 *
 * Data collection is fully injectable: `collectSettings` accepts a
 * `SettingsSources` object that the view assembles from real application state
 * (`useSync()`, `useLocal()`, `useTuiConfig()`, `useTheme()`, `process`). Unit
 * tests pass stubbed sources so no network or filesystem access is required.
 */

import { redactSensitive, truncate, isNarrow } from "../component/agent-roster/model"

/** Rollup health/attention of a single settings domain or the whole surface. */
export type SettingsStatus = "ok" | "warn" | "error" | "unknown"

/** The nine real configuration domains consolidated by the Settings hub. */
export type SettingsSectionId =
  | "general"
  | "models"
  | "permissions"
  | "mcp"
  | "hooks"
  | "git"
  | "appearance"
  | "privacy"
  | "updates"

/** A wire-safe deep-link to the canonical editor/surface for a row. */
export interface SettingsAction {
  /** Stable command id consumed by the view (e.g. `dialog.model`). */
  command: string
  /** Human label shown on the row's affordance. */
  label: string
}

/** A single setting row rendered as `label: value` with an optional deep-link. */
export interface SettingsRow {
  label: string
  value: string
  /** Optional per-row health used for the status glyph + color. */
  status?: SettingsStatus
  /** Optional corrective deep-link to the canonical editor/surface. */
  action?: SettingsAction
  /** Supporting copy rendered under the value (redacted before display). */
  detail?: string
}

/** A collapsible settings section shown in the hub. */
export interface SettingsSection {
  id: SettingsSectionId
  title: string
  status: SettingsStatus
  rows: SettingsRow[]
  /** Shown when the section has nothing actionable (honest, never fabricated). */
  note?: string
}

/** The full structured settings payload consumed by the view. */
export interface SettingsData {
  sections: SettingsSection[]
}

// ---------------------------------------------------------------------------
// Source shapes (structural; the view maps SDK/config types into these)
// ---------------------------------------------------------------------------

export interface SettingsModelLike {
  providerID: string
  modelID: string
}

export interface SettingsPermissionRuleLike {
  action: string
  permission: string
  pattern: string
}

export interface SettingsMcpLike {
  status: "connected" | "failed" | "disabled" | "needs_auth" | "needs_client_registration"
  enabled: boolean
}

export interface SettingsGitLike {
  available: boolean
  branch?: string
  root?: string
  dirty?: boolean
}

export interface SettingsThemeLike {
  selected: string
  count: number
  mode: "dark" | "light" | "system"
}

export interface SettingsTuiLike {
  mouse: boolean
  attentionSound: boolean
  scrollAcceleration: boolean
  diffStyle: "auto" | "stacked"
}

export interface SettingsPrivacyLike {
  telemetry: boolean
  crashReports: boolean
  clipboardHistory: boolean
}

export interface SettingsUpdateLike {
  status: "hidden" | "loading" | "empty" | "available" | "failure" | "denied" | "offline" | "degraded" | "installing"
  channel?: "local" | "latest" | "beta" | "nightly"
  target?: string
  current?: string
}

/**
 * Everything `collectSettings` needs, gathered by the view from real state.
 * Keeping this the single input keeps the model pure and unit-testable.
 */
export interface SettingsSources {
  version: string
  cwd: string
  model: SettingsModelLike | null
  favoriteModels: number
  permissionRules: SettingsPermissionRuleLike[]
  mcp: Record<string, SettingsMcpLike>
  hooks: string[]
  git: SettingsGitLike | null
  theme: SettingsThemeLike
  tui: SettingsTuiLike
  privacy: SettingsPrivacyLike
  update: SettingsUpdateLike
}

// ---------------------------------------------------------------------------
// Status rollup helpers
// ---------------------------------------------------------------------------

/** Worst-case status across a set (error > warn > unknown > ok). */
export function worstSettingsStatus(statuses: SettingsStatus[]): SettingsStatus {
  if (statuses.includes("error")) return "error"
  if (statuses.includes("warn")) return "warn"
  if (statuses.includes("unknown")) return "unknown"
  return "ok"
}

/** Single-glyph status marker; color is never the only signal (a word always accompanies it). */
export function settingsStatusGlyph(status: SettingsStatus, useColor = true): string {
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
export function settingsStatusWord(status: SettingsStatus): string {
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
export function settingsStatusColorRole(
  status: SettingsStatus,
): "success" | "warning" | "error" | "info" | "text" {
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

/** General: version, working directory and global TUI toggles. */
export function buildGeneralSection(s: SettingsSources): SettingsSection {
  const rows: SettingsRow[] = [
    { label: "Version", value: s.version, status: "ok" },
    { label: "Working directory", value: s.cwd, status: "ok" },
    {
      label: "Mouse capture",
      value: s.tui.mouse ? "enabled" : "disabled",
      status: "ok",
      action: { command: "dialog.config", label: "edit" },
    },
    {
      label: "Scroll acceleration",
      value: s.tui.scrollAcceleration ? "on" : "off",
      status: "ok",
      action: { command: "dialog.config", label: "edit" },
    },
    {
      label: "Diff style",
      value: s.tui.diffStyle,
      status: "ok",
      action: { command: "dialog.config", label: "edit" },
    },
  ]
  return { id: "general", title: "General", status: "ok", rows }
}

/** Models: active model, favorites and a deep-link to the model picker. */
export function buildModelsSection(s: SettingsSources): SettingsSection {
  const rows: SettingsRow[] = []
  if (s.model) {
    rows.push({
      label: "Active model",
      value: `${s.model.modelID} (${s.model.providerID})`,
      status: "ok",
      action: { command: "dialog.model", label: "change" },
    })
  } else {
    rows.push({ label: "Active model", value: "not selected", status: "warn" })
  }
  rows.push({
    label: "Favorite models",
    value: `${s.favoriteModels}`,
    status: "ok",
    action: { command: "dialog.model", label: "manage" },
  })
  return {
    id: "models",
    title: "Models",
    status: rows.some((r) => r.status === "warn") ? "warn" : "ok",
    rows,
  }
}

/** Permissions: custom rules and a deep-link to the permission surface. */
export function buildPermissionsSection(s: SettingsSources): SettingsSection {
  const rows: SettingsRow[] = s.permissionRules.map((rule) => ({
    label: rule.action.toUpperCase(),
    value: `${rule.permission}  ${rule.pattern}`,
    status: rule.permission === "deny" ? "warn" : "ok",
    action: { command: "dialog.permissions", label: "edit" },
  }))
  if (rows.length === 0) {
    return {
      id: "permissions",
      title: "Permissions",
      status: "ok",
      rows,
      note: "No custom permission rules — defaults apply.",
    }
  }
  return { id: "permissions", title: "Permissions", status: "ok", rows }
}

/** MCP: servers with status and a deep-link to the MCP dialog. */
export function buildMcpSection(mcp: Record<string, SettingsMcpLike>): SettingsSection {
  const rows: SettingsRow[] = Object.entries(mcp).map(([name, m]) => {
    const status: SettingsStatus =
      m.status === "connected" ? "ok" : m.status === "failed" || m.status === "needs_client_registration" ? "error" : "warn"
    const detail =
      m.status === "failed"
        ? "failed"
        : m.status === "needs_auth"
          ? "needs authentication"
          : m.enabled
            ? m.status
            : "disabled"
    return {
      label: name,
      value: m.enabled ? detail : "disabled",
      detail,
      status,
      action: { command: "dialog.mcp", label: "manage" },
    }
  })
  if (rows.length === 0) {
    return { id: "mcp", title: "MCP", status: "ok", rows, note: "No MCP servers configured." }
  }
  return { id: "mcp", title: "MCP", status: worstSettingsStatus(rows.map((r) => r.status)), rows }
}

/** Hooks: configured hook commands and a deep-link to the config editor. */
export function buildHooksSection(hooks: string[]): SettingsSection {
  const rows: SettingsRow[] = hooks.map((hook) => ({
    label: truncate(hook, 80),
    value: "configured",
    status: "ok",
    action: { command: "dialog.config", label: "edit" },
  }))
  if (rows.length === 0) {
    return { id: "hooks", title: "Hooks", status: "ok", rows, note: "No hooks configured." }
  }
  return { id: "hooks", title: "Hooks", status: "ok", rows }
}

/** Git: repository branch/state and a deep-link to the git status dialog. */
export function buildGitSection(git: SettingsGitLike | null): SettingsSection {
  if (!git || !git.available) {
    return { id: "git", title: "Git", status: "warn", rows: [], note: "Not a git repository." }
  }
  const rows: SettingsRow[] = [
    { label: "Branch", value: git.branch ?? "unknown", status: "ok" },
    {
      label: "Working tree",
      value: git.dirty ? "uncommitted changes" : "clean",
      status: git.dirty ? "warn" : "ok",
      action: { command: "dialog.git", label: "view" },
    },
  ]
  if (git.root) rows.push({ label: "Repository root", value: git.root, status: "ok" })
  return { id: "git", title: "Git", status: "ok", rows }
}

/** Appearance: active theme, count and a deep-link to the theme list. */
export function buildAppearanceSection(theme: SettingsThemeLike): SettingsSection {
  const rows: SettingsRow[] = [
    { label: "Theme", value: theme.selected, status: "ok", action: { command: "dialog.theme", label: "change" } },
    { label: "Available themes", value: `${theme.count}`, status: "ok" },
    { label: "Color mode", value: theme.mode, status: "ok", action: { command: "dialog.theme", label: "change" } },
  ]
  return { id: "appearance", title: "Appearance", status: "ok", rows }
}

/** Privacy: telemetry / crash-report / clipboard toggles and a config deep-link. */
export function buildPrivacySection(privacy: SettingsPrivacyLike): SettingsSection {
  const rows: SettingsRow[] = [
    {
      label: "Telemetry",
      value: privacy.telemetry ? "on" : "off",
      status: "ok",
      action: { command: "dialog.config", label: "edit" },
    },
    {
      label: "Crash reports",
      value: privacy.crashReports ? "on" : "off",
      status: "ok",
      action: { command: "dialog.config", label: "edit" },
    },
    {
      label: "Clipboard history",
      value: privacy.clipboardHistory ? "on" : "off",
      status: "ok",
      action: { command: "dialog.config", label: "edit" },
    },
  ]
  return { id: "privacy", title: "Privacy", status: "ok", rows }
}

/** Updates: current update status and a deep-link to the release preview. */
export function buildUpdatesSection(update: SettingsUpdateLike): SettingsSection {
  const status: SettingsStatus =
    update.status === "available" || update.status === "installing"
      ? "ok"
      : update.status === "failure" || update.status === "degraded"
        ? "error"
        : update.status === "denied" || update.status === "offline"
          ? "warn"
          : "unknown"
  const value =
    update.status === "available" && update.target
      ? `update available · v${update.target}`
      : update.status === "empty"
        ? "up to date"
        : update.status === "loading"
          ? "checking…"
          : update.status
  const rows: SettingsRow[] = [
    {
      label: "Channel",
      value: update.channel ?? "latest",
      status,
      action: { command: "dialog.release", label: "release notes" },
    },
    {
      label: "Status",
      value,
      status,
      action: { command: "dialog.release", label: "release notes" },
    },
  ]
  return { id: "updates", title: "Updates", status, rows }
}

/** Assemble the full structured payload from injected sources. */
export function collectSettings(sources: SettingsSources): SettingsData {
  return {
    sections: [
      buildGeneralSection(sources),
      buildModelsSection(sources),
      buildPermissionsSection(sources),
      buildMcpSection(sources.mcp),
      buildHooksSection(sources.hooks),
      buildGitSection(sources.git),
      buildAppearanceSection(sources.theme),
      buildPrivacySection(sources.privacy),
      buildUpdatesSection(sources.update),
    ],
  }
}

// ---------------------------------------------------------------------------
// Rollups + view model
// ---------------------------------------------------------------------------

/** Worst status across every section — the hub's headline status. */
export function overallSettingsStatus(data: SettingsData): SettingsStatus {
  return worstSettingsStatus(data.sections.map((s) => s.status))
}

/** Count of sections per status, used by the compact/width-tiered layouts. */
export function settingsCounts(data: SettingsData): { ok: number; warn: number; error: number; unknown: number } {
  const counts = { ok: 0, warn: 0, error: 0, unknown: 0 }
  for (const section of data.sections) counts[section.status]++
  return counts
}

/** Flatten sections into a single navigable row list (preserving order). */
export function settingsRows(data: SettingsData): SettingsRow[] {
  return data.sections.flatMap((section) => section.rows)
}

// ---------------------------------------------------------------------------
// Terminal width tiers (spec §5.2)
// ---------------------------------------------------------------------------

export const SETTINGS_WIDE_WIDTH = 110
export const SETTINGS_STANDARD_WIDTH = 80
export const SETTINGS_NARROW_WIDTH = 60

export type SettingsTier = "wide" | "standard" | "narrow" | "minimal"

/** Map a terminal width to its render tier (spec §5.2). */
export function settingsTier(width: number): SettingsTier {
  if (width >= SETTINGS_WIDE_WIDTH) return "wide"
  if (width >= SETTINGS_STANDARD_WIDTH) return "standard"
  if (width >= SETTINGS_NARROW_WIDTH) return "narrow"
  return "minimal"
}

/** Is the width too small for descriptive columns? */
export function isSettingsNarrow(width: number): boolean {
  return isNarrow(width, SETTINGS_NARROW_WIDTH)
}

/** Presentational view of the data, width-aware. The view stays a thin renderer. */
export interface SettingsView {
  tier: SettingsTier
  overall: SettingsStatus
  counts: { ok: number; warn: number; error: number; unknown: number }
  ariaLabel: string
  sections: SettingsSection[]
}

/** Map data to a presentational view. Width tiers drive truncation in the view. */
export function settingsViewModel(data: SettingsData, opts: { width?: number } = {}): SettingsView {
  const width = opts.width ?? SETTINGS_WIDE_WIDTH
  const tier = settingsTier(width)
  const overall = overallSettingsStatus(data)
  const counts = settingsCounts(data)
  const ariaLabel = `Settings: ${counts.ok} ok, ${counts.warn} warn, ${counts.error} error. Use up and down to move, enter to open a section, escape to close.`
  return { tier, overall, counts, ariaLabel, sections: data.sections }
}

// ---------------------------------------------------------------------------
// Redaction + budget
// ---------------------------------------------------------------------------

/** Redact secrets from a single user-facing string. */
export function redactSettingsText(input: string): { text: string; redacted: boolean } {
  return redactSensitive(input)
}

/** Cap a user-visible value to a render budget. Pure. */
export function withinSettingsBudget(value: string, max: number): string {
  return truncate(value, max)
}
