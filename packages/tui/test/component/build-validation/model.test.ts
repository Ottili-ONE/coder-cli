import { describe, expect, test } from "bun:test"
import {
  BUILD_CHECKS,
  ERROR_MAX,
  FILTER_CYCLE,
  NARROW_WIDTH_DEFAULT,
  RENDER_BUDGET_DEFAULT,
  type CheckInput,
  type CheckKind,
  type CheckStatus,
  type BuildValidationContext,
  buildState,
  checkStatusGlyph,
  checkStatusLabel,
  deriveStatus,
  effectiveSelection,
  filterChecks,
  fitWidth,
  formatDuration,
  hiddenCheckCount,
  isNarrowTerminal,
  moveSelection,
  nextFilter,
  normalizeCheck,
  parseCheckOutput,
  redactFailure,
  releaseGate,
  supportsColor,
  summary,
  visibleCheckIds,
} from "../../../src/component/build-validation/model"

function check(input: Partial<CheckInput> & { id: CheckKind; status: CheckStatus }): CheckInput {
  return { ...input }
}

function ctx(overrides: Partial<BuildValidationContext> = {}): BuildValidationContext {
  return { connected: true, permitted: true, running: false, loading: false, partial: false, ...overrides }
}

const ALL: CheckKind[] = ["lint", "typecheck", "build", "smoke", "release-gate"]

function passing(): CheckInput[] {
  return ALL.map((id) => check({ id, status: "passed" }))
}

describe("normalizeCheck", () => {
  test("fills metadata and defaults from BUILD_CHECKS", () => {
    const v = normalizeCheck(check({ id: "lint", status: "passed" }))
    expect(v.label).toBe("Lint")
    expect(v.description).toBe("Style and lint rules")
    expect(v.command).toBe("bun run lint")
    expect(v.required).toBe(true)
    expect(v.permitted).toBe(true)
    expect(v.details).toEqual([])
  })

  test("redacts secrets in the error and bounds its length", () => {
    const v = normalizeCheck(check({ id: "build", status: "failed", error: "token = sk-abcdefghijklmnopqrstuvwxyz" }))
    expect(v.error ?? "").not.toContain("sk-")
    expect((v.error ?? "").length).toBeLessThanOrEqual(ERROR_MAX)
  })

  test("truncates very long errors to the budget", () => {
    const huge = "x".repeat(1000)
    const v = normalizeCheck(check({ id: "typecheck", status: "failed", error: huge }))
    expect((v.error ?? "").length).toBe(ERROR_MAX)
  })

  test("is total on minimal input", () => {
    const v = normalizeCheck(check({ id: "smoke", status: "skipped" }))
    expect(v.id).toBe("smoke")
    expect(v.status).toBe("skipped")
    expect(v.required).toBe(false)
  })
})

describe("parseCheckOutput", () => {
  test("detects failures from error markers", () => {
    const r = parseCheckOutput("lint", "src/a.ts(3,1): error TS2345: any\n2 errors")
    expect(r.status).toBe("failed")
    expect(r.details).toContain("2 errors")
  })

  test("passes clean output", () => {
    const r = parseCheckOutput("typecheck", "no issues found")
    expect(r.status).toBe("passed")
  })

  test("extracts warning counts", () => {
    const r = parseCheckOutput("build", "3 warnings\nbuild succeeded")
    expect(r.status).toBe("passed")
    expect(r.details).toContain("3 warnings")
  })

  test("returns a neutral queued state for empty output", () => {
    expect(parseCheckOutput("smoke", "")).toEqual({ status: "queued", details: [] })
  })
})

describe("deriveStatus classifies every required state", () => {
  const checks = passing().map(normalizeCheck)

  test("offline wins over everything", () => {
    expect(deriveStatus(ctx({ connected: false }), checks, RENDER_BUDGET_DEFAULT, false)).toBe("offline")
  })
  test("denied when permission is missing", () => {
    expect(deriveStatus(ctx({ permitted: false }), checks, RENDER_BUDGET_DEFAULT, false)).toBe("denied")
  })
  test("failure when a harness error is present", () => {
    expect(deriveStatus(ctx({ error: "crash" }), checks, RENDER_BUDGET_DEFAULT, false)).toBe("failure")
  })
  test("loading during discovery or an empty running run", () => {
    expect(deriveStatus(ctx({ loading: true }), [], RENDER_BUDGET_DEFAULT, false)).toBe("loading")
    expect(deriveStatus(ctx({ running: true }), [], RENDER_BUDGET_DEFAULT, false)).toBe("loading")
  })
  test("empty when no checks and not loading/running", () => {
    expect(deriveStatus(ctx(), [], RENDER_BUDGET_DEFAULT, false)).toBe("empty")
  })
  test("degraded when the run is partial", () => {
    expect(deriveStatus(ctx({ partial: true }), checks, RENDER_BUDGET_DEFAULT, false)).toBe("degraded")
  })
  test("long-content when over budget and collapsed", () => {
    const many: CheckInput[] = [
      ...passing(),
      check({ id: "release-gate" as CheckKind, status: "passed" }),
      check({ id: "release-gate" as CheckKind, status: "passed" }),
    ]
    expect(deriveStatus(ctx(), many.map(normalizeCheck), 5, false)).toBe("long-content")
  })
  test("populated when within budget", () => {
    expect(deriveStatus(ctx(), checks, RENDER_BUDGET_DEFAULT, false)).toBe("populated")
    expect(deriveStatus(ctx(), checks, 3, true)).toBe("populated")
  })
})

