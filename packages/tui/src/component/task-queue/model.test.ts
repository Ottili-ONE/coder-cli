import { describe, expect, test } from "bun:test"
import {
  applyStream,
  buildState,
  cancelTask,
  completeTask,
  dependenciesMet,
  effectiveSelection,
  failTask,
  isActive,
  isBlocked,
  makeTask,
  moveSelection,
  nextFilter,
  nextGroupBy,
  priorityRank,
  retryTask,
  setStatus,
  truncate,
  visibleTaskIds,
  groupTasks,
  type TaskInput,
} from "./model"

function task(id: string, overrides: Partial<TaskInput> = {}): Task {
  return makeTask({ id, title: id, group: "default", ...overrides })
}

describe("makeTask", () => {
  test("creates a task with sensible defaults", () => {
    const t = task("t1")
    expect(t.id).toBe("t1")
    expect(t.status).toBe("queued")
    expect(t.priority).toBe("normal")
    expect(t.attempts).toBe(0)
    expect(t.maxAttempts).toBe(3)
    expect(t.progress).toBe(0)
    expect(t.dependencies).toEqual([])
  })

  test("overrides defaults", () => {
    const t = task("t2", { status: "running", priority: "high", attempts: 2, error: "oops" })
    expect(t.status).toBe("running")
    expect(t.priority).toBe("high")
    expect(t.attempts).toBe(2)
    expect(t.error).toBe("oops")
  })
})

describe("priorityRank", () => {
  test("high < normal < low", () => {
    expect(priorityRank("high")).toBeLessThan(priorityRank("normal"))
    expect(priorityRank("normal")).toBeLessThan(priorityRank("low"))
  })
})

describe("isActive", () => {
  test("queued, running, retrying are active", () => {
    expect(isActive("queued")).toBe(true)
    expect(isActive("running")).toBe(true)
    expect(isActive("retrying")).toBe(true)
  })

  test("completed, failed, blocked, cancelled are not active", () => {
    expect(isActive("completed")).toBe(false)
    expect(isActive("failed")).toBe(false)
    expect(isActive("blocked")).toBe(false)
    expect(isActive("cancelled")).toBe(false)
  })
})

describe("dependenciesMet", () => {
  test("returns true when no dependencies", () => {
    const t = task("t1")
    expect(dependenciesMet(t, {})).toBe(true)
  })

  test("returns false when a dependency is not completed", () => {
    const t = task("t1", { dependencies: ["dep1"] })
    expect(dependenciesMet(t, { dep1: task("dep1", { status: "running" }) })).toBe(false)
  })

  test("returns true when all dependencies are completed", () => {
    const t = task("t1", { dependencies: ["dep1", "dep2"] })
    const tasks = {
      dep1: task("dep1", { status: "completed" }),
      dep2: task("dep2", { status: "completed" }),
    }
    expect(dependenciesMet(t, tasks)).toBe(true)
  })

  test("returns false when a dependency task is missing", () => {
    const t = task("t1", { dependencies: ["dep1"] })
    expect(dependenciesMet(t, {})).toBe(false)
  })
})

describe("isBlocked", () => {
  test("explicit blocked status is blocked", () => {
    const t = task("t1", { status: "blocked" })
    expect(isBlocked(t, {})).toBe(true)
  })

  test("active task with unmet dependency is blocked", () => {
    const t = task("t1", { status: "queued", dependencies: ["dep1"] })
    expect(isBlocked(t, { dep1: task("dep1", { status: "running" }) })).toBe(true)
  })

  test("active task with met dependencies is not blocked", () => {
    const t = task("t1", { status: "queued", dependencies: ["dep1"] })
    expect(isBlocked(t, { dep1: task("dep1", { status: "completed" }) })).toBe(false)
  })

  test("completed task is not blocked regardless of dependencies", () => {
    const t = task("t1", { status: "completed", dependencies: ["dep1"] })
    expect(isBlocked(t, {})).toBe(false)
  })
})

