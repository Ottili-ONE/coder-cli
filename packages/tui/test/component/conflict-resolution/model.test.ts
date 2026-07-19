import { describe, expect, test } from "bun:test"
import {
  NARROW_WIDTH_DEFAULT,
  RENDER_BUDGET,
  abortAction,
  buildAccessibleSummary,
  capRenderBudget,
  conflictResolutionState,
  continueAction,
  detectNoColor,
  filterFiles,
  focusIndexForPath,
  isCollapsedActionWidth,
  isNarrowTerminal,
  makeConflict,
  mergeConflicts,
  moveFocus,
  normalizeConflictType,
  previewFocusTab,
  resolutionBadge,
  resolveAction,
  resolveFile,
  selectAction,
  togglePreview,
  totalConflictRegions,
  unresolveFile,
  validateResolution,
  type ConflictContext,
  type ConflictFile,
} from "../../../src/component/conflict-resolution/model"

function files(over: Partial<ConflictFile>[] = []): ConflictFile[] {
  const base = ["src/a.ts", "src/b.ts", "src/c.ts", "docs/README.md"]
  return base.map((path, i) => makeConflict(path, "merge", over[i] ?? {}))
}

function ctx(over: Partial<ConflictContext> = {}): ConflictContext {
  return { loading: false, ...over }
}

describe("normalizeConflictType accepts merge/rebase only", () => {
  test("passes through merge and rebase", () => {
    expect(normalizeConflictType("merge")).toBe("merge")
    expect(normalizeConflictType("rebase")).toBe("rebase")
  })
  test("falls back to unknown for anything else", () => {
    expect(normalizeConflictType("cherry-pick")).toBe("unknown")
    expect(normalizeConflictType(undefined)).toBe("unknown")
  })
})

describe("resolveFile / unresolveFile drive validation", () => {
  test("resolving a file flips its resolution and content", () => {
    const next = resolveFile(files(), "src/a.ts", "ours")
    expect(next[0].resolution).toBe("ours")
    expect(next[0].content).toBeUndefined()
  })
  test("manual resolution keeps the edited content", () => {
    const next = resolveFile(files(), "src/a.ts", "manual", "edited body")
    expect(next[0].resolution).toBe("manual")
    expect(next[0].content).toBe("edited body")
  })
  test("binary conflicts can still be resolved to a side", () => {
    const list = [makeConflict("img.png", "merge", { binary: true })]
    const next = resolveFile(list, "img.png", "theirs")
    expect(next[0].resolution).toBe("theirs")
  })
  test("unresolve returns a file to the unresolved state", () => {
    const resolved = resolveFile(files(), "src/a.ts", "ours")
    const undone = unresolveFile(resolved, "src/a.ts")
    expect(undone[0].resolution).toBeUndefined()
    expect(undone[0].content).toBeUndefined()
  })
  test("only the targeted file changes", () => {
    const next = resolveFile(files(), "src/c.ts", "theirs")
    expect(next[2].resolution).toBe("theirs")
    expect(next[0].resolution).toBeUndefined()
    expect(next[1].resolution).toBeUndefined()
  })
})

describe("validateResolution classifies the whole set", () => {
  test("all unresolved", () => {
    const report = validateResolution(files())
    expect(report.total).toBe(4)
    expect(report.resolved).toBe(0)
    expect(report.unresolved).toBe(4)
    expect(report.allResolved).toBe(false)
    expect(report.remaining.length).toBe(4)
  })
  test("partial resolution reports the remaining subset", () => {
    let list = resolveFile(files(), "src/a.ts", "ours")
    list = resolveFile(list, "src/b.ts", "theirs")
    const report = validateResolution(list)
    expect(report.resolved).toBe(2)
    expect(report.unresolved).toBe(2)
    expect(report.allResolved).toBe(false)
    expect(report.remaining.map((f) => f.path)).toEqual(["src/c.ts", "docs/README.md"])
  })
  test("every file resolved is ready to continue", () => {
    let list = files()
    for (const f of list) list = resolveFile(list, f.path, "union")
    const report = validateResolution(list)
    expect(report.resolved).toBe(4)
    expect(report.unresolved).toBe(0)
    expect(report.allResolved).toBe(true)
  })
  test("an empty set is not 'all resolved' (guards the guard)", () => {
    expect(validateResolution([]).allResolved).toBe(false)
  })
})