describe("buildState", () => {
  test("indexes checks by id and preserves display order", () => {
    const state = buildState(passing(), ctx())
    expect(Object.keys(state.byId).sort()).toEqual([...ALL].sort())
    expect(state.order).toEqual(ALL)
    expect(state.status).toBe("populated")
  })

  test("applies overrides on top of defaults", () => {
    const state = buildState(passing(), ctx(), {
      selectedId: "lint",
      filter: "failed",
      showAll: true,
      renderBudget: 3,
    })
    expect(state.selectedId).toBe("lint")
    expect(state.filter).toBe("failed")
    expect(state.showAll).toBe(true)
    expect(state.renderBudget).toBe(3)
  })

  test("is safe on null/undefined input", () => {
    const state = buildState(undefined as unknown as CheckInput[], ctx())
    expect(state.order).toEqual([])
    expect(state.status).toBe("empty")
  })

  test("surfaces unknown checks after the known five", () => {
    const state = buildState([...passing(), check({ id: "release-gate" as CheckKind, status: "passed" })], ctx())
    expect(state.order[state.order.length - 1]).toBe("release-gate")
  })
})

describe("filtering + budget", () => {
  const checks: CheckInput[] = [
    check({ id: "lint", status: "passed" }),
    check({ id: "typecheck", status: "failed" }),
    check({ id: "build", status: "passed" }),
    check({ id: "smoke", status: "skipped" }),
    check({ id: "release-gate", status: "running" }),
  ]

  test("filterChecks narrows by status", () => {
    const byId = Object.fromEntries(checks.map((c) => [c.id, normalizeCheck(c)]))
    expect(filterChecks(ALL, byId, "all")).toHaveLength(5)
    expect(filterChecks(ALL, byId, "failed")).toEqual(["typecheck"])
    expect(filterChecks(ALL, byId, "running")).toEqual(["release-gate"])
  })

  test("visibleCheckIds respects the render budget unless expanded", () => {
    const collapsed = buildState(passing(), ctx(), { renderBudget: 3 })
    expect(visibleCheckIds(collapsed)).toHaveLength(3)
    expect(hiddenCheckCount(collapsed)).toBe(2)
    const expanded = buildState(passing(), ctx(), { renderBudget: 3, showAll: true })
    expect(visibleCheckIds(expanded)).toHaveLength(5)
    expect(hiddenCheckCount(expanded)).toBe(0)
  })
})

describe("selection", () => {
  const checks: CheckInput[] = [
    check({ id: "lint", status: "passed" }),
    check({ id: "typecheck", status: "failed" }),
    check({ id: "build", status: "passed" }),
  ]

  test("effectiveSelection defaults to the first visible check", () => {
    expect(effectiveSelection(buildState(checks, ctx()))).toBe("lint")
  })

  test("effectiveSelection keeps a still-visible selected id", () => {
    expect(effectiveSelection(buildState(checks, ctx(), { selectedId: "build" }))).toBe("build")
  })

  test("effectiveSelection falls back to first visible when filtered out", () => {
    const state = buildState(checks, ctx(), { selectedId: "lint", filter: "failed" })
    expect(effectiveSelection(state)).toBe("typecheck")
  })

  test("effectiveSelection is null for an empty panel", () => {
    expect(effectiveSelection(buildState([], ctx()))).toBeNull()
  })

  test("moveSelection walks and clamps within visible bounds", () => {
    const state = buildState(checks, ctx())
    expect(moveSelection(state, 1)).toBe("typecheck")
    expect(moveSelection({ ...state, selectedId: "typecheck" }, 1)).toBe("build")
    expect(moveSelection({ ...state, selectedId: "build" }, 1)).toBe("build")
    expect(moveSelection({ ...state, selectedId: "lint" }, -1)).toBe("lint")
  })

  test("moveSelection honors the active filter", () => {
    const list: CheckInput[] = [
      check({ id: "lint", status: "passed" }),
      check({ id: "typecheck", status: "failed" }),
      check({ id: "build", status: "failed" }),
    ]
    const state = buildState(list, ctx(), { filter: "failed" })
    expect(moveSelection(state, 1)).toBe("build")
    expect(moveSelection({ ...state, selectedId: "build" }, -1)).toBe("typecheck")
  })

  test("moveSelection returns null for an empty panel", () => {
    expect(moveSelection(buildState([], ctx()), 1)).toBeNull()
  })
})

describe("nextFilter cycles the expected order", () => {
  test("all → failed → passed → running → skipped → all", () => {
    expect(nextFilter("all")).toBe("failed")
    expect(nextFilter("failed")).toBe("passed")
    expect(nextFilter("passed")).toBe("running")
    expect(nextFilter("running")).toBe("skipped")
    expect(nextFilter("skipped")).toBe("all")
  })
  test("cycle length matches the filter table", () => {
    expect(FILTER_CYCLE).toHaveLength(5)
  })
})

