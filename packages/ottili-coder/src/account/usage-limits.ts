export const USAGE_LIMIT_API_PATHS = {
  plan: ["/api/company/plan", "/api/v1/platform/company/plan"],
  billing: ["/api/platform/company/billing", "/api/v1/platform/company/billing"],
} as const

export type UsageLimitStatus = "ok" | "warning" | "exceeded" | string

export type UsageLimitItem = {
  key: string
  label: string
  used: number
  limit: number | null
  unlimited: boolean
  remaining?: number | null
  percent: number
  status: UsageLimitStatus
}

export type UsageLimitsSnapshot = {
  planCode?: string
  planName?: string
  billingStatus?: string
  periodEnd?: string
  items: UsageLimitItem[]
}

export const USAGE_LIMITS_DASHBOARD_PATH = "/dashboard/settings/usage"
export const defaultUsageLimitsDashboardUrl = `https://dashboard.ottili.one${USAGE_LIMITS_DASHBOARD_PATH}`

const LIMIT_LABELS: Record<string, string> = {
  team_members: "Team Members",
  company_count: "Companies",
  workspace_allowance: "Workspaces",
  storage_gb: "Storage (GB)",
  ai_credits: "AI Credits",
  ottili_ai_runs: "Ottili AI Runs",
  codehelm_runs: "CodeHelm Runs",
  ld3_articles: "LD3 Content",
  crm_records: "CRM Records",
  products: "Products",
  automations: "Automations",
  monthly_automation_runs: "Monthly Runs",
  automation_runs: "Automation Runs",
  active_modules: "Active Modules",
  ai_messages: "AI Messages",
  marketplace_searches: "Marketplace Searches",
  api_requests: "API Requests",
  simulation_scenarios: "Simulation Scenarios",
  simulation_runs_per_day: "Simulation Runs / Day",
  monte_carlo_intensity: "Monte Carlo Intensity",
  ld3_content_usage: "LD3 Content Usage",
  content_automation_articles: "Content Automation Articles",
}

const PRIORITY_LIMIT_KEYS = new Set([
  "team_members",
  "active_modules",
  "ai_credits",
  "automation_runs",
  "codehelm_runs",
  "storage_gb",
  "ottili_ai_runs",
  "ai_messages",
  "products",
  "crm_records",
])

export function sortUsageLimitItems(items: UsageLimitItem[]) {
  const rank = (item: UsageLimitItem) => {
    if (item.status === "exceeded") return 0
    if (item.status === "warning") return 1
    if (!item.unlimited && item.limit != null) return 2
    if (item.unlimited && item.used > 0) return 3
    return 4
  }

  return [...items].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  })
}

export function compactUsageLimitItems(items: UsageLimitItem[], options?: { includeAll?: boolean }) {
  if (options?.includeAll) return sortUsageLimitItems(items)

  return sortUsageLimitItems(
    items.filter((item) => {
      if (item.status === "exceeded" || item.status === "warning") return true
      if (!item.unlimited && item.used > 0) return true
      if (item.unlimited && item.used > 0) return true
      if (PRIORITY_LIMIT_KEYS.has(item.key)) return true
      return false
    }),
  )
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeItem(raw: Record<string, unknown>): UsageLimitItem {
  const key = String(raw.key ?? "")
  const unlimited = raw.unlimited === true || raw.limit === null || raw.limit === -1
  const used = asNumber(raw.used)
  const limit = unlimited ? null : raw.limit == null ? null : asNumber(raw.limit)
  const percent =
    typeof raw.percent === "number"
      ? Math.min(100, Math.max(0, raw.percent))
      : unlimited || limit == null
        ? 0
        : Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
  const status =
    typeof raw.status === "string"
      ? raw.status
      : unlimited || limit == null
        ? "ok"
        : used > limit
          ? "exceeded"
          : percent >= 80
            ? "warning"
            : "ok"

  return {
    key,
    label: String(raw.label ?? LIMIT_LABELS[key] ?? key.replace(/_/g, " ")),
    used,
    limit,
    unlimited,
    remaining:
      raw.remaining == null
        ? unlimited || limit == null
          ? null
          : Math.max(0, limit - used)
        : asNumber(raw.remaining),
    percent,
    status,
  }
}

function buildFromPlanLimits(limits: Record<string, unknown>, usage: Record<string, number>) {
  return Object.entries(limits)
    .map(([key, rawLimit]) => {
      const unlimited = rawLimit === null || rawLimit === -1
      const limit = unlimited ? null : asNumber(rawLimit)
      const used = asNumber(usage[key])
      const percent = unlimited || limit == null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
      const status =
        unlimited || limit == null
          ? "ok"
          : used > limit
            ? "exceeded"
            : percent >= 80
              ? "warning"
              : "ok"

      return normalizeItem({
        key,
        label: LIMIT_LABELS[key] ?? key.replace(/_/g, " "),
        used,
        limit,
        unlimited,
        percent,
        status,
      })
    })
    .filter((item) => item.unlimited || (item.limit != null && item.limit > 0))
}

export function resolveUsageLimitItems(input: {
  usageItems?: unknown[]
  planLimits?: Record<string, unknown>
  usage?: Record<string, number>
  canonicalLimitRows?: Record<string, unknown>
}): UsageLimitItem[] {
  const legacyItems = Array.isArray(input.usageItems)
    ? input.usageItems
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => normalizeItem(item))
    : []

  const canonicalEntries = Object.entries(input.canonicalLimitRows ?? {})
  if (canonicalEntries.length) {
    const legacyByKey = new Map(legacyItems.map((item) => [item.key, item]))
    return canonicalEntries
      .map(([key, row]) => {
        const legacy = legacyByKey.get(key)
        const source = row && typeof row === "object" ? (row as Record<string, unknown>) : {}
        return normalizeItem({
          ...source,
          key,
          used: legacy?.used ?? source.used,
        })
      })
      .filter((item) => item.unlimited || (item.limit != null && item.limit > 0))
  }

  if (legacyItems.length) {
    return legacyItems.filter((item) => item.unlimited || (item.limit != null && item.limit > 0))
  }

  return buildFromPlanLimits(input.planLimits ?? {}, input.usage ?? {})
}

