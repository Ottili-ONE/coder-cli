import { describe, expect, test } from "bun:test"
import {
  buildSidebar,
  displayDirectory,
  flattenEntries,
  matchesQuery,
  moveSelection,
  resumeState,
  sortByRecency,
  topLevelSessions,
  truncate,
  type SidebarEntry,
  type SidebarSession,
} from "./model"

const session = (over: Partial<SidebarSession> = {}): SidebarSession => ({
  id: over.id ?? "s1",
  title: over.title ?? "Session",
  parentID: over.parentID ?? undefined,
  directory: over.directory ?? "/home/user/project",
  path: over.path ?? "/home/user/project",
  workspaceID: over.workspaceID ?? null,
  time: { updated: over.time?.updated ?? 1_000, archived: over.time?.archived ?? null },
  ...over,
})

const day = (offset: number) => 1_700_000_000_000 + offset * 86_400_000

describe("resumeState", () => {
  test("maps busy/retry and falls back to idle", () => {
    expect(resumeState(undefined)).toBe("idle")
    expect(resumeState({ type: "idle" })).toBe("idle")
    expect(resumeState({ type: "busy" })).toBe("busy")
    expect(resumeState({ type: "retry" })).toBe("retry")
  })
})

describe("topLevelSessions", () => {
  test("drops children and archived sessions", () => {
    const sessions = [
      session({ id: "a" }),
      session({ id: "b", parentID: "a" }),
      session({ id: "c", time: { updated: 1, archived: 1_000 } }),
    ]
    const ids = topLevelSessions(sessions).map((x) => x.id)
    expect(ids).toEqual(["a"])
  })
})

describe("sortByRecency", () => {
  test("sorts newest first", () => {
    const sessions = [session({ id: "old", time: { updated: 1 } }), session({ id: "new", time: { updated: 9 } })]
    expect(sortByRecency(sessions).map((x) => x.id)).toEqual(["new", "old"])
  })
})

describe("matchesQuery", () => {
  test("matches title, directory and path case-insensitively", () => {
    const s = session({ title: "Refactor Auth", path: "/x/legacy/login.ts" })
    expect(matchesQuery(s, "auth")).toBe(true)
    expect(matchesQuery(s, "LOGIN")).toBe(true)
    expect(matchesQuery(s, "none")).toBe(false)
    expect(matchesQuery(s, "  ")).toBe(true)
  })
})

describe("displayDirectory", () => {
  test("strips project prefix and basename", () => {
    expect(displayDirectory(session({ directory: "/home/user/project/src" }), "/home/user/project")).toBe("src")
    const longDir = displayDirectory(
      session({ directory: "/elsewhere/deep/nested/extra" }),
      "/home/user/project",
    )
    expect(longDir.startsWith("…")).toBe(true)
    expect(longDir.endsWith("extra")).toBe(true)
    // Path under prefix longer than the cap is still truncated.
    const underPrefix = displayDirectory(
      session({ directory: "/a/very/long/path/name/here" }),
      "/a",
    )
    expect(underPrefix.startsWith("…")).toBe(true)
    expect(underPrefix.endsWith("here")).toBe(true)
  })
})

describe("buildSidebar", () => {
  const now = day(0)
  const input = (over: Partial<Parameters<typeof buildSidebar>[0]> = {}) =>
    buildSidebar({
      sessions: [
        session({ id: "pinned", title: "Pinned", time: { updated: day(-3) } }),
        session({ id: "today", title: "Today's work", time: { updated: now } }),
        session({ id: "older", title: "Older", time: { updated: day(-5) } }),
      ],
      pinnedIDs: ["pinned"],
      currentID: "today",
      now,
      ...over,
    })

  test("pinned section precedes date groups, current flagged", () => {
    const model = input()
    expect(model.pinned.map((x) => x.id)).toEqual(["pinned"])
    expect(model.groups.map((g) => g.key)).toContain("Today")
    const todayEntry = model.groups.flatMap((g) => g.entries).find((x) => x.id === "today")
    expect(todayEntry?.isCurrent).toBe(true)
    expect(todayEntry?.resume).toBe("idle")
  })

  test("drops pinned id from the remaining groups", () => {
    const model = input()
    const remainingIds = model.groups.flatMap((g) => g.entries).map((x) => x.id)
    expect(remainingIds).not.toContain("pinned")
  })

  test("search collapses into a single Results group ignoring pin grouping", () => {
    const model = input({ query: "older" })
    expect(model.isSearching).toBe(true)
    expect(model.pinned).toEqual([])
    expect(model.groups).toHaveLength(1)
    expect(model.groups[0].key).toBe("Results")
    expect(model.groups[0].entries.map((x) => x.id)).toEqual(["older"])
  })

  test("search with no matches yields an empty model", () => {
    const model = input({ query: "zzz" })
    expect(model.groups).toEqual([])
  })

  test("carries slot numbers for pinned sessions", () => {
    const model = input({ slotByID: new Map([["pinned", 2]]) })
    expect(model.pinned[0].slot).toBe(2)
  })

  test("resume state comes from the status map", () => {
    const model = input({ statuses: { today: { type: "busy" } } })
    const entry = model.groups.flatMap((g) => g.entries).find((x) => x.id === "today")
    expect(entry?.resume).toBe("busy")
  })
})

describe("flattenEntries", () => {
  test("pinned first then group order", () => {
    const model = buildSidebar({
      sessions: [
        session({ id: "a", time: { updated: day(0) } }),
        session({ id: "b", time: { updated: day(-1) } }),
      ],
      pinnedIDs: ["b"],
      now: day(0),
    })
    expect(flattenEntries(model).map((x) => x.id)).toEqual(["b", "a"])
  })
})

describe("moveSelection", () => {
  const entries: SidebarEntry[] = ["a", "b", "c"].map((id) => ({
    id,
    title: id,
    directory: "",
    group: "",
    isPinned: false,
    isCurrent: false,
    resume: "idle",
  }))

  test("moves within bounds and clamps", () => {
    expect(moveSelection(entries, "a", 1)).toBe("b")
    expect(moveSelection(entries, "c", 1)).toBe("c")
    expect(moveSelection(entries, "a", -1)).toBe("a")
    expect(moveSelection(entries, "b", -1)).toBe("a")
  })

  test("falls back to first entry when current is unknown", () => {
    expect(moveSelection(entries, "zzz", 1)).toBe("a")
    expect(moveSelection([], undefined, 1)).toBeUndefined()
  })
})

describe("truncate", () => {
  test("appends ellipsis only when too long", () => {
    expect(truncate("short", 10)).toBe("short")
    expect(truncate("a-long-value", 5)).toBe("a-lo…")
  })
})
