import { describe, expect, test } from "bun:test"
import {
  colorEnabled,
  createDegradedQueue,
  isDegradedNarrow,
  presentState,
  redactState,
  severityText,
  stateAriaLabel,
  summarizeDegraded,
  withinBudget,
  type DegradedState,
} from "./model"

function makeState(id: string, title: string, over: Partial<DegradedState> = {}): DegradedState {
  return {
    id,
    category: "unknown",
    severity: "error",
    title,
    message: "msg",
    dismissible: true,
    createdAt: 0,
    ...over,
  }
}

test("redactState scrubs secrets from every field", () => {
  const state = makeState("x", "api_key = supersecretvalue123", {
    message: "Bearer sk-live-abcdefghijklmnop failed",
    detail: "token=longtokenvalue1234567890abcdefghij",
  })
  const out = redactState(state)
  expect(out.title).not.toContain("supersecretvalue123")
  expect(out.title).toContain("••••")
  expect(out.message).not.toContain("sk-live")
  expect(out.detail).not.toContain("longtokenvalue")
  // Non-secret content is preserved verbatim.
  expect(out.message).toContain("failed")
})

test("withinBudget truncates each field to the render budget", () => {
  const state = makeState("x", "t".repeat(500), {
    message: "m".repeat(2000),
    detail: "d".repeat(900),
  })
  const out = withinBudget(state)
  expect(out.title.length).toBeLessThanOrEqual(200)
  expect(out.title.endsWith("…")).toBe(true)
  expect(out.message.length).toBeLessThanOrEqual(1000)
  expect(out.detail!.length).toBeLessThanOrEqual(500)
})

test("presentState redacts and caps in one step", () => {
  const state = makeState("x", "api_key = hiddenvalue123", { message: "m".repeat(2000) })
  const out = presentState(state)
  expect(out.title).toContain("••••")
  expect(out.message.length).toBeLessThanOrEqual(1000)
  // Original is never mutated.
  expect(state.title).toContain("hiddenvalue123")
})

test("colorEnabled honors overrides and conventions", () => {
  expect(colorEnabled({ level: 0 })).toBe(false)
  expect(colorEnabled({ level: 3 })).toBe(true)
  expect(colorEnabled({ noColor: true })).toBe(false)
})

test("severityText gives an explicit word marker", () => {
  expect(severityText("error")).toBe("ERROR")
  expect(severityText("warning")).toBe("WARNING")
  expect(severityText("info")).toBe("INFO")
})

test("stateAriaLabel is self-contained and redacted", () => {
  const state = makeState("x", "provider down", {
    category: "provider",
    message: "Bearer sk-live-abcdefghijklmnop",
  })
  const label = stateAriaLabel(state)
  expect(label).toContain("ERROR")
  expect(label).toContain("Provider")
  expect(label).toContain("provider down")
  expect(label).not.toContain("sk-live")
})

test("isDegradedNarrow collapses at the budgeted width", () => {
  expect(isDegradedNarrow(50)).toBe(true)
  expect(isDegradedNarrow(80)).toBe(false)
})

test("summarizeDegraded keeps its documented shape", () => {
  expect(summarizeDegraded([])).toBe("")
  expect(summarizeDegraded([makeState("a", "boom", { category: "network" })])).toBe(
    "Network: boom. msg",
  )
})

test("createDegradedQueue commits the first push immediately and coalesces a burst", () => {
  const commits: DegradedState[][] = []
  const queue = createDegradedQueue((batch) => commits.push(batch))

  const a = makeState("a", "A")
  queue.push(a)
  expect(commits).toHaveLength(1)
  expect(commits[0]).toEqual([a])

  const b = makeState("b", "B")
  const b2 = makeState("b", "B-updated")
  queue.push(b)
  queue.push(b2)
  expect(commits).toHaveLength(1) // trailing not committed yet
  expect(queue.pending()).toBe(1)

  queue.flush()
  expect(commits).toHaveLength(2)
  expect(commits[1]).toEqual([b2]) // latest per id wins
})

test("createDegradedQueue flushes nothing when empty", () => {
  const commits: DegradedState[][] = []
  const queue = createDegradedQueue((batch) => commits.push(batch))
  queue.flush()
  expect(commits).toHaveLength(0)
})
