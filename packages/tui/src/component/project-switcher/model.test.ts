import { describe, expect, test } from "bun:test"
import type { Workspace } from "@opencode-ai/sdk/v2"
import {
  buildProjectSwitcherState,
  classifyError,
  connectionGlyph,
  deriveProjectSwitcherStatus,
  ERROR_MAX,
  hiddenWorktreeCount,
  isProjectSwitcherNarrow,
  lifecycleGlyph,
  lifecycleLabel,
  NARROW_WIDTH_DEFAULT,
  projectSwitcherColorSupport,
  projectSwitcherSummary,
  REDACTION_MARKER,
  RENDER_BUDGET_DEFAULT,
  redactProjectSwitcherError,
  truncateWorktreeTitle,
  visibleWorktreeCount,
  type ProjectSwitcherContext,
} from "./model"

const workspace = (over: Partial<Workspace> = {}): Workspace =>
  ({
    id: over.id ?? "w1",
    projectID: over.projectID ?? "p1",
    name: over.name ?? "repo",
    branch: over.branch ?? "main",
    directory: over.directory ?? "/home/user/repo",
    type: over.type ?? "local",
    timeUsed: over.timeUsed ?? "0",
    ...over,
  }) as unknown as Workspace

const ctx = (over: Partial<ProjectSwitcherContext> = {}): ProjectSwitcherContext => ({
  loading: false,
  connected: true,
  permitted: true,
  partial: false,
  ...over,
})

describe("classifyError", () => {
  test("maps connectivity failures to offline", () => {
    expect(classifyError("ECONNREFUSED connection refused")).toBe("offline")
    expect(classifyError("request timed out")).toBe("offline")
    expect(classifyError("503 service unavailable")).toBe("offline")
  })

  test("maps auth failures to denied", () => {
    expect(classifyError("403 forbidden")).toBe("denied")
    expect(classifyError("permission denied")).toBe("denied")
    expect(classifyError("401 unauthorized")).toBe("denied")
  })

  test("maps anything else to failure", () => {
    expect(classifyError("something exploded")).toBe("failure")
    expect(classifyError(undefined)).toBeUndefined()
  })
})

describe("deriveProjectSwitcherStatus — precedence", () => {
  const total = 3
  test("loading wins over everything", () => {
    expect(deriveProjectSwitcherStatus(ctx({ loading: true }), total, 50, false, false)).toBe("loading")
  })
  test("offline beats denied/failure", () => {
    expect(
      deriveProjectSwitcherStatus(ctx({ connected: false, permitted: false, error: "x" }), total, 50, false, false),
    ).toBe("offline")
  })
  test("denied beats failure", () => {
    expect(deriveProjectSwitcherStatus(ctx({ permitted: false, error: "x" }), total, 50, false, false)).toBe("denied")
  })
  test("error becomes failure", () => {
    expect(deriveProjectSwitcherStatus(ctx({ error: "boom" }), total, 50, false, false)).toBe("failure")
  })
  test("empty when no worktrees", () => {
    expect(deriveProjectSwitcherStatus(ctx(), 0, 50, false, false)).toBe("empty")
  })
  test("degraded on partial or anyError", () => {
    expect(deriveProjectSwitcherStatus(ctx({ partial: true }), total, 50, false, false)).toBe("degraded")
    expect(deriveProjectSwitcherStatus(ctx(), total, 50, false, true)).toBe("degraded")
  })
  test("long-content when over budget and not expanded", () => {
    expect(deriveProjectSwitcherStatus(ctx(), total, 2, false, false)).toBe("long-content")
  })
  test("populated when within budget", () => {
    expect(deriveProjectSwitcherStatus(ctx(), total, 50, false, false)).toBe("populated")
    expect(deriveProjectSwitcherStatus(ctx(), 100, 50, true, false)).toBe("populated")
  })
})

