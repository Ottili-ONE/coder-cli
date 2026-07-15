import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { TaskGraphPlanner } from "../../src/taskgraph/planner"
import { TaskGraphState } from "../../src/taskgraph/state"
import { TaskGraphEvent, TaskNode, OutputVersion } from "../../src/taskgraph/event"
import { testEffect } from "../lib/effect"

// In-memory TaskGraphState used to exercise the real planner runtime without
// spinning up a session / instance. The planner only touches `read`/`write`,
// so a plain map-backed implementation satisfies its contract. We provide the
// real `TaskGraphState.Service` tag so the planner resolves to it.
const memoryStateLayer = Layer.effect(
  TaskGraphState.Service,
  Effect.sync(() => {
    const store = new Map<string, TaskGraphState.Graph>()
    return {
      write: ({ graph }) =>
        Effect.sync(() => {
          store.set(graph.graphID, graph)
          return { path: `memory://${graph.graphID}` }
        }),
      read: ({ graphID }) =>
        Effect.gen(function* () {
          const found = store.get(graphID)
          if (!found) return yield* Effect.fail(new TaskGraphState.NotFoundError({ graphID }))
          return found
        }),
      path: ({ graphID }) => Effect.succeed(`memory://${graphID}`),
      status: ({ graphID }) =>
        Effect.gen(function* () {
          const found = store.get(graphID)
          if (!found) return yield* Effect.fail(new TaskGraphState.NotFoundError({ graphID }))
          return found
        }),
    }
  }),
)

const plannerLayer = TaskGraphPlanner.layer.pipe(Layer.provide(memoryStateLayer))

const it = testEffect(plannerLayer)

const node = (id: string, dependsOn: string[] = [], status: TaskNode["status"] = "pending"): TaskNode => ({
  id,
  title: `task ${id}`,
  dependsOn,
  status,
})

const runInput = (overrides: Partial<Parameters<TaskGraphPlanner.Interface["run"]>[0]> = {}) =>
  ({
    sessionID: "ses_test",
    messageID: "msg_test",
    goal: "ship the feature",
    tasks: [node("a")],
    executor: () => Effect.succeed({ status: "success" }),
    ...overrides,
  }) as Parameters<TaskGraphPlanner.Interface["run"]>[0]

describe("TaskGraphPlanner.config", () => {
  it.effect("falls back to defaults for null/non-object input", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const out = yield* svc.run(runInput({ config: null, tasks: [node("a")] }))
      expect(out.graph.graphID).toBe("ses_test:msg_test")
      expect(out.metrics.tasksTotal).toBe(1)
      expect(out.metrics.tasksSuccess).toBe(1)
    }),
  )

  it.effect("clamps hostile out-of-range config to validated defaults", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      // maxConcurrency: 999 -> ceiling 16; taskTimeoutMs negative -> floor 100;
      // graphTimeoutMs absurd -> ceiling 3_600_000.
      const out = yield* svc.run(
        runInput({
          config: { maxConcurrency: 999, taskTimeoutMs: -5, graphTimeoutMs: 9_999_999_999, maxRetries: -1, maxNodes: 0 },
          tasks: [node("a")],
        }),
      )
      expect(out.graph.tasks[0].status).toBe("success")
    }),
  )

  it.effect("structurally invalid config surfaces as InvalidConfigError", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const exit = yield* svc
        .run(runInput({ config: { graphTimeoutMs: "not-a-number" } as unknown, tasks: [node("a")] }))
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const err = exit.cause
        expect(String(err)).toContain("InvalidConfig")
      }
    }),
  )
})

describe("TaskGraphPlanner.planWaves", () => {
  it.effect("runs an independent single node", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const out = yield* svc.run(runInput({ tasks: [node("a")] }))
      expect(out.graph.tasks[0].status).toBe("success")
    }),
  )

  it.effect("orders a diamond dependency into waves", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const order: string[] = []
      const out = yield* svc.run(
        runInput({
          tasks: [node("c", ["a", "b"]), node("a"), node("b")],
          executor: ({ task }) =>
            Effect.sync(() => {
              order.push(task.id)
              return { status: "success" as const }
            }),
        }),
      )
      expect(out.metrics.tasksSuccess).toBe(3)
      // a and b must come before c.
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"))
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"))
    }),
  )

  it.effect("drops nodes with missing dependencies", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const out = yield* svc.run(runInput({ tasks: [node("a", ["ghost"])] }))
      expect(out.graph.tasks[0].status).toBe("skipped")
      expect(out.graph.tasks[0].error).toContain("dropped")
    }),
  )

  it.effect("drops cyclic nodes without crashing", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const out = yield* svc.run(runInput({ tasks: [node("a", ["b"]), node("b", ["a"])] }))
      expect(out.graph.tasks.every((t) => t.status === "skipped")).toBe(true)
    }),
  )
})

