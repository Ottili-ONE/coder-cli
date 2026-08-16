import { describe, expect, test } from "bun:test"
import {
  applyStream,
  buildState,
  cancelTask,
  completeTask,
  dependenciesMet,
  effectiveSelection,
  failTask,
  groupTasks,
  isActive,
  isBlocked,
  makeTask,
  moveSelection,
  nextFilter,
  nextGroupBy,
  priorityRank,
  PRIORITY_LABEL,
  retryTask,
  setStatus,
  STATUS_ICON,
  truncate,
  visibleTaskIds,
  type Task,
  type TaskStatus,
} from "../../../src/component/task-queue/model"

function task(input: Parameters<typeof makeTask>[0]): Task {
  return makeTask(input)
}

describe("makeTask", () => {
  test("applies sensible defaults for an incomplete task", () => {
    const created = task({ id: "a", title: "Write docs", group: "docs" })
    expect(created).toEqual({
      id: "a",
      title: "Write docs",
      group: "docs",
      status: "queued",
      priority: "normal",
      dependencies: [],
      attempts: 0,
      maxAttempts: 3,
      progress: 0,
      stream: "",
      error: undefined,
    })
  })

  test("honors explicit overrides without dropping required fields", () => {
    const created = task({
      id: "b",
      title: "Build",
      group: "build",
      status: "running",
      priority: "high",
      dependencies: ["a"],
      attempts: 1,
      maxAttempts: 5,
      progress: 40,
      stream: "working",
      error: undefined,
    })
    expect(created.status).toBe("running")
    expect(created.priority).toBe("high")
    expect(created.dependencies).toEqual(["a"])
    expect(created.attempts).toBe(1)
    expect(created.maxAttempts).toBe(5)
    expect(created.progress).toBe(40)
    expect(created.stream).toBe("working")
  })
})

describe("status + priority taxonomy", () => {
  const allStatuses: TaskStatus[] = [
    "queued",
    "running",
    "retrying",
    "completed",
    "failed",
    "blocked",
    "cancelled",
  ]

  test("exposes a visible icon for every status", () => {
    for (const status of allStatuses) {
      expect(STATUS_ICON[status]).toBeTypeOf("string")
      expect(STATUS_ICON[status].length).toBeGreaterThan(0)
    }
  })

  test("exposes a readable priority label", () => {
    expect(PRIORITY_LABEL.high).toBe("HIGH")
    expect(PRIORITY_LABEL.normal).toBe("NORM")
    expect(PRIORITY_LABEL.low).toBe("LOW")
  })

  test("active statuses are queued, running or retrying", () => {
    expect(isActive("queued")).toBe(true)
    expect(isActive("running")).toBe(true)
    expect(isActive("retrying")).toBe(true)
    expect(isActive("completed")).toBe(false)
    expect(isActive("failed")).toBe(false)
    expect(isActive("blocked")).toBe(false)
    expect(isActive("cancelled")).toBe(false)
  })

  test("priority rank orders high before normal before low", () => {
    expect(priorityRank("high")).toBeLessThan(priorityRank("normal"))
    expect(priorityRank("normal")).toBeLessThan(priorityRank("low"))
  })
})

describe("dependencies", () => {
  const tasks = {
    a: task({ id: "a", title: "A", group: "g", status: "completed" }),
    b: task({ id: "b", title: "B", group: "g", status: "queued", dependencies: ["a"] }),
    c: task({ id: "c", title: "C", group: "g", status: "queued", dependencies: ["missing"] }),
  }

  test("dependenciesMet is true only when every dependency is completed", () => {
    expect(dependenciesMet(tasks.b, tasks)).toBe(true)
    expect(dependenciesMet(tasks.c, tasks)).toBe(false)
  })

  test("isBlocked covers explicit blocked status and unmet dependency waits", () => {
    expect(isBlocked(task({ id: "x", title: "x", group: "g", status: "blocked" }), tasks)).toBe(true)
    expect(isBlocked(tasks.b, tasks)).toBe(false)
    expect(isBlocked(tasks.c, tasks)).toBe(true)
    expect(isBlocked(task({ id: "done", title: "done", group: "g", status: "completed" }), tasks)).toBe(false)
  })
})

describe("buildState", () => {
  test("indexes tasks by id and preserves insertion order", () => {
    const list = [
      task({ id: "a", title: "A", group: "g" }),
      task({ id: "b", title: "B", group: "g" }),
      task({ id: "c", title: "C", group: "g" }),
    ]
    const state = buildState(list)
    expect(Object.keys(state.tasks)).toEqual(["a", "b", "c"])
    expect(state.order).toEqual(["a", "b", "c"])
    expect(state.selectedId).toBeNull()
    expect(state.filter).toBe("all")
    expect(state.groupBy).toBe("group")
  })

  test("applies overrides on top of defaults", () => {
    const state = buildState([task({ id: "a", title: "A", group: "g" })], {
      selectedId: "a",
      filter: "failed",
      groupBy: "status",
    })
    expect(state.selectedId).toBe("a")
    expect(state.filter).toBe("failed")
    expect(state.groupBy).toBe("status")
  })
})

