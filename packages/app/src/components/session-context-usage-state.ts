import type { Context } from "./session-context-metrics"

const LONG_CONTENT_TOKENS = 100_000
const LONG_LABEL = 24
const RENDER_BUDGET_MS = 400

export type ContextMeterKind =
  | "loading"
  | "empty"
  | "populated"
  | "degraded"
  | "long-content"
  | "failure"
  | "denied"
  | "offline"

export interface ContextMeterInput {
  status: "loading" | "partial" | "complete"
  providerReady: boolean
  messageCount: number
  context: Context | undefined
  totalCost: number
  offline: boolean
  denied: boolean
  error: boolean
}

export interface ContextMeterState {
  kind: ContextMeterKind
  usage: number | null
  total: number
  cost: number
  providerLabel: string
  modelLabel: string
  hasLimit: boolean
  isLongContent: boolean
}

// Known credential/secret shapes. Provider and model labels are configuration
// driven and normally safe, but a misconfigured name can leak a key into the
// visual output, so dynamic labels are scanned before they reach the DOM.
const SENSITIVE_PATTERN =
  /(sk-[a-z0-9]{8,}|Bearer\s+[a-z0-9._\-]+|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9a-z-]+|gh[pousr]_[0-9a-zA-Z]{20,}|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+|token[_-]?[=:]?\s*[\w\-]{12,})/i

export function redactSensitive(value: string, mask = "••••"): string {
  if (!value) return value
  return value.replace(SENSITIVE_PATTERN, mask)
}

export function clampPercent(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export function isLongContent(input: { total: number; providerLabel: string; modelLabel: string }): boolean {
  return (
    input.total > LONG_CONTENT_TOKENS ||
    input.providerLabel.length > LONG_LABEL ||
    input.modelLabel.length > LONG_LABEL
  )
}

export function truncateLabel(value: string, max = LONG_LABEL): string {
  if (value.length <= max) return value
  const keep = Math.max(1, max - 1)
  return value.slice(0, keep) + "…"
}

export function formatCompactNumber(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "0"
  if (value === 0) return "0"
  return new Intl.NumberFormat(locale, {
    notation: value >= 1_000_000 || value <= -1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 0,
  }).format(value)
}

export function deriveContextMeterState(input: ContextMeterInput): ContextMeterState {
  const total = input.context?.total ?? 0
  const rawProvider = input.context?.providerLabel ?? ""
  const rawModel = input.context?.modelLabel ?? ""
  const long = isLongContent({ total, providerLabel: rawProvider, modelLabel: rawModel })

  const base: Omit<ContextMeterState, "kind"> = {
    usage: input.context?.usage ?? null,
    total,
    cost: input.totalCost,
    providerLabel: redactSensitive(rawProvider),
    modelLabel: redactSensitive(rawModel),
    hasLimit: input.context?.usage !== null,
    isLongContent: long,
  }

  if (input.offline) return { kind: "offline", ...base }
  if (input.error) return { kind: "failure", ...base }
  if (input.denied) return { kind: "denied", ...base }
  if (input.status === "loading" && input.messageCount === 0) return { kind: "loading", ...base }
  if (input.messageCount === 0) return { kind: "empty", ...base }
  if (long) return { kind: "long-content", ...base }
  if (input.context?.usage === null || !input.providerReady) return { kind: "degraded", ...base }
  return { kind: "populated", ...base }
}

export const CONTEXT_METER_RENDER_BUDGET_MS = RENDER_BUDGET_MS