describe("buildState", () => {
  test("builds state from task array", () => {
    const tasks = [task("a"), task("b")]
    const state = buildState(tasks)
    expect(Object.keys(state.tasks)).toHaveLength(2)
    expect(state.order).toEqual(["a", "b"])
    expect(state.selectedId).toBeNull()
    expect(state.filter).toBe("all")
    expect(state.groupBy).toBe("group")
  })

  test("applies overrides", () => {
    const state = buildState([task("a")], { selectedId: "a", filter: "active" })
    expect(state.selectedId).toBe("a")
    expect(state.filter).toBe("active")
  })
})

describe("visibleTaskIds", () => {
  const tasks = [
    task("t1", { group: "g1", priority: "high", status: "completed" }),
    task("t2", { group: "g1", priority: "normal", status: "running" }),
    task("t3", { group: "g2", priority: "normal", status: "failed" }),
    task("t4", { group: "g2", priority: "low", status: "queued" }),
  ]
  const state = buildState(tasks)

  test("all filter shows all tasks sorted by priority then order", () => {
    const ids = visibleTaskIds({ ...state, filter: "all" })
    expect(ids).toEqual(["t1", "t2", "t3", "t4"])
  })

  test("active filter shows running, queued, and blocked tasks", () => {
    const ids = visibleTaskIds({ ...state, filter: "active" })
    // t1 is completed (not active), t3 is failed (not active)
    // t2 is running (active), t4 is queued (active)
    expect(ids).toContain("t2")
    expect(ids).toContain("t4")
    expect(ids).not.toContain("t1")
    expect(ids).not.toContain("t3")
  })

  test("failed filter shows only failed", () => {
    const ids = visibleTaskIds({ ...state, filter: "failed" })
    expect(ids).toEqual(["t3"])
  })

  test("blocked filter shows blocked tasks", () => {
    const blockedState = buildState([
      task("b1", { status: "blocked" }),
      task("b2", { status: "queued", dependencies: ["missing"] }),
      task("b3", { status: "completed" }),
    ])
    const ids = visibleTaskIds({ ...blockedState, filter: "blocked" })
    expect(ids).toContain("b1")
    expect(ids).toContain("b2")
    expect(ids).not.toContain("b3")
  })
})

describe("groupTasks", () => {
  test("no grouping returns one group", () => {
    const state = buildState([task("t1"), task("t2")], { groupBy: "none" })
    const groups = groupTasks(["t1", "t2"], state)
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe("Tasks")
    expect(groups[0].items).toEqual(["t1", "t2"])
  })

  test("groups by status", () => {
    const state = buildState([
      task("t1", { status: "completed" }),
      task("t2", { status: "running" }),
      task("t3", { status: "completed" }),
    ], { groupBy: "status" })
    const groups = groupTasks(["t1", "t2", "t3"], state)
    const completedGroup = groups.find((g) => g.key === "completed")
    const runningGroup = groups.find((g) => g.key === "running")
    expect(completedGroup?.items).toEqual(["t1", "t3"])
    expect(runningGroup?.items).toEqual(["t2"])
  })

  test("groups by group field", () => {
    const state = buildState([
      task("t1", { group: "g1" }),
      task("t2", { group: "g2" }),
    ])
    const groups = groupTasks(["t1", "t2"], state)
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.key === "g1")?.items).toEqual(["t1"])
    expect(groups.find((g) => g.key === "g2")?.items).toEqual(["t2"])
  })
})

describe("effectiveSelection", () => {
  test("returns null when no visible tasks", () => {
    const state = buildState([])
    expect(effectiveSelection(state)).toBeNull()
  })

  test("returns stored selection when visible", () => {
    const state = buildState([task("a"), task("b")], { selectedId: "b" })
    expect(effectiveSelection(state)).toBe("b")
  })

  test("falls back to first visible when selected is not in filtered view", () => {
    const state = buildState([
      task("a", { status: "completed" }),
      task("b", { status: "running" }),
    ], { selectedId: "a", filter: "active" })
    expect(effectiveSelection(state)).toBe("b")
  })

  test("falls back to first visible when selected is null", () => {
    const state = buildState([task("a"), task("b")])
    expect(effectiveSelection(state)).toBe("a")
  })
})