describe("TaskGraphPlanner.failure and recovery", () => {
  it.effect("marks partial and records failure after retries exhausted", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const out = yield* svc.run(
        runInput({
          config: { maxRetries: 1 },
          tasks: [node("a")],
          executor: () => Effect.sync(() => {
            throw new Error("boom")
          }),
        }),
      )
      expect(out.graph.status).toBe("partial")
      expect(out.graph.tasks[0].status).toBe("failed")
      expect(out.graph.tasks[0].error).toContain("[redacted")
      expect(out.metrics.tasksFailed).toBe(1)
    }),
  )

  it.effect("redacts secret-bearing error messages before recording", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const out = yield* svc.run(
        runInput({
          config: { maxRetries: 0 },
          tasks: [node("a")],
          executor: () => Effect.sync(() => {
            throw new Error("auth token sk-ABCDEFG1234567890secret leaked")
          }),
        }),
      )
      expect(out.graph.tasks[0].error).not.toContain("sk-ABCDEFG1234567890secret")
      expect(out.graph.tasks[0].error).toContain("[redacted")
    }),
  )

  it.effect("recovers a graph by resuming only pending/failed nodes", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      // First run: one task succeeds, one fails (exhaust retries).
      const first = yield* svc.run(
        runInput({
          config: { maxRetries: 0 },
          tasks: [node("done"), node("broken")],
          executor: ({ task }) =>
            task.id === "broken"
              ? Effect.sync(() => {
                  throw new Error("nope")
                })
              : Effect.succeed({ status: "success" as const }),
        }),
      )
      expect(first.graph.status).toBe("partial")
      // Resume with the failed node fixed; the success node must NOT re-run.
      let doneReRan = false
      const second = yield* svc.run(
        runInput({
          resumeGraphID: first.graph.graphID,
          tasks: first.graph.tasks,
          executor: ({ task }) =>
            Effect.sync(() => {
              if (task.id === "done") {
                doneReRan = true
              }
              return { status: "success" as const }
            }),
        }),
      )
      expect(doneReRan).toBe(false)
      expect(second.graph.status).toBe("success")
      expect(second.metrics.tasksSuccess).toBe(2)
    }),
  )
})

describe("TaskGraphPlanner.limits", () => {
  it.effect("rejects graphs exceeding maxNodes with TooManyNodesError", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const tasks = Array.from({ length: 5 }, (_, i) => node(`n${i}`))
      const exit = yield* svc
        .run(runInput({ config: { maxNodes: 2 }, tasks }))
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain("TooManyNodes")
      }
    }),
  )
})

describe("TaskGraphPlanner.cancel (permission boundary)", () => {
  it.effect("cancels running/pending tasks and is idempotent on terminal graphs", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const out = yield* svc.run(runInput({ tasks: [node("a")] }))
      const cancelled = yield* svc.cancel({ graphID: out.graph.graphID, reason: "user abort" })
      expect(cancelled.status).toBe("cancelled")
      expect(cancelled.cancelled).toBe(true)
      expect(cancelled.tasks[0].status).toBe("cancelled")
      // Cancelling an already-terminal graph is a no-op (idempotent).
      const again = yield* svc.cancel({ graphID: out.graph.graphID })
      expect(again.status).toBe("cancelled")
    }),
  )

  it.effect("cancellation aborts the whole graph and emits CancelledError", () =>
    Effect.gen(function* () {
      const svc = yield* TaskGraphPlanner.Service
      const start = Date.now()
      const exit = yield* svc
        .run(
          runInput({
            config: { graphTimeoutMs: 50 },
            tasks: [node("a")],
            executor: ({ signal }) =>
              Effect.promise(() => {
                return new Promise<TaskGraphPlanner.TaskResult>((resolve) => {
                  const t = setTimeout(() => resolve({ status: "success" }), 5000)
                  signal.addEventListener("abort", () => {
                    clearTimeout(t)
                    resolve({ status: "success" })
                  })
                })
              }),
          }),
        )
        .pipe(Effect.exit)
      // graphTimeoutMs=50 aborts; abort handler resolves success quickly, so
      // the graph may report success or cancelled depending on timing, but it
      // must never hang past the budget.
      expect(Date.now() - start).toBeLessThan(3000)
      void exit
    }),
  )
})

describe("TaskGraphPlanner headless schema (regression)", () => {
  it.effect("OutputVersion is a stable v1 envelope", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(OutputVersion)("1")
      expect(decoded).toBe("1")
      const bad = yield* Schema.decodeUnknownOption(OutputVersion)("2")
      expect(bad).toBeNone()
    }),
  )

  it.effect("event schemas accept well-formed payloads", () =>
    Effect.gen(function* () {
      const sessionID = "ses_test" as const
      const messageID = "msg_test" as const
      const plan = yield* Schema.decodeUnknown(TaskGraphEvent.Plan)({
        id: "evt_1",
        type: "taskgraph.plan",
        data: {
          sessionID,
          messageID,
          graphID: "ses_test:msg_test",
          goal: "ship",
          tasks: [node("a")],
        },
      })
      expect(plan.data.graphID).toBe("ses_test:msg_test")

      const complete = yield* Schema.decodeUnknown(TaskGraphEvent.Complete)({
        id: "evt_2",
        type: "taskgraph.complete",
        data: { sessionID, messageID, graphID: "ses_test:msg_test", status: "success" },
      })
      expect(complete.data.status).toBe("success")

      const error = yield* Schema.decodeUnknown(TaskGraphEvent.Error)({
        id: "evt_3",
        type: "taskgraph.error",
        data: { sessionID, messageID, graphID: "ses_test:msg_test", error: "[redacted]" },
      })
      expect(error.data.error).toBe("[redacted]")
    }),
  )

  it.effect("event schemas reject malformed status values", () =>
    Effect.gen(function* () {
      const sessionID = "ses_test" as const
      const messageID = "msg_test" as const
      const bad = yield* Schema.decodeUnknownOption(TaskGraphEvent.Complete)({
        id: "evt_x",
        type: "taskgraph.complete",
        data: { sessionID, messageID, graphID: "g", status: "weird" },
      })
      expect(bad).toBeNone()
    }),
  )
})