export function parseCompanyPlanPayload(payload: unknown): UsageLimitsSnapshot {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const plan =
    body.plan && typeof body.plan === "object" ? (body.plan as Record<string, unknown>) : ({} as Record<string, unknown>)
  const usage =
    body.usage && typeof body.usage === "object" ? (body.usage as Record<string, number>) : ({} as Record<string, number>)

  return {
    planCode: typeof plan.plan_code === "string" ? plan.plan_code : undefined,
    planName: typeof plan.plan_name === "string" ? plan.plan_name : undefined,
    billingStatus: typeof plan.billing_status === "string" ? plan.billing_status : undefined,
    periodEnd:
      typeof plan.current_period_end === "string"
        ? plan.current_period_end
        : plan.subscription && typeof plan.subscription === "object"
          ? String((plan.subscription as Record<string, unknown>).current_period_end ?? "")
          : undefined,
    items: resolveUsageLimitItems({
      usageItems: Array.isArray(body.usage_items) ? body.usage_items : [],
      planLimits:
        plan.limits && typeof plan.limits === "object" ? (plan.limits as Record<string, unknown>) : undefined,
      usage,
    }),
  }
}

export function mergeBillingLimitRows(
  snapshot: UsageLimitsSnapshot,
  billingPayload: unknown,
): UsageLimitsSnapshot {
  const body = billingPayload && typeof billingPayload === "object" ? (billingPayload as Record<string, unknown>) : {}
  const entitlements =
    body.effectiveEntitlements && typeof body.effectiveEntitlements === "object"
      ? (body.effectiveEntitlements as Record<string, unknown>)
      : undefined
  const limitRows =
    entitlements?.limitRows && typeof entitlements.limitRows === "object"
      ? (entitlements.limitRows as Record<string, unknown>)
      : undefined

  const billingPlan =
    body.plan && typeof body.plan === "object" ? (body.plan as Record<string, unknown>) : undefined
  const billingPlanLimits =
    billingPlan?.limits && typeof billingPlan.limits === "object"
      ? (billingPlan.limits as Record<string, unknown>)
      : undefined

  let items = snapshot.items
  if (limitRows) {
    items = resolveUsageLimitItems({
      usageItems: items,
      canonicalLimitRows: limitRows,
    })
  }

  if (!items.length && billingPlanLimits) {
    items = resolveUsageLimitItems({
      planLimits: billingPlanLimits,
      usage: snapshot.items.reduce<Record<string, number>>((acc, item) => {
        acc[item.key] = item.used
        return acc
      }, {}),
    })
  }

  if (!limitRows && !billingPlanLimits) return snapshot

  return {
    ...snapshot,
    planCode: snapshot.planCode ?? (typeof billingPlan?.slug === "string" ? billingPlan.slug : undefined),
    planName: snapshot.planName ?? (typeof billingPlan?.title === "string" ? billingPlan.title : undefined),
    items,
  }
}

export function summarizeUsageLimits(items: UsageLimitItem[]) {
  const finite = items.filter((item) => !item.unlimited && item.limit != null)
  const exceeded = finite.filter((item) => item.status === "exceeded").length
  const warning = finite.filter((item) => item.status === "warning").length
  const ok = finite.length - exceeded - warning
  const avgPercent =
    finite.length === 0 ? 0 : Math.round(finite.reduce((sum, item) => sum + item.percent, 0) / finite.length)

  return { total: items.length, finite: finite.length, ok, warning, exceeded, avgPercent }
}

export function usageBar(percent: number, width = 16) {
  const safe = Math.min(100, Math.max(0, percent))
  const filled = Math.round((safe / 100) * width)
  return `[${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}]`
}
