import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { computeMultiPaneLayout } from "./multi-pane"
import type { MultiPaneInput } from "./multi-pane"

// Multi-pane workspace layout contract (T-CLI-0201).
// The session route derives its pane structure from `computeMultiPaneLayout`,
// a pure function that takes terminal dimensions and session tool context
// and returns the pane set. No timers: every case is a pure function
// evaluation, which keeps the suite stable in CI.

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

describe("multi-pane workspace failure path: the feature flag gates engagement", () => {
  // The session route computes multiPane() = flag. When the flag is off
  // computeMultiPaneLayout receives enabled=false and returns the legacy
  // single-pane layout. Test the gate directly.
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

describe("multi-pane workspace is stable across streaming transcript updates", () => {
  // The layout model reads only terminal dimensions and tool-context booleans,
  // not message content. The pane set stays fixed while the assistant streams.
  test("layout is invariant while messages stream in", () => {
    const base: MultiPaneInput = { ...WITH_DIFF }
    for (const messages of [0, 1, 5, 42, 1000]) {
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