describe("releaseGate aggregates readiness", () => {
  test("ready when all checks pass", () => {
    const gate = releaseGate(buildState(passing(), ctx()))
    expect(gate.status).toBe("ready")
    expect(gate.label).toBe("release ready")
  })
  test("blocked when a required check fails", () => {
    const gate = releaseGate(buildState([...passing().slice(0, 4), check({ id: "release-gate", status: "failed" })], ctx()))
    expect(gate.status).toBe("blocked")
    expect(gate.detail).toContain("required")
  })
  test("blocked when a required check is skipped", () => {
    const gate = releaseGate(buildState([...passing().slice(0, 2), check({ id: "build", status: "skipped" }), ...passing().slice(3)], ctx()))
    expect(gate.status).toBe("blocked")
  })
  test("warns but does not block when only an optional check fails", () => {
    const gate = releaseGate(buildState([...passing().slice(0, 3), check({ id: "smoke", status: "failed" }), check({ id: "release-gate", status: "passed" })], ctx()))
    expect(gate.status).toBe("warning")
    expect(gate.label).toContain("warnings")
  })
  test("pending while a required check is still running", () => {
    const gate = releaseGate(buildState([...passing().slice(0, 3), check({ id: "smoke", status: "passed" }), check({ id: "release-gate", status: "running" })], ctx()))
    expect(gate.status).toBe("warning")
    expect(gate.detail).toContain("in progress")
  })
  test("unknown when there are no checks", () => {
    expect(releaseGate(buildState([], ctx())).status).toBe("unknown")
  })
})

describe("presentation helpers", () => {
  test("glyphs differ for color vs no-color terminals", () => {
    expect(checkStatusGlyph("passed", true)).toBe("✓")
    expect(checkStatusGlyph("passed", false)).toBe("P")
    expect(checkStatusGlyph("failed", true)).toBe("✗")
    expect(checkStatusGlyph("failed", false)).toBe("X")
    expect(checkStatusGlyph("skipped", true)).toBe("↓")
    expect(checkStatusLabel("running")).toBe("running")
  })

  test("formatDuration renders compact durations", () => {
    expect(formatDuration(0)).toBe("0ms")
    expect(formatDuration(250)).toBe("250ms")
    expect(formatDuration(1500)).toBe("1.5s")
    expect(formatDuration(65_000)).toBe("1m5s")
    expect(formatDuration(undefined)).toBe("0ms")
  })

  test("isNarrowTerminal detects narrow widths", () => {
    expect(isNarrowTerminal(40)).toBe(true)
    expect(isNarrowTerminal(60)).toBe(false)
    expect(isNarrowTerminal(59, 60)).toBe(true)
    expect(NARROW_WIDTH_DEFAULT).toBe(60)
  })

  test("fitWidth truncates without breaking on tiny widths", () => {
    expect(fitWidth("hello world", 20)).toBe("hello world")
    expect(fitWidth("hello world", 5)).toBe("hell…")
    expect(fitWidth("hi", 1)).toBe("h…")
    expect(fitWidth("hi", 0)).toBe("")
  })

  test("supportsColor reflects the color level", () => {
    expect(supportsColor(0)).toBe(false)
    expect(supportsColor(3)).toBe(true)
    expect(supportsColor(undefined)).toBe(true)
  })

  test("redactFailure masks secrets", () => {
    expect(redactFailure("api_key = supersecretvalue123")).toContain("••••")
    expect(redactFailure("clean message")).toBe("clean message")
  })

  test("summary describes every status and redacts failure context", () => {
    expect(summary(buildState([], ctx({ loading: true })))).toContain("Validating")
    expect(summary(buildState([], ctx({ connected: false })))).toContain("offline")
    expect(summary(buildState([], ctx({ permitted: false })))).toContain("permission")
    expect(summary(buildState([], ctx({ error: "Bearer secret-token-1234567890" })))).toContain("••••")
    expect(summary(buildState([], ctx()))).toContain("No validation")
    const populated = buildState(
      [check({ id: "lint", status: "passed" }), check({ id: "typecheck", status: "failed" }), check({ id: "build", status: "skipped" })],
      ctx(),
    )
    const text = summary(populated)
    expect(text).toContain("1 passed")
    expect(text).toContain("1 failed")
    expect(text).toContain("1 skipped")
  })
})

describe("BUILD_CHECKS metadata is a complete, ordered contract", () => {
  test("exposes exactly the five required checks in display order", () => {
    expect(BUILD_CHECKS.map((c) => c.id)).toEqual([
      "lint",
      "typecheck",
      "build",
      "smoke",
      "release-gate",
    ])
  })
  test("release-gate and the core three are required; smoke is optional", () => {
    const required = BUILD_CHECKS.filter((c) => c.required).map((c) => c.id)
    expect(required).toEqual(["lint", "typecheck", "build", "release-gate"])
    expect(BUILD_CHECKS.find((c) => c.id === "smoke")?.required).toBe(false)
  })
})
