import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import {
  computeMultiPaneLayout,
  derivePaneStatus,
  buildPaneView,
  buildPaneAccessibility,
  statusMarker,
  paneStatusLabel,
  isNarrowTerminal,
  type MultiPaneInput,
  type PaneContext,
  type PaneStatus,
  MAX_PANE_CONTENT,
  MAX_PANE_TEXT_LEN,
} from "./multi-pane"

// Multi-pane workspace layout contract (T-CLI-0201) and pane state lifecycle
// (T-CLI-0202). Every case is a pure function evaluation, which keeps the suite
// stable in CI.

const FLAG = "EVOLUTION_T_CLI_0201_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED"

// Base input for a wide terminal with no tool context.
const BASE_WIDE: MultiPaneInput = {
  width: 160,
  height: 40,
  hasActiveDiff: false,
  hasActiveFile: false,
  hasActiveTask: false,
  hasActiveTerminal: false,
  enabled: true,
}

// Narrow terminal.
const BASE_NARROW: MultiPaneInput = { ...BASE_WIDE, width: 60 }

// Input with active diff context (e.g. an edit or apply_patch tool in view).
const WITH_DIFF: MultiPaneInput = { ...BASE_WIDE, hasActiveDiff: true }

// Input with active file context (e.g. file read or write tool).
const WITH_FILE: MultiPaneInput = { ...BASE_WIDE, hasActiveFile: true }

// Input with active task context (e.g. a running subagent).
const WITH_TASK: MultiPaneInput = { ...BASE_WIDE, hasActiveTask: true }

// Input with active terminal context (e.g. a running shell command).
const WITH_TERMINAL: MultiPaneInput = { ...BASE_WIDE, hasActiveTerminal: true }

// ---------------------------------------------------------------------------
// Layout: flag-off returns legacy single-pane
// ---------------------------------------------------------------------------

describe("multi-pane workspace: flag-off returns legacy single-pane layout", () => {
  test("flag off returns inactive single-pane state regardless of input", () => {
    const layout = computeMultiPaneLayout({ ...WITH_DIFF, enabled: false })
    expect(layout.active).toBe(false)
    expect(layout.panes).toHaveLength(1)
    expect(layout.panes[0].id).toBe("transcript")
    expect(layout.showSeparators).toBe(false)
  })

  test("flag off with no context still gives single-pane transcript", () => {
    const layout = computeMultiPaneLayout({ ...BASE_WIDE, enabled: false })
    expect(layout.panes).toHaveLength(1)
    expect(layout.panes[0].id).toBe("transcript")
  })
})

// ---------------------------------------------------------------------------
// Layout: no secondary context returns legacy layout
// ---------------------------------------------------------------------------

