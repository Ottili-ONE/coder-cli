import { test, expect } from "bun:test"
import { identifyRootCause, parseCheckRun, splitJsonLines, type RootCause } from "../src/ci-debugger/index"

test("identifies a TypeScript compile error", () => {
  const logs = "src/foo.ts:12:3\nerror TS2322: Type 'string' is not assignable to type 'number'.\nbuild failed"
  const causes = identifyRootCause("typecheck", logs)
  expect(causes.map((c: RootCause) => c.category)).toContain("typescript")
  expect(causes[0].suggestion).toBeTruthy()
})

test("identifies a failing test", () => {
  const logs = "FAIL  src/foo.test.ts > should add\n  Expected 2, received 3"
  const causes = identifyRootCause("unit", logs)
  expect(causes.map((c: RootCause) => c.category)).toContain("test-failure")
})

test("identifies a missing dependency", () => {
  const logs = "Cannot find module 'left-pad'\nMODULE_NOT_FOUND"
  const causes = identifyRootCause("install", logs)
  expect(causes.map((c: RootCause) => c.category)).toContain("dependency")
})

test("falls back to unknown when nothing matches", () => {
  const logs = "something weird happened\nand then it broke"
  const causes = identifyRootCause("mystery", logs)
  expect(causes).toHaveLength(1)
  expect(causes[0].category).toBe("unknown")
})

test("returns no causes for empty logs", () => {
  expect(identifyRootCause("clean", "")).toHaveLength(0)
})

test("parseCheckRun maps a failed run", () => {
  const run = parseCheckRun({ id: "1", name: "build", status: "completed", conclusion: "failure" })
  expect(run).not.toBeNull()
  expect(run!.status).toBe("failed")
  expect(run!.conclusion).toBe("failure")
})

test("parseCheckRun returns null when name missing", () => {
  expect(parseCheckRun({ id: "1", status: "completed" })).toBeNull()
})

test("splitJsonLines tolerates blank and malformed lines", () => {
  const out = '\n{"a":1}\nnot json\n{"b":2}\n'
  expect(splitJsonLines(out)).toEqual([{ a: 1 }, { b: 2 }])
})
