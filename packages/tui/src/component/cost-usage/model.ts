/**
 * Cost and usage meter domain model for the Ottili Coder TUI.
 *
 * Framework-agnostic (no Solid / SDK / OpenTUI deps) so the meter logic can be
 * unit tested in isolation and reused by the Solid presentation layer in
 * `./index.tsx`. Every transition is pure: inputs in, derived values out. This
 * mirrors the `context-meter` model and the `git-status-bar` component which
 * keep data math separate from rendering.
 *
 * The meter unifies three real data sources:
 *   - session totals (`cost`, `tokens`) from `SessionV2Info`
 *   - per-step cost/token accounting from assistant messages
 *   - plan usage limits from `fetchUsageLimits` (server `account/usage-limits`)
 * into a single focusable panel with a derived status that the header renders.
 */

import stripAnsi from "strip-ansi"
import type { UsageLimitsResponse, UsageLimitItem } from "../../util/usage-limits-api"

/** Whole-meter lifecycle derived from harness context + data. */
export type CostUsageStatus = "empty" | "ready" | "unknown" | "error"

export type CostUsageTone = "success" | "warning" | "error" | "info"

export interface CostUsageTokens {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export interface RawStep {
  id: string
  role: string
  model?: string
  provider?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  time?: number
}

export interface CostUsageStep {
  id: string
  /** 1-based chronological step number. */
  index: number
  role: string
  model?: string
  provider?: string
  cost: number
  tokens: CostUsageTokens
  time?: number
}

export interface CostUsageLimit {
  label: string
  used: number
  limit: number | null
  unlimited: boolean
  percent: number
  status: "exceeded" | "warning" | "healthy" | "unknown"
}

export interface CostUsageLimitSummary {
  ok: number
  warning: number
  exceeded: number
  finite: number
}

export interface CostUsageLimitData {
  loggedIn: boolean
  planName: string | null
  planCode: string | null
  billingStatus: string | null
  periodEnd: string | null
  dashboardUrl: string | null
  message: string | null
  items: CostUsageLimit[]
  /** Highest finite item percent, or null when no finite limit exists. */
  primaryPercent: number | null
  summary: CostUsageLimitSummary
}

export interface CostUsageData {
  /** Actual accumulated session cost. */
  cost: number
  tokens: CostUsageTokens & { total: number }
  steps: CostUsageStep[]
  limit: CostUsageLimitData
}

/** Harness-level concerns lifted above the raw data. */
export interface CostUsageContext {
  isReady: boolean
  loading?: boolean
  error?: string
}

export const NARROW_WIDTH_DEFAULT = 60
export const ERROR_MAX = 240

function redactSecrets(text: string): string {
  if (!text) return text
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ••••")
    .replace(/\b(token|secret)-[A-Za-z0-9_-]{6,}/gi, "$1-••••")
    .replace(/(sk|pk|api[_-]?key|token|secret|password|bearer)\s*[=:]\s*\S+/gi, (m) =>
      /=\s*$/.test(m) || /:\s*$/.test(m) ? m : m.replace(/\S+$/, "••••"),
    )
    .replace(/(Bearer|sk|pk)-[A-Za-z0-9_-]{8,}/g, (m) => `${m.slice(0, 6)}••••`)
}

function truncateError(text: string): string {
  const cleaned = stripAnsi(text ?? "").replace(/\t/g, "  ").trim()
  if (cleaned.length <= ERROR_MAX) return cleaned
  return cleaned.slice(0, ERROR_MAX - 1) + "…"
}

export function redactError(text: string): string {
  return redactSecrets(truncateError(text))
}

export function parseCostUsageError(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const text = redactError(raw)
  if (/session not found|no such session|unknown session/i.test(text)) return "session not available"
  if (/provider not found|no such provider|unknown provider/i.test(text)) return "provider not available"
  if (/rate limit|429/i.test(text)) return "usage refresh rate limited"
  if (/usage-limits|account\/usage/i.test(text)) return "plan limits unavailable"
  return text
}

// --- formatting -------------------------------------------------------------

/** Compact token count: 123 -> "123", 12345 -> "12.3k", 2_300_000 -> "2.30M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n < 1000) return Math.round(n).toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** Currency: small costs keep 4 decimals so micro-charges stay visible. */
export function formatCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00"
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`
}

/** Block glyph usage bar for a percentage. */
export function usageBar(percent: number, width = 10): string {
  const safe = Math.min(100, Math.max(0, percent))
  const filled = Math.round((safe / 100) * width)
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`
}