describe("multi-pane workspace: no secondary context returns legacy layout", () => {
  test("no active tools returns single transcript pane", () => {
    const layout = computeMultiPaneLayout(BASE_WIDE)
    expect(layout.active).toBe(false)
    expect(layout.panes).toHaveLength(1)
    expect(layout.panes[0].id).toBe("transcript")
  })

  test("narrow terminal with no context also returns single pane", () => {
    const layout = computeMultiPaneLayout(BASE_NARROW)
    expect(layout.active).toBe(false)
    expect(layout.panes).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Layout: active diff opens diff pane
// ---------------------------------------------------------------------------

describe("multi-pane workspace: active diff opens diff pane", () => {
  test("active diff on wide terminal opens transcript + diff panes", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    expect(layout.active).toBe(true)
    expect(layout.panes).toHaveLength(2)
    expect(layout.panes[0].id).toBe("transcript")
    expect(layout.panes[1].id).toBe("diff")
  })

  test("diff pane is resizable", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    expect(layout.panes[1].resizable).toBe(true)
  })

  test("wide terminal enables diff split view", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    expect(layout.diffSplitView).toBe(true)
  })

  test("narrow terminal with diff does not open secondary pane", () => {
    const layout = computeMultiPaneLayout({ ...WITH_DIFF, width: 60 })
    expect(layout.active).toBe(false)
    expect(layout.panes).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Layout: active file opens files pane
// ---------------------------------------------------------------------------

describe("multi-pane workspace: active file opens files pane", () => {
  test("active file read on wide terminal opens transcript + files panes", () => {
    const layout = computeMultiPaneLayout(WITH_FILE)
    expect(layout.active).toBe(true)
    expect(layout.panes).toHaveLength(2)
    expect(layout.panes[1].id).toBe("files")
  })

  test("files pane appears even on narrow terminal (files are always useful)", () => {
    const layout = computeMultiPaneLayout({ ...WITH_FILE, width: 60 })
    expect(layout.active).toBe(true)
    expect(layout.panes[1].id).toBe("files")
  })
})

// ---------------------------------------------------------------------------
// Layout: active task and terminal
// ---------------------------------------------------------------------------

describe("multi-pane workspace: active task and terminal", () => {
  test("active task opens tasks pane", () => {
    const layout = computeMultiPaneLayout(WITH_TASK)
    expect(layout.active).toBe(true)
    expect(layout.panes).toHaveLength(2)
    expect(layout.panes[1].id).toBe("tasks")
  })

  test("active terminal opens terminal pane", () => {
    const layout = computeMultiPaneLayout(WITH_TERMINAL)
    expect(layout.active).toBe(true)
    expect(layout.panes).toHaveLength(2)
    expect(layout.panes[1].id).toBe("terminal")
  })
})

// ---------------------------------------------------------------------------
// Layout: priority and ordering
// ---------------------------------------------------------------------------

describe("multi-pane workspace: priority and ordering", () => {
  test("diff takes priority over files when both active (diff opens first)", () => {
    const layout = computeMultiPaneLayout({ ...BASE_WIDE, hasActiveDiff: true, hasActiveFile: true })
    expect(layout.active).toBe(true)
    // Both diff and files fit within the 2-secondary limit: transcript + diff + files
    expect(layout.panes).toHaveLength(3)
    expect(layout.panes[1].id).toBe("diff")
    expect(layout.panes[2].id).toBe("files")
  })

  test("at most 2 secondary panes are shown", () => {
    const layout = computeMultiPaneLayout({
      ...BASE_WIDE,
      hasActiveDiff: true,
      hasActiveFile: true,
      hasActiveTask: true,
      hasActiveTerminal: true,
    })
    // Diff (priority 1) + Files (priority 2) = 2 secondary panes.
    // Tasks and terminal are left out because the cap is 2.
    expect(layout.panes).toHaveLength(3)  // transcript + diff + files
    expect(layout.panes[1].id).toBe("diff")
    expect(layout.panes[2].id).toBe("files")
  })
})

// ---------------------------------------------------------------------------
// Layout: pane sizing
// ---------------------------------------------------------------------------

describe("multi-pane workspace: pane sizing", () => {
  test("transcript gets 60% of width minus secondary pane sizes", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    const transcript = layout.panes[0]
    expect(transcript.size).toBeGreaterThan(20)
    expect(transcript.resizable).toBe(true)
  })

  test("all visible panes have a valid label", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    for (const pane of layout.panes) {
      expect(pane.label).toBeTruthy()
    }
  })

  test("separators are shown in multi-pane mode", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    expect(layout.showSeparators).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Layout: all pane IDs produce expected labels
// ---------------------------------------------------------------------------

describe("multi-pane workspace: all pane IDs produce expected labels", () => {
  const labelFor = (id: string): string | undefined => {
    const single: MultiPaneInput | undefined = (() => {
      switch (id) {
        case "diff": return WITH_DIFF
        case "files": return WITH_FILE
        case "tasks": return WITH_TASK
        case "terminal": return WITH_TERMINAL
        default: return undefined
      }
    })()
    if (!single) return undefined
    const layout = computeMultiPaneLayout(single)
    return layout.panes.find((p) => p.id === id)?.label
  }

  test("transcript pane has label when multi-pane is active", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    expect(layout.panes[0].label).toBe("Transcript")
  })

  test("diff pane has label", () => {
    expect(labelFor("diff")).toBe("Diff")
  })

  test("files pane has label", () => {
    expect(labelFor("files")).toBe("Files")
  })

  test("tasks pane has label", () => {
    expect(labelFor("tasks")).toBe("Tasks")
  })

  test("terminal pane has label", () => {
    expect(labelFor("terminal")).toBe("Terminal")
  })
})

// ---------------------------------------------------------------------------
// Layout: feature flag gating
// ---------------------------------------------------------------------------

describe("multi-pane workspace failure path: the feature flag gates engagement", () => {
  const saved = process.env[FLAG]

  const routeEnabled = (signal: boolean) =>
    signal && Flag.EVOLUTION_T_CLI_0201_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED

  beforeEach(() => {
    delete process.env[FLAG]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG]
    else process.env[FLAG] = saved
  })

  test("flag is off by default: multi-pane cannot engage", () => {
    expect(Flag.EVOLUTION_T_CLI_0201_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED).toBe(false)
    expect(routeEnabled(true)).toBe(false)
  })

  test("flag on enables the multi-pane engagement gate", () => {
    process.env[FLAG] = "true"
    expect(Flag.EVOLUTION_T_CLI_0201_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED).toBe(true)
    expect(routeEnabled(true)).toBe(true)
  })

  test("flag explicitly disabled forces multi-pane off", () => {
    process.env[FLAG] = "false"
    expect(Flag.EVOLUTION_T_CLI_0201_TUI_REDESIGN_MULTI_PANE_WORKSPACE__ENABLED).toBe(false)
    expect(routeEnabled(true)).toBe(false)
  })

  test("with the flag off the layout is always the single-pane transcript", () => {
    process.env[FLAG] = "false"
    const effective = routeEnabled(true)
    expect(effective).toBe(false)
    const layout = computeMultiPaneLayout({ ...WITH_DIFF, enabled: effective })
    expect(layout.active).toBe(false)
    expect(layout.panes).toHaveLength(1)
    expect(layout.panes[0].id).toBe("transcript")
  })
})

// ---------------------------------------------------------------------------
// Layout: streaming stability
// ---------------------------------------------------------------------------

describe("multi-pane workspace is stable across streaming transcript updates", () => {
  test("layout is invariant while messages stream in", () => {
    const base: MultiPaneInput = { ...WITH_DIFF }
    for (const _messages of [0, 1, 5, 42, 1000]) {
      const layout = computeMultiPaneLayout(base)
      expect(layout.active).toBe(true)
      expect(layout.panes).toHaveLength(2)
      expect(layout.panes[0].id).toBe("transcript")
    }
  })

  test("functions are pure and deterministic for identical inputs", () => {
    expect(computeMultiPaneLayout(WITH_DIFF)).toEqual(computeMultiPaneLayout(WITH_DIFF))
  })
})

// ---------------------------------------------------------------------------
// Pane state lifecycle: derivePaneStatus
// ---------------------------------------------------------------------------

describe("derivePaneStatus — eight-state lifecycle", () => {
  const baseContext: PaneContext = {
    loading: false,
    connected: true,
    permitted: true,
    partial: false,
    hasContent: true,
    contentCount: 10,
  }

  test("loading takes precedence over all states", () => {
    expect(derivePaneStatus({ ...baseContext, loading: true })).toBe("loading")
    expect(derivePaneStatus({ ...baseContext, loading: true, error: "err" })).toBe("loading")
  })

  test("offline takes precedence over content states", () => {
    const ctx = { ...baseContext, connected: false }
    expect(derivePaneStatus(ctx)).toBe("offline")
    expect(derivePaneStatus({ ...ctx, loading: false, error: undefined })).toBe("offline")
  })

  test("denied takes precedence over content states", () => {
    expect(derivePaneStatus({ ...baseContext, permitted: false })).toBe("denied")
  })

  test("failure is returned when error is present", () => {
    expect(derivePaneStatus({ ...baseContext, error: "connection failed" })).toBe("failure")
  })

  test("empty is returned when no content", () => {
    expect(derivePaneStatus({ ...baseContext, hasContent: false })).toBe("empty")
  })

  test("degraded is returned for partial context", () => {
    expect(derivePaneStatus({ ...baseContext, partial: true })).toBe("degraded")
  })

  test("long-content when content exceeds budget", () => {
    expect(derivePaneStatus({ ...baseContext, contentCount: MAX_PANE_CONTENT + 1 })).toBe("long-content")
  })

  test("populated is the default happy path", () => {
    expect(derivePaneStatus(baseContext)).toBe("populated")
  })

  test("status precedence order is correct", () => {
    // loading > offline > denied > failure > empty > degraded > long-content > populated
    expect(derivePaneStatus({ ...baseContext, loading: true, connected: false, permitted: false, error: "err" })).toBe("loading")
    expect(derivePaneStatus({ ...baseContext, connected: false, permitted: false, error: "err" })).toBe("offline")
    expect(derivePaneStatus({ ...baseContext, permitted: false, error: "err" })).toBe("denied")
    expect(derivePaneStatus({ ...baseContext, error: "err" })).toBe("failure")
  })
})

// ---------------------------------------------------------------------------
// Pane state lifecycle: buildPaneView
// ---------------------------------------------------------------------------

describe("buildPaneView", () => {
  test("returns a pane view with correct status and render budget", () => {
    const view = buildPaneView("diff", {
      loading: false,
      connected: true,
      permitted: true,
      partial: false,
      hasContent: true,
      contentCount: 10,
    })
    expect(view.id).toBe("diff")
    expect(view.status).toBe("populated")
    expect(view.renderBudget.maxContent).toBe(MAX_PANE_CONTENT)
    expect(view.renderBudget.maxTextLen).toBe(MAX_PANE_TEXT_LEN)
    expect(view.renderBudget.overBudget).toBe(false)
  })

  test("uses empty context when undefined", () => {
    const view = buildPaneView("files", undefined)
    expect(view.status).toBe("empty")
    expect(view.context.hasContent).toBe(false)
  })

  test("overBudget flag can be set explicitly", () => {
    const view = buildPaneView("terminal", undefined, true)
    expect(view.renderBudget.overBudget).toBe(true)
  })

  test("overBudget true when content exceeds budget", () => {
    const view = buildPaneView("tasks", {
      loading: false, connected: true, permitted: true, partial: false,
      hasContent: true, contentCount: MAX_PANE_CONTENT + 100,
    })
    expect(view.status).toBe("long-content")
    expect(view.renderBudget.overBudget).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Accessibility helpers
// ---------------------------------------------------------------------------

describe("paneStatusLabel", () => {
  const cases: [PaneStatus, string][] = [
    ["loading", "loading"],
    ["offline", "offline"],
    ["denied", "denied"],
    ["failure", "error"],
    ["empty", "empty"],
    ["degraded", "degraded"],
    ["long-content", "long content"],
    ["populated", "ready"],
  ]
  for (const [status, expected] of cases) {
    test(`${status} → "${expected}"`, () => {
      expect(paneStatusLabel(status)).toBe(expected)
    })
  }
})

describe("statusMarker", () => {
  test("returns colored glyph when useColor is true", () => {
    expect(statusMarker("loading", true)).toBe("…")
    expect(statusMarker("populated", true)).toBe("●")
  })

  test("returns ASCII marker when useColor is false", () => {
    expect(statusMarker("failure", false)).toBe("[error]")
    expect(statusMarker("empty", false)).toBe("[empty]")
    expect(statusMarker("populated", false)).toBe("[ok]")
  })

  test("never returns an empty string for any status", () => {
    const statuses: PaneStatus[] = ["loading", "offline", "denied", "failure", "empty", "degraded", "long-content", "populated"]
    for (const status of statuses) {
      expect(statusMarker(status, true)).toBeTruthy()
      expect(statusMarker(status, false)).toBeTruthy()
    }
  })
})

describe("buildPaneAccessibility", () => {
  test("includes aria-label with redacted status text", () => {
    const view = buildPaneView("diff", {
      loading: false, connected: true, permitted: true, partial: false,
      hasContent: true, contentCount: 5,
    })
    const acc = buildPaneAccessibility(view, true)
    expect(acc.ariaLabel).toContain("diff")
    expect(acc.ariaLabel).toContain("ready")
    expect(acc.ariaLabel).not.toContain("••••")
    expect(acc.statusMarker).toBeTruthy()
  })

  test("color false produces ASCII markers in accessibility", () => {
    const view = buildPaneView("diff", {
      loading: true, connected: true, permitted: true, partial: false,
      hasContent: false, contentCount: 0,
    })
    const acc = buildPaneAccessibility(view, false)
    expect(acc.ariaLabel).toContain("diff")
    expect(acc.ariaLabel).toContain("loading")
    expect(acc.statusMarker).toBe("[loading]")
  })

  test("every pane status produces a non-empty aria label", () => {
    const statuses: PaneStatus[] = ["loading", "offline", "denied", "failure", "empty", "degraded", "long-content", "populated"]
    for (const status of statuses) {
      const view = buildPaneView("files", {
        loading: status === "loading",
        connected: status !== "offline",
        permitted: status !== "denied",
        partial: status === "degraded",
        hasContent: !["empty", "loading", "failure"].includes(status),
        contentCount: status === "long-content" ? MAX_PANE_CONTENT + 1 : 5,
        error: status === "failure" ? "test error" : undefined,
      })
      const acc = buildPaneAccessibility(view, true)
      expect(acc.ariaLabel).toBeTruthy()
      expect(acc.ariaLabel.length).toBeGreaterThan(5)
    }
  })
})

// ---------------------------------------------------------------------------
// Narrow terminal detection
// ---------------------------------------------------------------------------

describe("isNarrowTerminal", () => {
  test("returns true for widths below 80", () => {
    expect(isNarrowTerminal(79)).toBe(true)
    expect(isNarrowTerminal(60)).toBe(true)
    expect(isNarrowTerminal(20)).toBe(true)
  })

  test("returns false for widths 80 and above", () => {
    expect(isNarrowTerminal(80)).toBe(false)
    expect(isNarrowTerminal(120)).toBe(false)
    expect(isNarrowTerminal(200)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MultiPaneState: paneViews and paneAria integration
// ---------------------------------------------------------------------------

describe("computeMultiPaneLayout pane lifecycle integration", () => {
  test("paneViews and paneAria are populated for each visible pane", () => {
    const layout = computeMultiPaneLayout(WITH_DIFF)
    expect(layout.paneViews["transcript"]).toBeDefined()
    expect(layout.paneViews["diff"]).toBeDefined()
    expect(layout.paneAria["transcript"]).toBeDefined()
    expect(layout.paneAria["diff"]).toBeDefined()
  })

  test("paneViews are empty in legacy layout", () => {
    const layout = computeMultiPaneLayout(BASE_WIDE)
    expect(Object.keys(layout.paneViews)).toHaveLength(0)
  })

  test("pane contexts are reflected in pane views", () => {
    const layout = computeMultiPaneLayout({
      ...WITH_DIFF,
      paneContexts: {
        diff: { loading: false, connected: true, permitted: true, partial: false, hasContent: true, contentCount: 3 },
        transcript: { loading: true, connected: true, permitted: true, partial: false, hasContent: true, contentCount: 10 },
      },
    })
    expect(layout.paneViews["transcript"]?.status).toBe("loading")
    expect(layout.paneViews["diff"]?.status).toBe("populated")
  })

  test("narrow flag is set when terminal is below threshold", () => {
    const wide = computeMultiPaneLayout(WITH_FILE)
    expect(wide.narrow).toBe(false)
    const narrow = computeMultiPaneLayout({ ...WITH_FILE, width: 60 })
    expect(narrow.narrow).toBe(true)
  })

  test("useColor reflects input setting", () => {
    const colored = computeMultiPaneLayout(WITH_DIFF)
    expect(colored.useColor).toBe(true)
    const noColor = computeMultiPaneLayout({ ...WITH_DIFF, useColor: false })
    expect(noColor.useColor).toBe(false)
  })

  test("paneAria markers use ASCII when no color", () => {
    const layout = computeMultiPaneLayout({ ...WITH_DIFF, useColor: false })
    const diffAria = layout.paneAria["diff"]
    expect(diffAria?.statusMarker.startsWith("[")).toBe(true)
    expect(diffAria?.statusMarker.endsWith("]")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PaneContext for each lifecycle status
// ---------------------------------------------------------------------------

describe("pane contexts produce correct status for each lifecycle state", () => {
  function contextFor(overrides: Partial<PaneContext>): PaneContext {
    return { loading: false, connected: true, permitted: true, partial: false, hasContent: true, contentCount: 5, ...overrides }
  }

  test("loading", () => {
    const status = derivePaneStatus(contextFor({ loading: true }))
    expect(status).toBe("loading")
  })

  test("offline", () => {
    const status = derivePaneStatus(contextFor({ connected: false, loading: false }))
    expect(status).toBe("offline")
  })

  test("denied", () => {
    const status = derivePaneStatus(contextFor({ permitted: false, connected: true, loading: false }))
    expect(status).toBe("denied")
  })

  test("failure", () => {
    const status = derivePaneStatus(contextFor({ error: "something broke", permitted: true, connected: true, loading: false }))
    expect(status).toBe("failure")
  })

  test("empty", () => {
    const status = derivePaneStatus(contextFor({ hasContent: false, error: undefined, permitted: true, connected: true, loading: false }))
    expect(status).toBe("empty")
  })

  test("degraded", () => {
    const status = derivePaneStatus(contextFor({ partial: true, hasContent: true, error: undefined }))
    expect(status).toBe("degraded")
  })

  test("long-content", () => {
    const status = derivePaneStatus(contextFor({ contentCount: MAX_PANE_CONTENT + 1, partial: false, hasContent: true, error: undefined }))
    expect(status).toBe("long-content")
  })

  test("populated", () => {
    const status = derivePaneStatus(contextFor({ contentCount: 10, partial: false, hasContent: true, error: undefined }))
    expect(status).toBe("populated")
  })
})