describe("conflictResolutionState derives a semantic summary", () => {
  test("ready state shows resolved / total progress", () => {
    const list = resolveFile(files(), "src/a.ts", "ours")
    const state = conflictResolutionState(list, ctx(), { width: 120 })
    expect(state.summaryText).toBe("Merge conflicts — 1/4 resolved · 3 to go")
    expect(state.status).toBe("ready")
  })
  test("all resolved reports readiness to continue", () => {
    let list = files()
    for (const f of list) list = resolveFile(list, f.path, "union")
    const state = conflictResolutionState(list, ctx(), { width: 120 })
    expect(state.summaryText).toBe("Merge conflicts — 4/4 resolved · ready to continue")
    expect(state.allResolved).toBe(true)
  })
  test("rebase operation uses the rebase word", () => {
    const list = files().map((f) => makeConflict(f.path, "rebase"))
    expect(conflictResolutionState(list, ctx(), { width: 120 }).summaryText).toBe(
      "Rebase conflicts — 0/4 resolved · 4 to go",
    )
  })
  test("empty list is a distinct, non-error state", () => {
    const state = conflictResolutionState([], ctx(), { width: 120 })
    expect(state.status).toBe("empty")
    expect(state.summaryText).toBe("Merge conflicts — none")
  })
})

describe("accessibleSummary provides screen-reader-friendly text", () => {
  test("error state reflects error without file names", () => {
    const state = conflictResolutionState(files(), ctx({ error: "fatal: bad object" }), { width: 120 })
    expect(state.accessibleSummary).toContain("Conflict resolution failed")
    expect(state.accessibleSummary).not.toContain("src/a.ts")
  })
  test("empty state returns just the base summary", () => {
    const state = conflictResolutionState([], ctx(), { width: 120 })
    expect(state.accessibleSummary).toBe("Merge conflicts — none")
  })
  test("few files (< 5) lists them explicitly", () => {
    const list = files().slice(0, 3)
    const state = conflictResolutionState(list, ctx(), { width: 120 })
    expect(state.accessibleSummary).toContain("Files: src/a.ts, src/b.ts, src/c.ts")
  })
  test("many files (> 5) shows count only", () => {
    const list = Array.from({ length: 10 }, (_, i) => makeConflict(`file-${i}.ts`, "merge"))
    const state = conflictResolutionState(list, ctx(), { width: 120 })
    expect(state.accessibleSummary).toContain("10 files total")
    expect(state.accessibleSummary).not.toContain("file-0.ts")
  })
  test("accessibleSummary contains the summaryText prefix", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120 })
    expect(state.accessibleSummary).toContain(state.summaryText)
  })
})

describe("terminal width drives narrow rendering", () => {
  test("standard width is not narrow", () => {
    expect(isNarrowTerminal(120)).toBe(false)
    const state = conflictResolutionState(files(), ctx(), { width: 120 })
    expect(state.narrow).toBe(false)
  })
  test("narrow width flips the narrow flag at the default threshold", () => {
    expect(isNarrowTerminal(NARROW_WIDTH_DEFAULT - 1)).toBe(true)
    expect(isNarrowTerminal(NARROW_WIDTH_DEFAULT)).toBe(false)
    const state = conflictResolutionState(files(), ctx(), { width: 40 })
    expect(state.narrow).toBe(true)
  })
})

describe("collapsedActions detection", () => {
  test("below 60 cols collapses action bar", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 50 })
    expect(state.collapsedActions).toBe(true)
  })
  test("at 60 cols or above keeps full action bar", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 60 })
    expect(state.collapsedActions).toBe(false)
  })
  test("explicit override works", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120, collapsedActions: true })
    expect(state.collapsedActions).toBe(true)
  })
})

describe("no-color detection", () => {
  test("defaults to false for auto detection", () => {
    // Without NO_COLOR set, detectNoColor should return false.
    // The state constructor uses detectNoColor() internally.
    expect(detectNoColor()).toBe(false)
  })
  test("explicit override works", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120, noColor: true })
    expect(state.noColor).toBe(true)
  })
})

describe("keyboard focus navigation clamps and jumps", () => {
  test("focus starts on the first file", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120 })
    expect(state.focusIndex).toBe(0)
    expect(state.focusedPath).toBe("src/a.ts")
  })
  test("down/up move and clamp at the ends", () => {
    let state = conflictResolutionState(files(), ctx(), { width: 120 })
    state = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: moveFocus(state, 1) })
    expect(state.focusedPath).toBe("src/b.ts")
    // Past the end clamps to the last file.
    state = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: moveFocus(state, 1) })
    state = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: moveFocus(state, 1) })
    state = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: moveFocus(state, 1) })
    expect(state.focusedPath).toBe("docs/README.md")
    // Past the start clamps to the first file.
    state = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: moveFocus(state, -1) })
    state = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: moveFocus(state, -1) })
    state = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: moveFocus(state, -1) })
    expect(state.focusedPath).toBe("src/a.ts")
  })
  test("focusIndexForPath jumps straight to a file", () => {
    const list = files()
    expect(focusIndexForPath(list, "docs/README.md")).toBe(3)
    expect(focusIndexForPath(list, "missing.ts")).toBe(-1)
  })
  test("focus survives a narrow resize", () => {
    const wide = conflictResolutionState(files(), ctx(), { width: 120, focusIndex: 2 })
    const narrowed = conflictResolutionState(files(), ctx(), { width: 40, focusIndex: wide.focusIndex })
    expect(narrowed.focusedPath).toBe("src/c.ts")
  })
})