// --- limit normalization ----------------------------------------------------

function normalizeLimitItem(item: UsageLimitItem): CostUsageLimit {
  const status: CostUsageLimit["status"] =
    item.status === "exceeded" ? "exceeded" : item.status === "warning" ? "warning" : "healthy"
  return {
    label: item.label,
    used: item.used,
    limit: item.limit,
    unlimited: item.unlimited,
    percent: item.percent,
    status,
  }
}

function buildLimitData(response: UsageLimitsResponse | null | undefined): CostUsageLimitData {
  if (!response || response.loggedIn !== true) {
    return {
      loggedIn: false,
      planName: null,
      planCode: null,
      billingStatus: null,
      periodEnd: null,
      dashboardUrl: null,
      message: null,
      items: [],
      primaryPercent: null,
      summary: { ok: 0, warning: 0, exceeded: 0, finite: 0 },
    }
  }
  const items = (response.items ?? []).map(normalizeLimitItem)
  const finite = items.filter((item) => !item.unlimited && item.limit != null)
  const exceeded = finite.filter((item) => item.status === "exceeded").length
  const warning = finite.filter((item) => item.status === "warning").length
  const ok = finite.length - exceeded - warning
  const primaryPercent = finite.length === 0 ? null : Math.max(...finite.map((item) => item.percent))
  return {
    loggedIn: true,
    planName: response.planName ?? response.planCode ?? null,
    planCode: response.planCode ?? null,
    billingStatus: response.billingStatus ?? null,
    periodEnd: response.periodEnd ?? null,
    dashboardUrl: response.dashboardUrl ?? null,
    message: response.message ?? null,
    items,
    primaryPercent,
    summary: { ok, warning, exceeded, finite: finite.length },
  }
}

// --- step assembly ----------------------------------------------------------

const stepTokens = (raw: RawStep["tokens"]): CostUsageTokens => ({
  input: raw?.input ?? 0,
  output: raw?.output ?? 0,
  reasoning: raw?.reasoning ?? 0,
  cacheRead: raw?.cache?.read ?? 0,
  cacheWrite: raw?.cache?.write ?? 0,
})

