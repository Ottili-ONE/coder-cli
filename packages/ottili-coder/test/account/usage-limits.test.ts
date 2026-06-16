import { describe, expect, it } from "bun:test"
import {
  mergeBillingLimitRows,
  parseCompanyPlanPayload,
  resolveUsageLimitItems,
  summarizeUsageLimits,
  compactUsageLimitItems,
  sortUsageLimitItems,
} from "../../src/account/usage-limits"

describe("account usage limits", () => {
  it("parses company plan usage items", () => {
    const snapshot = parseCompanyPlanPayload({
      plan: {
        plan_code: "pro",
        plan_name: "Pro",
        billing_status: "active",
        limits: { ai_credits: 100, active_modules: 5 },
      },
      usage: { ai_credits: 82, active_modules: 2 },
      usage_items: [
        {
          key: "ai_credits",
          label: "AI Credits",
          used: 82,
          limit: 100,
          unlimited: false,
          percent: 82,
          status: "warning",
        },
      ],
    })

    expect(snapshot.planCode).toBe("pro")
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]?.status).toBe("warning")
  })

  it("builds limits from plan when usage_items are missing", () => {
    const items = resolveUsageLimitItems({
      planLimits: { team_members: 10 },
      usage: { team_members: 11 },
    })

    expect(items[0]?.status).toBe("exceeded")
  })

  it("merges billing entitlement rows", () => {
    const merged = mergeBillingLimitRows(
      parseCompanyPlanPayload({
        plan: { plan_code: "starter" },
        usage_items: [{ key: "active_modules", label: "Active Modules", used: 2, limit: 5, unlimited: false, percent: 40, status: "ok" }],
      }),
      {
        effectiveEntitlements: {
          limitRows: {
            active_modules: { key: "active_modules", label: "Active Modules", used: 0, limit: 5, unlimited: false },
          },
        },
      },
    )

    expect(merged.items[0]?.used).toBe(2)
    expect(summarizeUsageLimits(merged.items).ok).toBe(1)
  })

  it("sorts exceeded and warning limits first", () => {
    const sorted = sortUsageLimitItems([
      { key: "storage_gb", label: "Storage", used: 0, limit: null, unlimited: true, percent: 0, status: "ok" },
      { key: "ai_credits", label: "AI Credits", used: 95, limit: 100, unlimited: false, percent: 95, status: "warning" },
      { key: "team_members", label: "Team Members", used: 11, limit: 10, unlimited: false, percent: 110, status: "exceeded" },
    ])

    expect(sorted[0]?.status).toBe("exceeded")
    expect(sorted[1]?.status).toBe("warning")
  })

  it("compacts unused unlimited rows by default", () => {
    const compact = compactUsageLimitItems([
      { key: "simulation_scenarios", label: "Simulation Scenarios", used: 0, limit: null, unlimited: true, percent: 0, status: "ok" },
      { key: "active_modules", label: "Active Modules", used: 2, limit: 5, unlimited: false, percent: 40, status: "ok" },
      { key: "team_members", label: "Team Members", used: 0, limit: 10, unlimited: false, percent: 0, status: "ok" },
    ])

    expect(compact.some((item) => item.key === "simulation_scenarios")).toBe(false)
    expect(compact.some((item) => item.key === "active_modules")).toBe(true)
    expect(compact.some((item) => item.key === "team_members")).toBe(true)
  })
})