describe("buildProjectSwitcherState — states", () => {
  test("renders loading before data arrives", () => {
    const state = buildProjectSwitcherState({ workspaces: [], loading: true }, ctx({ loading: true }))
    expect(state.status).toBe("loading")
    expect(state.totalWorktrees).toBe(0)
  })

  test("renders empty with no workspaces", () => {
    const state = buildProjectSwitcherState({ workspaces: [] }, ctx())
    expect(state.status).toBe("empty")
  })

  test("renders populated with workspaces", () => {
    const state = buildProjectSwitcherState({ workspaces: [workspace()] }, ctx())
    expect(state.status).toBe("populated")
    expect(state.totalWorktrees).toBe(1)
  })

  test("renders offline from a connectivity error", () => {
    const state = buildProjectSwitcherState(
      { workspaces: [workspace()] },
      ctx({ connected: false, error: "network down" }),
    )
    expect(state.status).toBe("offline")
  })

  test("renders denied from a permission error", () => {
    const state = buildProjectSwitcherState(
      { workspaces: [workspace()] },
      ctx({ permitted: false, error: "403 forbidden" }),
    )
    expect(state.status).toBe("denied")
  })

  test("renders failure from a generic error", () => {
    const state = buildProjectSwitcherState(
      { workspaces: [workspace()] },
      ctx({ error: "disk exploded" }),
    )
    expect(state.status).toBe("failure")
    expect(state.context.error).toContain("disk exploded")
  })

  test("renders degraded when a worktree is in error state", () => {
    const w = workspace({ id: "bad" })
    const state = buildProjectSwitcherState(
      { workspaces: [w], statuses: { bad: "error" } },
      ctx(),
    )
    expect(state.status).toBe("degraded")
  })

  test("renders long-content beyond the render budget", () => {
    const workspaces = Array.from({ length: RENDER_BUDGET_DEFAULT + 10 }, (_, i) =>
      workspace({ id: `w${i}`, projectID: "p1" }),
    )
    const state = buildProjectSwitcherState({ workspaces }, ctx(), { renderBudget: RENDER_BUDGET_DEFAULT })
    expect(state.status).toBe("long-content")
    expect(state.visibleWorktrees).toBe(RENDER_BUDGET_DEFAULT)
    expect(state.hiddenWorktrees).toBe(10)
  })

  test("expanding shows all worktrees", () => {
    const workspaces = Array.from({ length: RENDER_BUDGET_DEFAULT + 10 }, (_, i) =>
      workspace({ id: `w${i}`, projectID: "p1" }),
    )
    const state = buildProjectSwitcherState(
      { workspaces },
      ctx(),
      { renderBudget: RENDER_BUDGET_DEFAULT, showAll: true },
    )
    expect(state.status).toBe("populated")
    expect(state.visibleWorktrees).toBe(workspaces.length)
    expect(state.hiddenWorktrees).toBe(0)
  })
})

describe("render budget", () => {
  const workspaces = Array.from({ length: 80 }, (_, i) => workspace({ id: `w${i}`, projectID: "p1" }))

  test("visibleWorktreeCount caps at the budget", () => {
    const state = buildProjectSwitcherState({ workspaces }, ctx(), { renderBudget: 50 })
    expect(visibleWorktreeCount(state)).toBe(50)
    expect(hiddenWorktreeCount(state)).toBe(30)
  })

  test("visibleWorktreeCount grows with a larger budget", () => {
    const state = buildProjectSwitcherState({ workspaces }, ctx(), { renderBudget: 70 })
    expect(visibleWorktreeCount(state)).toBe(70)
    expect(hiddenWorktreeCount(state)).toBe(10)
  })
})

