import type { SDK } from "@opencode-ai/sdk/v2"

export type UsageLimitItem = {
  key: string
  label: string
  used: number
  limit: number | null
  unlimited: boolean
  remaining?: number | null
  percent: number
  status: string
}

export type UsageLimitsResponse =
  | { loggedIn: false }
  | {
      loggedIn: true
      planCode?: string
      planName?: string
      billingStatus?: string
      periodEnd?: string
      items?: UsageLimitItem[]
      dashboardUrl?: string
      message?: string
    }

export async function fetchUsageLimits(sdk: SDK): Promise<UsageLimitsResponse> {
  const response = await sdk.fetch(`${sdk.url}/experimental/account/usage-limits`, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) return { loggedIn: false }
  return (await response.json()) as UsageLimitsResponse
}

export function usageLimitTone(status: string | undefined) {
  if (status === "exceeded") return "error" as const
  if (status === "warning") return "warning" as const
  return "success" as const
}

export function usageBar(percent: number, width = 14) {
  const safe = Math.min(100, Math.max(0, percent))
  const filled = Math.round((safe / 100) * width)
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`
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
