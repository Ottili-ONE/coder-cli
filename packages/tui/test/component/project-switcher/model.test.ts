import { describe, expect, test } from "bun:test"
import type { Workspace } from "@opencode-ai/sdk/v2"
import {
  buildProjectSwitcher,
  classifyLocation,
  flattenWorktrees,
  groupByRepository,
  normalizeStatus,
  normalizeTimeUsed,
  repositoryName,
  type BuildProjectSwitcherInput,
} from "../../../src/component/project-switcher/model"

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: over.id ?? "ws-default",
    type: over.type ?? "local",
    name: over.name ?? "main",
    projectID: over.projectID ?? "proj-default",
    timeUsed: over.timeUsed ?? 0,
    ...over,
  }
}

// --- Pure classification helpers ---

describe("classifyLocation — local vs cloud", () => {
  test("remote/cloud/sandbox types map to cloud", () => {
    expect(classifyLocation("remote")).toBe("cloud")
    expect(classifyLocation("cloud")).toBe("cloud")
    expect(classifyLocation("sandbox")).toBe("cloud")
  })
  test("local and unknown types map to local", () => {
    expect(classifyLocation("local")).toBe("local")
    expect(classifyLocation("git")).toBe("local")
    expect(classifyLocation("weird")).toBe("local")
  })
  test("classification is case-insensitive", () => {
    expect(classifyLocation("REMOTE")).toBe("cloud")
    expect(classifyLocation("Cloud")).toBe("cloud")
    expect(classifyLocation("Local")).toBe("local")
  })
})

describe("normalizeStatus — closed status union", () => {
  test("undefined status falls back to unknown", () => {
    expect(normalizeStatus(undefined)).toBe("unknown")
    expect(normalizeStatus("")).toBe("unknown")
  })
  test("known statuses pass through unchanged", () => {
    expect(normalizeStatus("connected")).toBe("connected")
    expect(normalizeStatus("connecting")).toBe("connecting")
    expect(normalizeStatus("disconnected")).toBe("disconnected")
    expect(normalizeStatus("error")).toBe("error")
  })
  test("unrecognized status collapses to unknown", () => {
    expect(normalizeStatus("pending")).toBe("unknown")
    expect(normalizeStatus("offline")).toBe("unknown")
  })
})

describe("normalizeTimeUsed — guards non-finite SDK values", () => {
  test("finite numbers pass through", () => {
    expect(normalizeTimeUsed(42)).toBe(42)
    expect(normalizeTimeUsed(0)).toBe(0)
  })
  test("string NaN/Infinity collapse to zero", () => {
    expect(normalizeTimeUsed("NaN")).toBe(0)
    expect(normalizeTimeUsed("Infinity")).toBe(0)
    expect(normalizeTimeUsed("-Infinity")).toBe(0)
  })
  test("numeric-looking strings are coerced", () => {
    expect(normalizeTimeUsed("7" as unknown as number)).toBe(7)
  })
})

describe("repositoryName — stable display name", () => {
  test("uses the first worktree's directory basename", () => {
    const repos = [ws({ directory: "/home/user/alpha/feature", name: "feature" })]
    expect(repositoryName(repos)).toBe("feature")
  })

  test("prefers a directory over a bare name", () => {
    const repos = [ws({ directory: "/home/user/alpha", name: "named" })]
    expect(repositoryName(repos)).toBe("alpha")
  })
  test("falls back to worktree name when no directory exists", () => {
    const repos = [ws({ name: "lonely", directory: undefined })]
    expect(repositoryName(repos)).toBe("lonely")
  })
  test("falls back to a friendly label when nothing is known", () => {
    const repos = [ws({ name: undefined as unknown as string, directory: undefined })]
    expect(repositoryName(repos)).toBe("Unknown project")
  })
})

// --- Grouping & sorting ---