describe("moveSelection", () => {
  test("moves down", () => {
    const state = buildState([task("a"), task("b"), task("c")], { selectedId: "a" })
    expect(moveSelection(state, 1)).toBe("b")
  })

  test("moves up", () => {
    const state = buildState([task("a"), task("b"), task("c")], { selectedId: "b" })
    expect(moveSelection(state, -1)).toBe("a")
  })

  test("clamps at boundaries", () => {
    const state = buildState([task("a"), task("b")], { selectedId: "a" })
    expect(moveSelection(state, -1)).toBe("a")
    const atEnd = buildState([task("a"), task("b")], { selectedId: "b" })
    expect(moveSelection(atEnd, 1)).toBe("b")
  })

  test("returns null when no visible tasks", () => {
    expect(moveSelection(buildState([]), 1)).toBeNull()
  })
})

describe("nextFilter / nextGroupBy", () => {
  test("cycles through filters", () => {
    expect(nextFilter("all")).toBe("active")
    expect(nextFilter("active")).toBe("failed")
    expect(nextFilter("failed")).toBe("blocked")
    expect(nextFilter("blocked")).toBe("all")
  })

  test("cycles through group modes", () => {
    expect(nextGroupBy("group")).toBe("status")
    expect(nextGroupBy("status")).toBe("none")
    expect(nextGroupBy("none")).toBe("group")
  })
})

describe("state transitions", () => {
  test("completeTask sets complete with 100% progress", () => {
    const state = buildState([task("t1", { progress: 50 })])
    const next = completeTask(state, "t1")
    expect(next.tasks.t1.status).toBe("completed")
    expect(next.tasks.t1.progress).toBe(100)
  })

  test("failTask preserves progress and sets error", () => {
    const state = buildState([task("t1", { progress: 60 })])
    const next = failTask(state, "t1", "something broke")
    expect(next.tasks.t1.status).toBe("failed")
    expect(next.tasks.t1.error).toBe("something broke")
    expect(next.tasks.t1.progress).toBe(60)
  })

  test("failTask on unknown id returns unchanged state", () => {
    const state = buildState([task("t1")])
    const next = failTask(state, "nonexistent", "err")
    expect(next).toBe(state)
  })

  test("cancelTask sets cancelled status", () => {
    const state = buildState([task("t1", { status: "running" })])
    const next = cancelTask(state, "t1")
    expect(next.tasks.t1.status).toBe("cancelled")
  })

  test("setStatus changes status", () => {
    const state = buildState([task("t1", { status: "queued" })])
    const next = setStatus(state, "t1", "running")
    expect(next.tasks.t1.status).toBe("running")
  })
})

describe("retryTask", () => {
  test("resets a failed task to retrying", () => {
    const state = buildState([task("t1", { status: "failed", attempts: 1, error: "err" })])
    const { state: next, rejected, attempts } = retryTask(state, "t1")
    expect(rejected).toBe(false)
    expect(next.tasks.t1.status).toBe("retrying")
    expect(next.tasks.t1.error).toBeUndefined()
    expect(attempts).toBe(2)
  })

  test("rejects when maxAttempts reached", () => {
    const state = buildState([task("t1", { status: "failed", attempts: 3, maxAttempts: 3, error: "err" })])
    const { state: next, rejected, attempts } = retryTask(state, "t1")
    expect(rejected).toBe(true)
    expect(next.tasks.t1.status).toBe("failed")
    expect(next.tasks.t1.error).toContain("Max retries")
    expect(attempts).toBe(3)
  })

  test("returns rejected for unknown task", () => {
    const state = buildState([])
    const { state: next, rejected } = retryTask(state, "nonexistent")
    expect(rejected).toBe(true)
    expect(next).toBe(state)
  })
})

