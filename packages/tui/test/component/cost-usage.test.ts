import { expect, test } from "bun:test"
import {
  buildCostUsage,
  costUsageState,
  formatCost,
  formatTokens,
  isNarrowTerminal,
  usageBar,
  usageTone,
  type RawStep,
  type UsageLimitsResponse,
} from "../../src/component/cost-usage/model"

const step = (over: Partial<RawStep> = {}): RawStep => ({
  id: "m1",
  index: 1,
  role: "assistant",
  model: "gpt-4o",
  provider: "openai",
  cost: 0.01,
  tokens: { input: 1000, output: 500, reasoning: 0, cacheRead: 200, cacheWrite: 100 },
  ...over,
})

const loggedInLimits = (over: Partial<UsageLimitsResponse> = {}): UsageLimitsResponse => ({
  loggedIn: true,
  planName: "Pro",
  planCode: "pro",
  billingStatus: "active",
  periodEnd: "2026-08-01T00:00:00.000Z",
  items: [
    { key: "tok", label: "Tokens", used: 80000, limit: 100000, unlimited: false, percent: 80, status: "warning" },
    { key: "req", label: "Requests", used: 50, limit: 100, unlimited: false, percent: 50, status: "healthy" },
  ],
  ...over,
})

test("formatCost keeps 4 decimals for micro charges", () => {
  expect(formatCost(0)).toBe("$0.00")
  expect(formatCost(0.03)).toBe("$0.03")
  expect(formatCost(0.0003)).toBe("$0.0003")
  expect(formatCost(12.5)).toBe("$12.50")
})

test("formatTokens compacts thousands and millions", () => {
  expect(formatTokens(0)).toBe("0")
  expect(formatTokens(950)).toBe("950")
  expect(formatTokens(12345)).toBe("12.3k")
  expect(formatTokens(2_300_000)).toBe("2.30M")
})

test("usageBar fills proportionally", () => {
  expect(usageBar(0, 10)).toBe("░░░░░░░░░░")
  expect(usageBar(100, 10)).toBe("██████████")
  expect(usageBar(50, 10)).toBe("█████░░░░░")
})

test("usageTone maps percent to palette tones", () => {
  expect(usageTone(null)).toBe("info")
  expect(usageTone(40)).toBe("success")
  expect(usageTone(85)).toBe("warning")
  expect(usageTone(100)).toBe("error")
})

test("isNarrowTerminal uses the default threshold", () => {
  expect(isNarrowTerminal(40)).toBe(true)
  expect(isNarrowTerminal(80)).toBe(false)
})

test("buildCostUsage assembles steps and normalizes limits", () => {
  const data = buildCostUsage({
    cost: 0.05,
    tokens: { input: 2000, output: 1000, reasoning: 0, cache: { read: 300, write: 150 } },
    messages: [step({ id: "a", cost: 0.03 }), step({ id: "b", cost: 0.02 })],
    limits: loggedInLimits(),
  })
  expect(data.cost).toBe(0.05)
  expect(data.tokens.total).toBe(3450)
  expect(data.steps).toHaveLength(2)
  expect(data.steps[0].index).toBe(1)
  expect(data.limit.loggedIn).toBe(true)
  expect(data.limit.planName).toBe("Pro")
  expect(data.limit.primaryPercent).toBe(80)
  expect(data.limit.summary).toEqual({ ok: 1, warning: 1, exceeded: 0, finite: 2 })
})

test("costUsageState is empty before any usage", () => {
  const state = costUsageState(0, undefined, [], null, { isReady: true })
  expect(state.status).toBe("empty")
  expect(state.data).not.toBeNull()
  expect(state.barPercent).toBeNull()
  expect(state.shortText).toBe("no usage yet")
})

test("costUsageState reports ready with cost and no plan", () => {
  const state = costUsageState(
    0.03,
    { input: 1000, output: 500, reasoning: 0, cache: { read: 200, write: 100 } },
    [step()],
    null,
    { isReady: true },
  )
  expect(state.status).toBe("unknown")
  expect(state.shortText).toBe("$0.03 · 1.8k tok")
  expect(state.barPercent).toBeNull()
  expect(state.tone).toBe("info")
})

test("costUsageState derives bar and tone from plan limits", () => {
  const state = costUsageState(
    0.03,
    { input: 1000, output: 500, reasoning: 0, cache: { read: 200, write: 100 } },
    [step()],
    loggedInLimits({ items: [{ key: "tok", label: "Tokens", used: 95000, limit: 100000, unlimited: false, percent: 95, status: "warning" }] }),
    { isReady: true },
  )
  expect(state.status).toBe("ready")
  expect(state.barPercent).toBe(95)
  expect(state.tone).toBe("warning")
  expect(state.ariaLabel).toContain("plan Pro at 95%")
})

test("costUsageState surfaces harness errors", () => {
  const state = costUsageState(0, undefined, [], null, { isReady: false, error: "session not found" })
  expect(state.status).toBe("error")
  expect(state.data).toBeNull()
  expect(state.summaryText).toContain("session not available")
})

test("costUsageState truncates per-step list to top costs in data", () => {
  const messages: RawStep[] = Array.from({ length: 25 }, (_, i) =>
    step({ id: `s${i}`, cost: 0.001 * (i + 1) }),
  )
  const data = buildCostUsage({ cost: 0.3, messages })
  expect(data.steps).toHaveLength(25)
})