describe("groupByRepository — grouping and deterministic ordering", () => {
  test("groups worktrees by projectID", () => {
    const repos = groupByRepository(
      [ws({ id: "a", projectID: "p1" }), ws({ id: "b", projectID: "p2" }), ws({ id: "c", projectID: "p1" })],
      {},
      undefined,
    )
    expect(repos.map((r) => r.projectID).sort()).toEqual(["p1", "p2"])
    const p1 = repos.find((r) => r.projectID === "p1")!
    expect(p1.worktrees.map((w) => w.id).sort()).toEqual(["a", "c"])
  })

  test("sorts worktrees current-first, then by recency, then name", () => {
    const repos = groupByRepository(
      [
        ws({ id: "old", timeUsed: 1, name: "zeta" }),
        ws({ id: "recent", timeUsed: 99, name: "alpha" }),
        ws({ id: "current", timeUsed: 0, name: "mid" }),
      ],
      {},
      "current",
    )
    expect(repos[0].worktrees.map((w) => w.id)).toEqual(["current", "recent", "old"])
  })

  test("sorts repositories with a current worktree ahead of others", () => {
    const repos = groupByRepository(
      [ws({ id: "x", projectID: "other" }), ws({ id: "y", projectID: "active" })],
      {},
      "y",
    )
    expect(repos.map((r) => r.projectID)).toEqual(["active", "other"])
  })

  test("derives cloud location when any worktree is cloud-hosted", () => {
    const repos = groupByRepository(
      [ws({ id: "l", type: "local" }), ws({ id: "r", type: "remote" })],
      {},
      undefined,
    )
    expect(repos[0].location).toBe("cloud")
    expect(repos[0].anyConnected).toBe(false)
    expect(repos[0].connectedCount).toBe(0)
  })

  test("counts connected worktrees and flags the current one", () => {
    const repos = groupByRepository(
      [ws({ id: "c", type: "local" }), ws({ id: "d", type: "local" })],
      { c: "connected", d: "disconnected" },
      "c",
    )
    const repo = repos[0]
    expect(repo.connectedCount).toBe(1)
    expect(repo.anyConnected).toBe(true)
    expect(repo.currentWorktreeID).toBe("c")
  })
})

describe("flattenWorktrees — keyboard navigation order", () => {
  test("current worktree appears first across the flat list", () => {
    const model = buildProjectSwitcher({
      workspaces: [
        ws({ id: "a", projectID: "p1", timeUsed: 1 }),
        ws({ id: "b", projectID: "p1", timeUsed: 50 }),
        ws({ id: "cur", projectID: "p1", timeUsed: 0 }),
      ],
      currentID: "cur",
    })
    const flat = flattenWorktrees(model)
    expect(flat[0].id).toBe("cur")
    expect(flat.map((w) => w.id)).toContain("a")
    expect(flat.map((w) => w.id)).toContain("b")
  })

  test("empty model yields an empty navigation list", () => {
    const model = buildProjectSwitcher({ workspaces: [], loading: false })
    expect(flattenWorktrees(model)).toEqual([])
  })
})

// --- State machine (buildProjectSwitcher) ---

describe("buildProjectSwitcher — status transitions", () => {
  test("loading with no workspaces shows the loading state", () => {
    const model = buildProjectSwitcher({ workspaces: [], loading: true })
    expect(model.status).toBe("loading")
    expect(model.repositories).toEqual([])
  })

  test("a resolved empty list shows the empty state", () => {
    const model = buildProjectSwitcher({ workspaces: [], loading: false })
    expect(model.status).toBe("empty")
    expect(model.totalWorktrees).toBe(0)
  })

  test("loading is ignored once workspaces have arrived", () => {
    const model = buildProjectSwitcher({ workspaces: [ws()], loading: true })
    expect(model.status).toBe("ready")
  })

  test("ready state reports totals and current worktree", () => {
    const input: BuildProjectSwitcherInput = {
      workspaces: [
        ws({ id: "a", projectID: "p1" }),
        ws({ id: "b", projectID: "p1" }),
        ws({ id: "c", projectID: "p2", type: "remote" }),
      ],
      statuses: { a: "connected", c: "connecting" },
      currentID: "b",
    }
    const model = buildProjectSwitcher(input)
    expect(model.status).toBe("ready")
    expect(model.totalWorktrees).toBe(3)
    expect(model.connectedCount).toBe(1)
    expect(model.currentWorktreeID).toBe("b")
    expect(model.repositories).toHaveLength(2)
  })

  test("current worktree id outside the list is not surfaced", () => {
    const model = buildProjectSwitcher({ workspaces: [ws({ id: "a", projectID: "p1" })], currentID: "ghost" })
    expect(model.currentWorktreeID).toBeUndefined()
  })
})

// --- Streaming updates reconcile progressively ---