function tokenTotal(tokens: CostUsageTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

function buildSteps(messages: RawStep[]): CostUsageStep[] {
  let index = 0
  return messages
    .filter((msg) => msg.role === "assistant")
    .filter((msg) => (msg.cost ?? 0) > 0 || tokenTotal(stepTokens(msg.tokens)) > 0)
    .map((msg) => {
      index += 1
      const tokens = stepTokens(msg.tokens)
      return {
        id: msg.id,
        index,
        role: msg.role,
        model: msg.model,
        provider: msg.provider,
        cost: msg.cost ?? 0,
        tokens,
        time: msg.time,
      }
    })
}

// --- data assembly ----------------------------------------------------------

export interface BuildCostUsageInput {
  cost: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  messages?: RawStep[]
  limits?: UsageLimitsResponse | null
}

export function buildCostUsage(input: BuildCostUsageInput): CostUsageData {
  const tokens: CostUsageTokens = {
    input: input.tokens?.input ?? 0,
    output: input.tokens?.output ?? 0,
    reasoning: input.tokens?.reasoning ?? 0,
    cacheRead: input.tokens?.cache?.read ?? 0,
    cacheWrite: input.tokens?.cache?.write ?? 0,
  }
  return {
    cost: input.cost ?? 0,
    tokens: { ...tokens, total: tokenTotal(tokens) },
    steps: buildSteps(input.messages ?? []),
    limit: buildLimitData(input.limits ?? null),
  }
}

// --- tone + state -----------------------------------------------------------

/** Color tone for a plan-usage percentage using the Ottili palette only. */
export function usageTone(percent: number | null): CostUsageTone {
  if (percent == null) return "info"
  if (percent >= 100) return "error"
  if (percent >= 80) return "warning"
  return "success"
}

export interface CostUsageOverrides {
  width?: number
  narrowWidth?: number
}

export interface CostUsageState {
  status: CostUsageStatus
  data: CostUsageData | null
  narrow: boolean
  /** Short header string: "$0.03 · 12.3k tok". */
  shortText: string
  /** Usage bar (plan-dominant) or empty when no finite limit. */
  bar: string
  barPercent: number | null
  tone: CostUsageTone
  /** Full spoken form for accessibility (aria-label). */
  ariaLabel: string
  summaryText: string
}

export function isNarrowTerminal(width: number, narrowWidth = NARROW_WIDTH_DEFAULT): boolean {
  return width < narrowWidth
}

function summarize(status: CostUsageStatus, ctx: CostUsageContext): string {
  if (status === "error") return `Cost and usage unavailable — ${parseCostUsageError(ctx.error) ?? "unknown error"}`
  if (status === "empty") return "No cost or usage yet"
  return ""
}

function buildAriaLabel(data: CostUsageData): string {
  const parts = [`session cost ${formatCost(data.cost)}`, `${formatTokens(data.tokens.total)} tokens used`]
  if (data.limit.loggedIn && data.limit.planName) {
    if (data.limit.primaryPercent != null) parts.push(`plan ${data.limit.planName} at ${data.limit.primaryPercent}%`)
    else parts.push(`plan ${data.limit.planName}`)
  }
  if (data.steps.length > 0) parts.push(`${data.steps.length} billed steps`)
  return parts.join(", ")
}

export function costUsageState(
  costInput: number | null | undefined,
  tokenInput: BuildCostUsageInput["tokens"],
  messages: RawStep[],
  limits: UsageLimitsResponse | null | undefined,
  ctx: CostUsageContext,
  overrides: CostUsageOverrides = {},
): CostUsageState {
  const narrowWidth = overrides.narrowWidth ?? NARROW_WIDTH_DEFAULT
  const width = overrides.width ?? narrowWidth
  const narrow = isNarrowTerminal(width, narrowWidth)
  const data = buildCostUsage({ cost: costInput ?? 0, tokens: tokenInput, messages, limits })

  let status: CostUsageStatus
  if (ctx.error) status = "error"
  else if (!ctx.isReady) status = "empty"
  else if (data.cost <= 0 && data.tokens.total <= 0 && data.steps.length === 0) status = "empty"
  else if (!data.limit.loggedIn && data.limit.primaryPercent == null) status = "unknown"
  else status = "ready"

  const shortText =
    status === "empty"
      ? "no usage yet"
      : `${formatCost(data.cost)} · ${formatTokens(data.tokens.total)} tok`

  const barPercent = data.limit.primaryPercent
  const bar = barPercent != null ? usageBar(barPercent) : ""
  const tone = usageTone(barPercent)

  const ariaLabel = buildAriaLabel(data)

  if (status === "error" || status === "empty") {
    return {
      status,
      data: status === "empty" ? data : null,
      narrow,
      shortText,
      bar,
      barPercent,
      tone,
      ariaLabel,
      summaryText: summarize(status, ctx),
    }
  }

  return {
    status,
    data,
    narrow,
    shortText,
    bar,
    barPercent,
    tone,
    ariaLabel,
    summaryText: summarize(status, ctx),
  }
}

// --- keyboard / mouse action ------------------------------------------------

export type CostUsageAction = { type: "open" }

export function actionFor(_kind: "meter" | null): CostUsageAction | null {
  return { type: "open" }
}
