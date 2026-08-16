/** @jsxImportSource @opentui/solid */
import { createSignal, type Accessor } from "solid-js"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TaskQueue, type TaskQueueProps } from "../../../src/component/task-queue/index"
import { makeTask, STATUS_ICON, type Task } from "../../../src/component/task-queue/model"
import { TestTuiContexts } from "../../../test/fixture/tui-environment"

function accessor<T>(value: T): Accessor<T> {
  return () => value
}

function mk(over: Parameters<typeof makeTask>[0]): Task {
  return makeTask(over)
}

type Actions = NonNullable<TaskQueueProps["onAction"]> extends (a: infer A) => void ? A : never

async function renderQueue(width: number, props: TaskQueueProps) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TaskQueue {...props} />
      </TestTuiContexts>
    ),
    { width, height: 40 },
  )
  await app.renderOnce()
  return app
}

// --- Semantic render coverage (visible output, not implementation trivia) ---

describe("Task Queue (Test results) — visible output", () => {
  test("renders the header counts, grouped suites, status icons and footer", async () => {
    const tasks = [
      mk({ id: "a", title: "Run unit tests", group: "unit", status: "running", progress: 40 }),
      mk({ id: "b", title: "Build packages", group: "unit", status: "queued" }),
      mk({ id: "c", title: "Integration", group: "e2e", status: "failed", error: "exit 1" }),
    ]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      const frame = app.captureCharFrame()
      // Header aggregates the queue state.
      expect(frame).toContain("Task Queue — 3 tasks")
      expect(frame).toContain("2 active")
      expect(frame).toContain("1 failed")
      // Suite hierarchy is conveyed through group headers.
      expect(frame).toContain("▸ unit (2)")
      expect(frame).toContain("▸ e2e (1)")
      // Each status has a visible glyph.
      expect(frame).toContain(STATUS_ICON.running)
      expect(frame).toContain(STATUS_ICON.queued)
      expect(frame).toContain(STATUS_ICON.failed)
      // The footer documents every keybinding (regression coverage).
      expect(frame).toContain("↑/↓ navigate")
      expect(frame).toContain("f filter")
      expect(frame).toContain("g group")
      expect(frame).toContain("r retry")
      expect(frame).toContain("c cancel")
      expect(frame).toContain("⏎ focus")
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders the empty queue without rows or group headers", async () => {
    const app = await renderQueue(120, { tasks: accessor([]) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("Task Queue — 0 tasks")
      expect(frame).not.toContain("▸")
      expect(frame).not.toContain("> ")
    } finally {
      app.renderer.destroy()
    }
  })

  test("shows a streaming log line for running tasks", async () => {
    const tasks = [mk({ id: "a", title: "Compile", group: "build", status: "running", stream: "compiling sources" })]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("› compiling sources")
    } finally {
      app.renderer.destroy()
    }
  })

  test("shows an error line for a failed task", async () => {
    const tasks = [mk({ id: "a", title: "Flaky", group: "e2e", status: "failed", error: "timeout after 30s" })]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("⚠")
      expect(frame).toContain("timeout after 30s")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Keyboard navigation & focus regression coverage ---

describe("Task Queue — keyboard navigation", () => {
  test("arrow keys move the focus between rows", async () => {
    const tasks = [
      mk({ id: "a", title: "alpha", group: "g", status: "running", progress: 10 }),
      mk({ id: "b", title: "beta", group: "g", status: "queued" }),
    ]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      const initial = app.captureCharFrame()
      expect(initial).toContain("> ▶ alpha")
      expect(initial).not.toContain("> ▶ beta")

      app.mockInput.pressArrow("down")
      await app.flush()
      const afterDown = app.captureCharFrame()
      expect(afterDown).toContain("> • beta")
      expect(afterDown).not.toContain("> ▶ alpha")

      app.mockInput.pressArrow("up")
      await app.flush()
      const afterUp = app.captureCharFrame()
      expect(afterUp).toContain("> ▶ alpha")
      expect(afterUp).not.toContain("> ▶ beta")
    } finally {
      app.renderer.destroy()
    }
  })

  test("navigation clamps at the first and last row", async () => {
    const tasks = [
      mk({ id: "a", title: "alpha", group: "g", status: "queued" }),
      mk({ id: "b", title: "beta", group: "g", status: "queued" }),
    ]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      app.mockInput.pressArrow("up")
      await app.flush()
      expect(app.captureCharFrame()).toContain("> • alpha")

      app.mockInput.pressArrow("down")
      await app.flush()
      app.mockInput.pressArrow("down")
      await app.flush()
      expect(app.captureCharFrame()).toContain("> • beta")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- State transitions via keybindings ---

describe("Task Queue — actions and state transitions", () => {
  test("'f' cycles the filter and hides non-matching suites", async () => {
    const tasks = [
      mk({ id: "fail", title: "boomtask", group: "fails", status: "failed", error: "x" }),
      mk({ id: "run", title: "runtask", group: "works", status: "running", progress: 10 }),
    ]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      const base = app.captureCharFrame()
      expect(base).toContain("filter: all")
      expect(base).toContain("boomtask")
      expect(base).toContain("runtask")

      app.mockInput.pressKey("f")
      await app.flush()
      const active = app.captureCharFrame()
      expect(active).toContain("filter: active")
      expect(active).not.toContain("boomtask")
      expect(active).toContain("runtask")
      // Filtered-out selection falls back to the still-visible running task.
      expect(active).toContain("> ▶ runtask")
    } finally {
      app.renderer.destroy()
    }
  })

  test("'g' cycles grouping between group, status and none", async () => {
    const tasks = [
      mk({ id: "a", title: "alpha", group: "unit", status: "running", progress: 10 }),
      mk({ id: "b", title: "beta", group: "e2e", status: "queued" }),
    ]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      const grouped = app.captureCharFrame()
      expect(grouped).toContain("group: group")
      expect(grouped).toContain("▸ unit (1)")

      app.mockInput.pressKey("g")
      await app.flush()
      const byStatus = app.captureCharFrame()
      expect(byStatus).toContain("group: status")
      expect(byStatus).toContain("▸ running (1)")
      expect(byStatus).toContain("▸ queued (1)")

      app.mockInput.pressKey("g")
      await app.flush()
      const off = app.captureCharFrame()
      expect(off).toContain("group: none")
      expect(off).toContain("▸ Tasks (2)")
    } finally {
      app.renderer.destroy()
    }
  })

  test("'r' emits a retry action with the next attempt number", async () => {
    let action: Actions | undefined
    const tasks = [mk({ id: "a", title: "flake", group: "e2e", status: "failed", error: "x", attempts: 0 })]
    const app = await renderQueue(120, { tasks: accessor(tasks), onAction: (a) => (action = a) })
    try {
      app.mockInput.pressKey("r")
      await app.flush()
      expect(action).toEqual({ type: "retry", id: "a", rejected: false, attempts: 1 })
    } finally {
      app.renderer.destroy()
    }
  })

  test("'c' emits a cancel action for the focused task", async () => {
    let action: Actions | undefined
    const tasks = [mk({ id: "a", title: "compile", group: "build", status: "running", progress: 20 })]
    const app = await renderQueue(120, { tasks: accessor(tasks), onAction: (a) => (action = a) })
    try {
      app.mockInput.pressKey("c")
      await app.flush()
      expect(action).toEqual({ type: "cancel", id: "a" })
    } finally {
      app.renderer.destroy()
    }
  })

  test("enter emits a select action for the focused task", async () => {
    let action: Actions | undefined
    const tasks = [mk({ id: "a", title: "compile", group: "build", status: "queued" })]
    const app = await renderQueue(120, { tasks: accessor(tasks), onAction: (a) => (action = a) })
    try {
      app.mockInput.pressEnter()
      await app.flush()
      expect(action).toEqual({ type: "select", id: "a" })
    } finally {
      app.renderer.destroy()
    }
  })

  test("failure path: retry is rejected once attempts are exhausted", async () => {
    let action: Actions | undefined
    const tasks = [
      mk({ id: "a", title: "flake", group: "e2e", status: "failed", error: "Max retries (3) reached", attempts: 3, maxAttempts: 3 }),
    ]
    const app = await renderQueue(120, { tasks: accessor(tasks), onAction: (a) => (action = a) })
    try {
      const frame = app.captureCharFrame()
      // The exhausted failure is surfaced visually.
      expect(frame).toContain("⚠")
      expect(frame).toContain("Max retries (3) reached")

      app.mockInput.pressKey("r")
      await app.flush()
      expect(action).toEqual({ type: "retry", id: "a", rejected: true, attempts: 3 })
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Streaming updates (no timing sleeps) ---

describe("Task Queue — streaming updates", () => {
  test("re-rendering with new stream output shows the latest log line", async () => {
    const [tasks, setTasks] = createSignal<Task[]>([
      mk({ id: "a", title: "Compile", group: "build", status: "running", stream: "compiling sources" }),
    ])
    const app = await renderQueue(120, { tasks })
    try {
      expect(app.captureCharFrame()).toContain("› compiling sources")

      setTasks([mk({ id: "a", title: "Compile", group: "build", status: "running", stream: "compiling sources\nlinking objects" })])
      await app.flush()
      const updated = app.captureCharFrame()
      expect(updated).toContain("› linking objects")
      expect(updated).not.toContain("› compiling sources")
    } finally {
      app.renderer.destroy()
    }
  })
})

// --- Terminal dimensions: narrow vs standard ---

describe("Task Queue — terminal dimensions", () => {
  test("standard width shows the progress bar", async () => {
    const tasks = [mk({ id: "a", title: "Compile", group: "build", status: "running", progress: 40 })]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("[")
      expect(frame).toContain("40%")
    } finally {
      app.renderer.destroy()
    }
  })

  test("narrow width collapses to a compact percentage", async () => {
    const tasks = [mk({ id: "a", title: "Compile", group: "build", status: "running", progress: 40 })]
    const app = await renderQueue(40, { tasks: accessor(tasks) })
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("40%")
      expect(frame).not.toContain("[")
    } finally {
      app.renderer.destroy()
    }
  })

  test("resize from standard to narrow switches the progress layout", async () => {
    const tasks = [mk({ id: "a", title: "Compile", group: "build", status: "running", progress: 40 })]
    const app = await renderQueue(120, { tasks: accessor(tasks) })
    try {
      expect(app.captureCharFrame()).toContain("[")

      app.resize(40, 40)
      await app.flush()
      const resized = app.captureCharFrame()
      expect(resized).toContain("40%")
      expect(resized).not.toContain("[")
    } finally {
      app.renderer.destroy()
    }
  })
})
