import { describe, expect, test } from "bun:test"
import {
  buildRerun,
  classifyCaseLine,
  countByStatus,
  detectRunner,
  deriveRunStatus,
  effectiveSelection,
  flattenCases,
  moveSelection,
  parseTestOutput,
  statusGlyph,
  type TestResultsState,
  type TestRun,
} from "../../../src/component/test-results/model"

const BUN_OUTPUT = `
$ bun test
bun test v1.3.0

src/math.test.ts:
  ✓ add adds numbers (2ms)
  ✓ subtract subtracts (1ms)
src/string.test.ts:
  ✗ reverse reverses (3ms)
  ↓ skipMe is skipped
  ◌ futureTodo

Tests  3 passed | 1 failed | 1 skipped | 1 todo
`

const PYTEST_OUTPUT = `
tests/test_math.py::test_add PASSED
tests/test_math.py::test_divide FAILED
tests/test_io.py::test_read SKIPPED

===== 1 passed, 1 failed, 1 skipped in 1.23s =====
`

const VITEST_OUTPUT = `
 ✓ src/utils.ts > format > trims whitespace (4ms)
 × src/utils.ts > parse > rejects bad input
`

describe("detectRunner", () => {
  test("detects bun from command", () => {
    expect(detectRunner("bun test")).toBe("bun")
  })
  test("detects pytest from command", () => {
    expect(detectRunner("pytest tests/")).toBe("pytest")
  })
  test("detects vitest / jest", () => {
    expect(detectRunner("npx vitest run")).toBe("vitest")
    expect(detectRunner("jest --watch")).toBe("jest")
  })
  test("falls back to unknown", () => {
    expect(detectRunner("echo hi")).toBe("unknown")
  })
})

describe("classifyCaseLine", () => {
  test("classifies a passing bun line with duration", () => {
    const hit = classifyCaseLine("  ✓ add adds numbers (2ms)")
    expect(hit).toEqual({ status: "passed", name: "add adds numbers", durationMs: 2 })
  })
  test("classifies a failing line", () => {
    expect(classifyCaseLine("  ✗ reverse reverses")).toMatchObject({ status: "failed" })
  })
  test("returns null for non-case lines", () => {
    expect(classifyCaseLine("bun test v1.3.0")).toBeNull()
  })
})

describe("parseTestOutput — bun", () => {
  const run = parseTestOutput({ command: "bun test", output: BUN_OUTPUT, id: "r1" })

  test("detects runner and groups by file", () => {
    expect(run.runner).toBe("bun")
    expect(run.root.children.map((c) => c.name)).toEqual(["src/math.test.ts", "src/string.test.ts"])
  })

  test("parses statuses per case", () => {
    const cases = flattenCases(run)
    expect(cases.find((c) => c.name === "reverse reverses")?.status).toBe("failed")
    expect(cases.find((c) => c.name === "skipMe is skipped")?.status).toBe("skipped")
    expect(cases.find((c) => c.name === "futureTodo")?.status).toBe("todo")
    expect(cases.find((c) => c.name === "add adds numbers")?.status).toBe("passed")
  })

  test("run status reflects failure", () => {
    expect(run.status).toBe("failed")
    expect(deriveRunStatus(run)).toBe("failed")
  })

  test("summary counts", () => {
    const s = countByStatus(run)
    expect(s.total).toBe(6)
    expect(s.passed).toBe(3)
    expect(s.failed).toBe(1)
    expect(s.skipped).toBe(1)
    expect(s.todo).toBe(1)
  })
})

describe("parseTestOutput — pytest", () => {
  const run = parseTestOutput({ command: "pytest tests/", output: PYTEST_OUTPUT, id: "r2" })

  test("groups by file and detects statuses", () => {
    expect(run.runner).toBe("pytest")
    const cases = flattenCases(run)
    expect(cases.find((c) => c.name === "tests/test_math.py::test_divide")?.status).toBe("failed")
    expect(cases.find((c) => c.name === "tests/test_io.py::test_read")?.status).toBe("skipped")
  })

  test("run status reflects failure", () => {
    expect(run.status).toBe("failed")
  })
})