describe("visibleTaskIds filtering + ordering", () => {
  const tasks: Task[] = [
    task({ id: "high", title: "High", group: "g", priority: "high" }),
    task({ id: "low", title: "Low", group: "g", priority: "low" }),
    task({ id: "normal", title: "Normal", group: "g", priority: "normal" }),
    task({ id: "failed", title: "Failed", group: "g", status: "failed" }),
  ]
  const state = buildState(tasks)

  test("'all' filter shows every task sorted by priority then insertion order", () => {
    expect(visibleTaskIds(state)).toEqual(["high", "normal", "low", "failed"])
  })

  test("'active' filter includes queued/running/retrying and blocked waits", () => {
    const activeState = buildState([
      task({ id: "q", title: "Q", group: "g", status: "queued" }),
      task({ id: "r", title: "R", group: "g", status: "running" }),
      task({ id: "f", title: "F", group: "g", status: "failed" }),
      task({ id: "c", title: "C", group: "g", status: "completed" }),
    ])
    expect(visibleTaskIds(activeState).sort()).toEqual(["q", "r"])
  })

  test("'failed' filter shows only failed tasks", () => {
    expect(visibleTaskIds({ ...state, filter: "failed" })).toEqual(["failed"])
  })

  test("'blocked' filter shows tasks waiting on unmet dependencies", () => {
    const blockedState = buildState([
      task({ id: "dep", title: "Dep", group: "g", status: "completed" }),
      task({ id: "wait", title: "Wait", group: "g", status: "queued", dependencies: ["dep"] }),
      task({ id: "stuck", title: "Stuck", group: "g", status: "queued", dependencies: ["missing"] }),
      task({ id: "done", title: "Done", group: "g", status: "completed" }),
    ])
    expect(visibleTaskIds({ ...blockedState, filter: "blocked" }).sort()).toEqual(["stuck", "wait"])
  })

  test("drops ids whose task no longer exists", () => {
    const dirty = buildState(tasks, { selectedId: "missing" })
    delete dirty.tasks.missing
    expect(visibleTaskIds(dirty)).toEqual(["high", "normal", "low", "failed"])
  })
})

describe("groupTasks", () => {
  const list = [
    task({ id: "a", title: "A", group: "docs", status: "queued" }),
    task({ id: "b", title: "B", group: "build", status: "running" }),
    task({ id: "c", title: "C", group: "docs", status: "completed" }),
  ]

  test("groups by the task group by default", () => {
    const groups = groupTasks(visibleTaskIds(buildState(list)), buildState(list))
    expect(groups.map((g) => g.key).sort()).toEqual(["build", "docs"])
    const docs = groups.find((g) => g.key === "docs")
    expect(docs?.items.sort()).toEqual(["a", "c"])
  })

  test("groups by status when requested", () => {
    const groups = groupTasks(visibleTaskIds(buildState(list)), buildState(list, { groupBy: "status" }))
    expect(groups.map((g) => g.key).sort()).toEqual(["completed", "queued", "running"])
  })

  test("collapses into a single bucket when grouping is disabled", () => {
    const groups = groupTasks(visibleTaskIds(buildState(list)), buildState(list, { groupBy: "none" }))
    expect(groups).toEqual([{ key: "Tasks", items: ["a", "b", "c"] }])
  })
})

describe("selection", () => {
  const list = [
    task({ id: "a", title: "A", group: "g" }),
    task({ id: "b", title: "B", group: "g" }),
    task({ id: "c", title: "C", group: "g" }),
  ]

  test("effectiveSelection defaults to the first visible task", () => {
    expect(effectiveSelection(buildState(list))).toBe("a")
  })

  test("effectiveSelection keeps a still-visible selected id", () => {
    expect(effectiveSelection(buildState(list, { selectedId: "b" }))).toBe("b")
  })

  test("effectiveSelection falls back to first visible when selection is filtered out", () => {
    const state = buildState(
      [
        task({ id: "a", title: "A", group: "g", status: "completed" }),
        task({ id: "b", title: "B", group: "g", status: "failed" }),
      ],
      { selectedId: "a", filter: "failed" },
    )
    expect(effectiveSelection(state)).toBe("b")
  })

  test("effectiveSelection is null for an empty queue", () => {
    expect(effectiveSelection(buildState([]))).toBeNull()
  })

  test("moveSelection walks down and up within visible bounds", () => {
    const state = buildState(list)
    expect(moveSelection(state, 1)).toBe("b")
    expect(moveSelection({ ...state, selectedId: "b" }, 1)).toBe("c")
    expect(moveSelection({ ...state, selectedId: "c" }, 1)).toBe("c")
    expect(moveSelection({ ...state, selectedId: "c" }, -1)).toBe("b")
    expect(moveSelection({ ...state, selectedId: "a" }, -1)).toBe("a")
  })

  test("moveSelection honors the active filter when navigating", () => {
    const list2 = [
      task({ id: "a", title: "A", group: "g", status: "completed" }),
      task({ id: "b", title: "B", group: "g", status: "failed" }),
      task({ id: "c", title: "C", group: "g", status: "failed" }),
    ]
    const state = buildState(list2, { filter: "failed" })
    expect(visibleTaskIds(state)).toEqual(["b", "c"])
    expect(moveSelection(state, 1)).toBe("c")
    expect(moveSelection({ ...state, selectedId: "c" }, -1)).toBe("b")
  })

  test("moveSelection returns null for an empty queue", () => {
    expect(moveSelection(buildState([]), 1)).toBeNull()
  })
})