describe("action mapping emits the right intent", () => {
  test("select targets the focused file", () => {
    expect(selectAction("src/a.ts")).toEqual({ type: "select", path: "src/a.ts" })
    expect(selectAction(null)).toBeNull()
  })
  test("resolve targets the focused file and side", () => {
    expect(resolveAction("src/a.ts", "ours")).toEqual({ type: "resolve", path: "src/a.ts", side: "ours" })
    expect(resolveAction(null, "theirs")).toBeNull()
  })
  test("abort is unconditional", () => {
    expect(abortAction()).toEqual({ type: "abort" })
  })
  test("continue is blocked while conflicts remain (failure path)", () => {
    const blocked = continueAction(false, 3) as { type: "blocked"; reason: string }
    expect(blocked.type).toBe("blocked")
    expect(blocked.reason).toBe("3 conflicts still unresolved")
    expect(continueAction(true, 0)).toEqual({ type: "continue" })
  })
})

describe("resolutionBadge shows readable state", () => {
  test("unresolved, side and manual markers", () => {
    expect(resolutionBadge(makeConflict("a"))).toBe("[ ]")
    expect(resolutionBadge(makeConflict("a", "merge", { resolution: "ours" }))).toBe("[ours]")
    expect(resolutionBadge(makeConflict("a", "merge", { resolution: "manual" }))).toBe("[manual]")
  })
})

describe("streaming updates reconcile partial conflict lists", () => {
  test("merging a partial list appends new files and preserves resolutions", () => {
    const prev = resolveFile(files(), "src/a.ts", "ours")
    const partial = [makeConflict("src/d.ts", "merge")]
    const next = mergeConflicts(prev, partial)
    expect(next.map((f) => f.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "docs/README.md",
      "src/d.ts",
    ])
    // Resolution on an existing file survives a partial re-emit.
    expect(next[0].resolution).toBe("ours")
  })
  test("a streaming refresh marks the panel stale", () => {
    const state = conflictResolutionState(files(), ctx({ loading: true }), { width: 120 })
    expect(state.status).toBe("resolving")
    expect(state.stale).toBe(true)
  })
  test("the panel settles once the refresh lands", () => {
    const streaming = conflictResolutionState(files(), ctx({ loading: true }), { width: 120 })
    const settled = conflictResolutionState(files(), ctx({ loading: false }), { width: 120 })
    expect(streaming.status).toBe("resolving")
    expect(settled.status).toBe("ready")
    expect(settled.stale).toBe(false)
  })
})

describe("failure path classifies and redacts errors", () => {
  test("error context drives the error status and safe summary", () => {
    const state = conflictResolutionState(files(), ctx({ error: "fatal: bad object" }), { width: 120 })
    expect(state.status).toBe("error")
    expect(state.summaryText).toContain("Conflict resolution failed")
    expect(state.summaryText).toContain("bad object")
  })
  test("secrets in the error are redacted in the summary", () => {
    const state = conflictResolutionState(
      files(),
      ctx({ error: "fatal: token=sk-live-abcdefghijklmnop rejected" }),
      { width: 120 },
    )
    expect(state.summaryText).not.toContain("sk-live")
    expect(state.summaryText).toContain("••••")
  })
  test("an error hides the file list and actions", () => {
    const state = conflictResolutionState(files(), ctx({ error: "boom" }), { width: 120 })
    expect(state.focusedPath).toBeNull()
  })
})

describe("filterFiles narrows the file list by path substring", () => {
  test("empty query returns the original list", () => {
    const list = files()
    const result = filterFiles(list, "")
    expect(result).toEqual(list)
  })
  test("case-insensitive substring match", () => {
    const result = filterFiles(files(), "src")
    expect(result.length).toBe(3)
    expect(result.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"])
  })
  test("no match returns empty array", () => {
    expect(filterFiles(files(), "nonexistent").length).toBe(0)
  })
  test("partial path match works", () => {
    const result = filterFiles(files(), "README")
    expect(result.length).toBe(1)
    expect(result[0].path).toBe("docs/README.md")
  })
})

describe("togglePreview opens and closes with file index tracking", () => {
  test("opening preview sets previewOpen true and records the file index", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120 })
    const next = togglePreview(state, 2)
    expect(next.previewOpen).toBe(true)
    expect(next.previewFileIndex).toBe(2)
    expect(next.previewFocus).toBe("list")
  })
  test("toggling the same file index closes preview", () => {
    const state = { ...conflictResolutionState(files(), ctx(), { width: 120 }), previewOpen: true, previewFileIndex: 2 }
    const next = togglePreview(state as any, 2)
    expect(next.previewOpen).toBe(false)
  })
  test("toggling a different file index switches the preview file", () => {
    const state = { ...conflictResolutionState(files(), ctx(), { width: 120 }), previewOpen: true, previewFileIndex: 0 }
    const next = togglePreview(state as any, 3)
    expect(next.previewOpen).toBe(true)
    expect(next.previewFileIndex).toBe(3)
  })
})