describe("applyStream", () => {
  test("appends chunk and nudges progress", () => {
    const state = buildState([task("t1", { progress: 0, stream: "start" })])
    const next = applyStream(state, "t1", " more data")
    expect(next.tasks.t1.stream).toContain("start")
    expect(next.tasks.t1.stream).toContain("more data")
    expect(next.tasks.t1.progress).toBeGreaterThan(0)
  })

  test("caps stream at 400 chars", () => {
    const state = buildState([task("t1", { progress: 0, stream: "x".repeat(350) })])
    const next = applyStream(state, "t1", "y".repeat(100))
    expect(next.tasks.t1.stream.length).toBe(400)
    // The last characters should be from the new chunk since it's a slice(-400)
    expect(next.tasks.t1.stream).toMatch(/y+$/)
  })

  test("noop for unknown task", () => {
    const state = buildState([task("t1")])
    const next = applyStream(state, "nonexistent", "data")
    expect(next).toBe(state)
  })
})

describe("truncate", () => {
  test("passes through short values", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  test("truncates long values with ellipsis", () => {
    const result = truncate("a very long string", 10)
    expect(result).toHaveLength(10)
    expect(result).toMatch(/…$/)
  })
})

describe("keyboard navigation and focus behavior", () => {
  test("filtering changes visible tasks, selection falls back safely", () => {
    const tasks = [
      task("a", { status: "completed", priority: "high" }),
      task("b", { status: "running", priority: "normal" }),
      task("c", { status: "failed", priority: "low" }),
    ]
    let state = buildState(tasks, { selectedId: "b" })

    // Switch to failed filter — b is not visible, selection falls back to c
    state = { ...state, filter: "failed" }
    expect(effectiveSelection(state)).toBe("c")

    // Switch back to all filter — b is visible again, correct active
    state = { ...state, filter: "all" }
    expect(effectiveSelection(state)).toBe("b")
  })

  test("keyboard navigation skips filtered-out tasks", () => {
    const tasks = [
      task("a", { status: "completed" }),
      task("b", { status: "failed" }),
      task("c", { status: "running" }),
    ]
    const state = buildState(tasks, { filter: "active", selectedId: "c" })
    // Active filter shows only c (running)
    expect(visibleTaskIds(state)).toEqual(["c"])
    expect(moveSelection(state, 1)).toBe("c") // clamped
  })

  test("grouped view still allows selection movement within groups", () => {
    const tasks = [
      task("a", { group: "g1", status: "completed" }),
      task("b", { group: "g1", status: "completed" }),
      task("c", { group: "g2", status: "completed" }),
    ]
    let state = buildState(tasks, { selectedId: "a", groupBy: "group" })
    const groups = groupTasks(visibleTaskIds(state), state)
    const g1 = groups.find((g) => g.key === "g1")
    expect(g1?.items).toContain("a")
    expect(g1?.items).toContain("b")

    state = { ...state, selectedId: "b" }
    expect(moveSelection(state, 1)).toBe("c")
  })
})

describe("pane resize: narrow terminal display", () => {
  test("task title truncation at narrow widths", () => {
    const longTitle = "a very long task title that should be truncated at narrow terminal widths"
    const t = task("t1", { title: longTitle })
    expect(truncate(t.title, 30)).toHaveLength(30)
    expect(truncate(t.title, 30)).toMatch(/…$/)
  })
})

describe("pane failure paths", () => {
  test("retry on exhausted attempts sets appropriate error", () => {
    const state = buildState([task("t1", { status: "failed", attempts: 5, maxAttempts: 3 })])
    const { state: next, rejected } = retryTask(state, "t1")
    expect(rejected).toBe(true)
    expect(next.tasks.t1.error).toContain("Max retries")
    expect(next.tasks.t1.attempts).toBe(5)
  })
})