describe("filter + group cycling", () => {
  test("nextFilter cycles all -> active -> failed -> blocked -> all", () => {
    expect(nextFilter("all")).toBe("active")
    expect(nextFilter("active")).toBe("failed")
    expect(nextFilter("failed")).toBe("blocked")
    expect(nextFilter("blocked")).toBe("all")
  })

  test("nextGroupBy cycles group -> status -> none -> group", () => {
    expect(nextGroupBy("group")).toBe("status")
    expect(nextGroupBy("status")).toBe("none")
    expect(nextGroupBy("none")).toBe("group")
  })
})

describe("state transitions", () => {
  const base = buildState([task({ id: "a", title: "A", group: "g", status: "running", progress: 10 })])

  test("setStatus patches only the status", () => {
    const next = setStatus(base, "a", "completed")
    expect(next.tasks.a.status).toBe("completed")
    expect(next.tasks.a.progress).toBe(10)
  })

  test("completeTask marks completed and full progress", () => {
    const next = completeTask(base, "a")
    expect(next.tasks.a.status).toBe("completed")
    expect(next.tasks.a.progress).toBe(100)
  })

  test("failTask records the error and preserves progress", () => {
    const next = failTask(base, "a", "boom")
    expect(next.tasks.a.status).toBe("failed")
    expect(next.tasks.a.error).toBe("boom")
    expect(next.tasks.a.progress).toBe(10)
  })

  test("cancelTask marks the task cancelled", () => {
    const next = cancelTask(base, "a")
    expect(next.tasks.a.status).toBe("cancelled")
  })

  test("applyStream appends to the stream and advances progress without exceeding 100", () => {
    const chunk = "line of output\n"
    const next = applyStream(base, "a", chunk)
    expect(next.tasks.a.stream).toBe("line of output\n")
    expect(next.tasks.a.progress).toBeGreaterThan(10)
    expect(next.tasks.a.progress).toBeLessThanOrEqual(100)
  })

  test("applyStream keeps the trailing slice bounded to 400 chars", () => {
    const big = "x".repeat(1000)
    const next = applyStream(base, "a", big)
    expect(next.tasks.a.stream.length).toBe(400)
    expect(next.tasks.a.stream).toBe("x".repeat(400))
  })

  test("applyStream is a no-op for an unknown task", () => {
    expect(applyStream(base, "ghost", "data")).toBe(base)
  })
})

describe("retry", () => {
  test("retryTask increments attempts and moves a failed task back to retrying", () => {
    const state = buildState([task({ id: "a", title: "A", group: "g", status: "failed", attempts: 1, error: "oops" })])
    const result = retryTask(state, "a")
    expect(result.rejected).toBe(false)
    expect(result.attempts).toBe(2)
    expect(result.state.tasks.a.attempts).toBe(2)
    expect(result.state.tasks.a.status).toBe("retrying")
    expect(result.state.tasks.a.error).toBeUndefined()
  })

  test("retryTask rejects once attempts reach the maximum and records the failure", () => {
    const state = buildState([
      task({ id: "a", title: "A", group: "g", status: "failed", attempts: 3, maxAttempts: 3 }),
    ])
    const result = retryTask(state, "a")
    expect(result.rejected).toBe(true)
    expect(result.attempts).toBe(3)
    expect(result.state.tasks.a.status).toBe("failed")
    expect(result.state.tasks.a.error).toBe("Max retries (3) reached")
  })

  test("retryTask is rejected for a missing task", () => {
    const state = buildState([])
    const result = retryTask(state, "ghost")
    expect(result.rejected).toBe(true)
    expect(result.attempts).toBe(0)
  })
})

describe("truncate", () => {
  test("leaves short strings untouched", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  test("truncates long strings with an ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hell…")
  })
})