describe("parseTestOutput — vitest", () => {
  const run = parseTestOutput({ command: "vitest run", output: VITEST_OUTPUT, id: "r3" })
  test("parses nested suite + case names", () => {
    const cases = flattenCases(run)
    expect(cases.find((c) => c.name === "src/utils.ts > format > trims whitespace")?.status).toBe("passed")
    expect(cases.find((c) => c.name === "src/utils.ts > parse > rejects bad input")?.status).toBe("failed")
  })
})

describe("parseTestOutput — unknown runner", () => {
  test("falls back to a flat Output suite, flagging error lines", () => {
    const out = "Starting\nEverything looks fine\nError: boom happened\n"
    const run = parseTestOutput({ command: "sh run.sh", output: out })
    expect(run.runner).toBe("unknown")
    const cases = flattenCases(run)
    expect(cases.some((c) => c.status === "failed" && c.name.includes("Error:"))).toBe(true)
    expect(run.status).toBe("failed")
  })

  test("empty output yields a queued run with no children", () => {
    const run = parseTestOutput({ command: "bun test", output: "" })
    expect(run.status).toBe("queued")
    expect(run.root.children).toEqual([])
  })
})

describe("selection", () => {
  const run: TestRun = parseTestOutput({ command: "bun test", output: BUN_OUTPUT, id: "r1" })
  const base = (over: Partial<TestResultsState> = {}): TestResultsState => ({
    run,
    selectedId: null,
    filter: "all",
    expandedIds: [],
    ...over,
  })

  test("effectiveSelection picks the first id", () => {
    expect(effectiveSelection(base())).toBe("suite:src/math.test.ts")
  })

  test("moveSelection walks the flattened id list", () => {
    const first = effectiveSelection(base())!
    const next = moveSelection(base(), 1)!
    expect(next).not.toBe(first)
    const back = moveSelection({ ...base(), selectedId: next }, -1)
    expect(back).toBe(first)
  })

  test("moveSelection clamps at the ends", () => {
    const ids = flattenCases(run).map((c) => c.id)
    const last = ids[ids.length - 1]
    expect(moveSelection({ ...base(), selectedId: last }, 1)).toBe(last)
  })
})

describe("buildRerun", () => {
  test("full rerun returns the original command", () => {
    const run = parseTestOutput({ command: "bun test", output: BUN_OUTPUT })
    expect(buildRerun(run)).toEqual({ command: "bun test" })
  })

  test("rerunFailed for pytest appends failed node ids", () => {
    const run = parseTestOutput({ command: "pytest tests/", output: PYTEST_OUTPUT })
    const req = buildRerun(run, { onlyFailed: true })
    expect(req.command).toContain("tests/test_math.py::test_divide")
    expect(req.scope).toBe("1 failed")
  })

  test("rerunFailed for bun appends the single failing file", () => {
    const run = parseTestOutput({ command: "bun test", output: BUN_OUTPUT })
    const req = buildRerun(run, { onlyFailed: true })
    expect(req.command).toBe("bun test src/string.test.ts")
    expect(req.scope).toBe("1 failed")
  })

  test("rerunFailed with no failures keeps the command", () => {
    const run = parseTestOutput({ command: "bun test", output: "$ bun test\n  ✓ ok (1ms)\n" })
    expect(buildRerun(run, { onlyFailed: true }).scope).toBe("no failures")
  })
})

describe("statusGlyph", () => {
  test("colored glyphs", () => {
    expect(statusGlyph("passed", true)).toBe("✓")
    expect(statusGlyph("failed", true)).toBe("✗")
  })
  test("text fallbacks when color is unavailable", () => {
    expect(statusGlyph("failed", false)).toBe("[fail]")
    expect(statusGlyph("passed", false)).toBe("[pass]")
  })
})