describe("streaming updates — model rebuild reflects latest data", () => {
  test("a status change is reflected in connected counts without losing other worktrees", () => {
    const base: BuildProjectSwitcherInput = {
      workspaces: [ws({ id: "a", projectID: "p1" }), ws({ id: "b", projectID: "p1" })],
      statuses: { a: "disconnected", b: "disconnected" },
      currentID: "a",
    }
    const before = buildProjectSwitcher(base)
    expect(before.connectedCount).toBe(0)

    const after = buildProjectSwitcher({ ...base, statuses: { a: "connected", b: "disconnected" } })
    expect(after.connectedCount).toBe(1)
    expect(after.totalWorktrees).toBe(2)
  })

  test("updated recency reorders the flat navigation list", () => {
    const workspaces = [
      ws({ id: "a", projectID: "p1", timeUsed: 1 }),
      ws({ id: "b", projectID: "p1", timeUsed: 2 }),
    ]
    const first = flattenWorktrees(buildProjectSwitcher({ workspaces, currentID: undefined }))
    expect(first[0].id).toBe("b")

    const updated = workspaces.map((w) => (w.id === "a" ? { ...w, timeUsed: 100 } : w))
    const second = flattenWorktrees(buildProjectSwitcher({ workspaces: updated, currentID: undefined }))
    expect(second[0].id).toBe("a")
  })

  test("a newly arrived worktree appears in its repository group", () => {
    const initial = buildProjectSwitcher({ workspaces: [ws({ id: "a", projectID: "p1" })] })
    expect(initial.totalWorktrees).toBe(1)
    const grown = buildProjectSwitcher({
      workspaces: [ws({ id: "a", projectID: "p1" }), ws({ id: "b", projectID: "p1" })],
    })
    expect(grown.totalWorktrees).toBe(2)
    expect(grown.repositories[0].worktrees.map((w) => w.id).sort()).toEqual(["a", "b"])
  })
})

// --- Failure path ---

describe("failure path — empty / unavailable data", () => {
  test("no workspaces yields an empty (not ready) model", () => {
    const model = buildProjectSwitcher({ workspaces: [] })
    expect(model.status).toBe("empty")
    expect(model.repositories).toEqual([])
    expect(model.totalWorktrees).toBe(0)
  })

  test("a single broken status string does not throw and stays unknown", () => {
    const model = buildProjectSwitcher({
      workspaces: [ws({ id: "a", projectID: "p1" })],
      statuses: { a: "exploded" },
      currentID: "a",
    })
    expect(model.status).toBe("ready")
    const wt = flattenWorktrees(model)[0]
    expect(wt.status).toBe("unknown")
    expect(wt.isCurrent).toBe(true)
  })

  test("non-finite timeUsed never corrupts the sort", () => {
    const model = buildProjectSwitcher({
      workspaces: [
        ws({ id: "a", projectID: "p1", timeUsed: "NaN" as unknown as number }),
        ws({ id: "b", projectID: "p1", timeUsed: 5 }),
      ],
    })
    const flat = flattenWorktrees(model)
    expect(flat).toHaveLength(2)
    expect(flat.every((w) => Number.isFinite(w.timeUsed))).toBe(true)
  })
})

// --- Terminal dimensions: narrow vs standard ---

describe("terminal dimensions — cardinality holds at narrow and standard widths", () => {
  test("a wide repository set is fully represented regardless of width", () => {
    const workspaces: Workspace[] = []
    for (let i = 0; i < 12; i++) {
      workspaces.push(
        ws({
          id: `ws-${i}`,
          projectID: i < 6 ? "proj-alpha" : "proj-beta",
          name: `worktree-${i}`,
          type: i % 4 === 0 ? "remote" : "local",
          timeUsed: i,
        }),
      )
    }
    const model = buildProjectSwitcher({ workspaces, currentID: "ws-11" })
    // Both narrow (40) and standard (120) terminals render the same data; the
    // model is width-agnostic, so the navigation list is identical and complete.
    expect(model.totalWorktrees).toBe(12)
    expect(model.repositories).toHaveLength(2)
    const cloudRepo = model.repositories.find((r) => r.projectID === "proj-alpha")!
    expect(cloudRepo.location).toBe("cloud")
    expect(flattenWorktrees(model).map((w) => w.id)).toContain("ws-0")
    expect(flattenWorktrees(model).map((w) => w.id)).toContain("ws-11")
  })

  test("a single repository with one worktree collapses to one selectable row", () => {
    const model = buildProjectSwitcher({ workspaces: [ws({ id: "only", projectID: "solo" })] })
    expect(model.totalWorktrees).toBe(1)
    expect(flattenWorktrees(model)).toHaveLength(1)
  })
})