describe("summary (accessible live-region label)", () => {
  test("labels every lifecycle state", () => {
    const base = (over: Partial<ProjectSwitcherContext> = {}, total = 2) =>
      buildProjectSwitcherState(
        { workspaces: Array.from({ length: total }, (_, i) => workspace({ id: `w${i}` })) },
        ctx(over),
      )
    expect(projectSwitcherSummary(base({ loading: true }))).toContain("loading")
    expect(projectSwitcherSummary(base({ connected: false }))).toContain("offline")
    expect(projectSwitcherSummary(base({ permitted: false }))).toContain("denied")
    expect(projectSwitcherSummary(base({ error: "boom" }))).toContain("failed to load")
    expect(projectSwitcherSummary(base({}, 0))).toContain("no repositories")
    expect(projectSwitcherSummary(base({ partial: true }))).toContain("degraded")
    expect(projectSwitcherSummary(base({}, 80))).toContain("showing")
    expect(projectSwitcherSummary(base({}, 2))).toContain("2 repositories")
  })

  test("redacts secrets in the failure summary", () => {
    const state = buildProjectSwitcherState(
      { workspaces: [workspace()] },
      ctx({ error: "token sk-abcd1234efgh5678 leaked" }),
    )
    const summary = projectSwitcherSummary(state)
    expect(summary).not.toContain("sk-abcd1234efgh5678")
    expect(summary).toContain(REDACTION_MARKER)
  })
})

describe("lifecycle label + glyph", () => {
  test("label maps each state to a stable word", () => {
    expect(lifecycleLabel("loading")).toBe("loading")
    expect(lifecycleLabel("populated")).toBe("ready")
    expect(lifecycleLabel("long-content")).toBe("truncated")
  })

  test("glyph is a colored symbol with color, a bracket tag without", () => {
    expect(lifecycleGlyph("populated", true)).toBe("✓")
    expect(lifecycleGlyph("populated", false)).toBe("[ok]")
    expect(lifecycleGlyph("offline", true)).toBe("○")
    expect(lifecycleGlyph("offline", false)).toBe("[offline]")
  })
})

describe("connection glyph (per-worktree, no-color fallback)", () => {
  test("color mode uses symbols, no-color uses bracket tags", () => {
    expect(connectionGlyph("connected", true)).toBe("●")
    expect(connectionGlyph("connected", false)).toBe("[ok]")
    expect(connectionGlyph("error", true)).toBe("✗")
    expect(connectionGlyph("error", false)).toBe("[err]")
    expect(connectionGlyph("connecting", false)).toBe("[sync]")
    expect(connectionGlyph("disconnected", false)).toBe("[off]")
  })
})

describe("redaction", () => {
  test("redactProjectSwitcherError masks common secret shapes", () => {
    expect(redactProjectSwitcherError("sk-abcd1234efgh5678")).toBe("sk-••••")
    expect(redactProjectSwitcherError("Bearer abcdefghijklmnopqrstuvwxyz")).toContain("Bearer ••••")
  })

  test("never leaks the raw secret", () => {
    expect(redactProjectSwitcherError("key=ghp_abcdefghijklmnopqrstuvwxyz012345")).not.toContain(
      "ghp_abcdefghijklmnopqrstuvwxyz012345",
    )
  })

  test("strips ANSI escape codes", () => {
    expect(redactProjectSwitcherError("\x1b[31merror\x1b[0m")).toBe("error")
  })

  test("bounds the message length", () => {
    expect(redactProjectSwitcherError("x".repeat(500)).length).toBeLessThanOrEqual(ERROR_MAX)
  })
})

describe("terminal fallbacks", () => {
  test("isProjectSwitcherNarrow treats widths below the threshold as narrow", () => {
    expect(isProjectSwitcherNarrow(NARROW_WIDTH_DEFAULT - 1)).toBe(true)
    expect(isProjectSwitcherNarrow(NARROW_WIDTH_DEFAULT + 1)).toBe(false)
  })

  test("projectSwitcherColorSupport honors an explicit level", () => {
    expect(projectSwitcherColorSupport(0).useColor).toBe(false)
    expect(projectSwitcherColorSupport(3).useColor).toBe(true)
  })

  test("truncateWorktreeTitle preserves short titles and trims long ones", () => {
    expect(truncateWorktreeTitle("short", 10)).toBe("short")
    const long = truncateWorktreeTitle("a-very-long-repository-name-here", 10)
    expect(long.length).toBe(10)
    expect(long.endsWith("…")).toBe(true)
  })
})