describe("previewFocusTab cycles the focus zone", () => {
  test("from list to regions", () => {
    const state = { ...conflictResolutionState(files(), ctx(), { width: 120 }), previewFocus: "list" as const }
    expect(previewFocusTab(state as any)).toBe("regions")
  })
  test("from regions to list", () => {
    const state = { ...conflictResolutionState(files(), ctx(), { width: 120 }), previewFocus: "regions" as const }
    expect(previewFocusTab(state as any)).toBe("list")
  })
})

describe("totalConflictRegions sums across files", () => {
  test("zero when no file has conflict regions", () => {
    expect(totalConflictRegions(files())).toBe(0)
  })
  test("counts conflictRegions from all files", () => {
    const list = [
      makeConflict("a.ts", "merge", { conflictRegions: 3 }),
      makeConflict("b.ts", "merge", { conflictRegions: 5 }),
      makeConflict("c.ts", "merge"),
    ]
    expect(totalConflictRegions(list)).toBe(8)
  })
})

describe("capRenderBudget limits display files", () => {
  test("list within budget is not capped", () => {
    const list = files()
    const result = capRenderBudget(list, 50)
    expect(result.capped).toBe(false)
    expect(result.cappedCount).toBe(0)
    expect(result.display).toEqual(list)
  })
  test("list exceeding budget is truncated", () => {
    const large = Array.from({ length: 100 }, (_, i) => makeConflict(`f-${i}.ts`))
    const result = capRenderBudget(large, 10)
    expect(result.capped).toBe(true)
    expect(result.cappedCount).toBe(90)
    expect(result.display.length).toBe(10)
    expect(result.display[0].path).toBe("f-0.ts")
    expect(result.display[9].path).toBe("f-9.ts")
  })
  test("state includes displayFiles from capping", () => {
    const large = Array.from({ length: RENDER_BUDGET + 10 }, (_, i) => makeConflict(`f-${i}.ts`, "merge"))
    const state = conflictResolutionState(large, ctx(), { width: 120 })
    expect(state.capped).toBe(true)
    expect(state.cappedCount).toBe(10)
    expect(state.displayFiles.length).toBe(RENDER_BUDGET)
  })
})

describe("isCollapsedActionWidth", () => {
  test("below 60 is collapsed", () => {
    expect(isCollapsedActionWidth(59)).toBe(true)
  })
  test("at 60 or above is not collapsed", () => {
    expect(isCollapsedActionWidth(60)).toBe(false)
    expect(isCollapsedActionWidth(100)).toBe(false)
  })
})

describe("conflictResolutionState includes preview and filter fields", () => {
  test("preview state defaults to closed with no file", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120 })
    expect(state.previewOpen).toBe(false)
    expect(state.previewFileIndex).toBe(0)
    expect(state.previewFocus).toBe("list")
  })
  test("preview overrides are reflected in state", () => {
    const state = conflictResolutionState(files(), ctx(), {
      width: 120,
      previewOpen: true,
      previewFileIndex: 1,
      previewFocus: "regions",
    })
    expect(state.previewOpen).toBe(true)
    expect(state.previewFileIndex).toBe(1)
    expect(state.previewFocus).toBe("regions")
  })
  test("filter query defaults to empty and filteredFiles equals files", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120 })
    expect(state.filterQuery).toBe("")
    expect(state.filteredFiles).toBe(state.files)
  })
  test("filter query filters the file list", () => {
    const state = conflictResolutionState(files(), ctx(), { width: 120, filterQuery: "src" })
    expect(state.filterQuery).toBe("src")
    expect(state.filteredFiles.length).toBe(3)
  })
  test("conflictRegionsTotal appears on the state", () => {
    const list = [makeConflict("a.ts", "merge", { conflictRegions: 3 })]
    const state = conflictResolutionState(list, ctx(), { width: 120 })
    expect(state.conflictRegionsTotal).toBe(3)
  })
  test("new fields appear on state", () => {
    const list = [makeConflict("a.ts", "merge", { conflictRegions: 3 })]
    const state = conflictResolutionState(list, ctx(), { width: 50, noColor: true })
    expect(state.capped).toBe(false)
    expect(state.cappedCount).toBe(0)
    expect(state.collapsedActions).toBe(true)
    expect(state.noColor).toBe(true)
    expect(state.accessibleSummary).toBeTruthy()
  })
})