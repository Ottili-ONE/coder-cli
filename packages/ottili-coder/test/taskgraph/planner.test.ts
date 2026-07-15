import { describe, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { PlannerConfig, DEFAULT_CONFIG, TaskGraphPlanner } from "@/taskgraph/planner"
import { Graph, TaskGraphState } from "@/taskgraph/state"
import type { TaskNode } from "@/taskgraph/event"
import { it } from "../lib/effect"

const sessionID = "session_test"
const messageID = "msg_test"

const node = (input: Partial<TaskNode> & Pick<TaskNode, "id">): TaskNode => ({
  id: input.id,
  title: input.title ?? `task ${input.id}`,
  dependsOn: input.dependsOn ?? [],
  status: input.status ?? "pending",
  attempts: input.attempts ?? 0,
})

// In-memory TaskGraphState so the planner can be exercised without a real
// session / filesystem instance. Tracks every write so tests can assert the
// durable record shape and regression-cover the headless output schema.
const makeMemoryState = () =>
  Effect.gen(function* () {
    const store = new Map<string, Graph>()
    const paths = new Map<string, string>()
    const writeCount = yield* Ref.make(0)

    const service = TaskGraphState.Service.of({
      write: ({ sessionID, graph }) =>
        Effect.gen(function* () {
          store.set(graph.graphID, graph)
          paths.set(graph.graphID, `/mem/${sessionID}/${graph.graphID}.json`)
          yield* Ref.update(writeCount, (n) => n + 1)
          return { path: paths.get(graph.graphID)! }
        }),
      read: ({ graphID }) =>
        Effect.gen(function* () {
          const found = store.get(graphID)
          if (!found) return yield* new TaskGraphState.NotFoundError({ graphID })
          return found
        }),
      path: ({ graphID }) => Effect.succeed(paths.get(graphID) ?? `/mem/${graphID}.json`),
      status: ({ graphID }) =>
        Effect.gen(function* () {
          const found = store.get(graphID)
          if (!found) return yield* new TaskGraphState.NotFoundError({ graphID })
          return found
        }),
    })

    return { service, store, writeCount }
  })

const testLayer = (memory: { service: TaskGraphState.Interface; store: Map<string, Graph>; writeCount: ReturnType<typeof Ref.make<number>> }) =>
  TaskGraphPlanner.layer.pipe(Layer.provide(Layer.succeed(TaskGraphState.Service, memory.service)))

// ── Pure config + planning logic ──────────────────────────────────────────────

describe("TaskGraphPlanner config", () => {
  it.effect("resolveConfig falls back to defaults on null input", () =>
    Effect.gen(function* () {
      const config = yield* TaskGraphPlanner.resolveConfig(null)
      expect(config).toEqual(DEFAULT_CONFIG)
    }),
  )

  it.effect("resolveConfig clamps out-of-range fields to the schema ceiling", () =>
    Effect.gen(function* () {
      const config = yield* TaskGraphPlanner.resolveConfig({
        maxConcurrency: 999,
        maxNodes: -5,
        graphTimeoutMs: 9_999_999,
      })
      expect(config.maxConcurrency).toBe(16)
      expect(config.maxNodes).toBe(1)
      expect(config.graphTimeoutMs).toBe(3_600_000)
    }),
  )

  it.effect("resolveConfig rejects structurally invalid values", () =>
    Effect.gen(function* () {
      const exit = yield* TaskGraphPlanner.resolveConfig({ maxConcurrency: "nope" }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )
})

// ── Successful end-to-end execution ───────────────────────────────────────────

describe("TaskGraphPlanner run — success", () => {
  it.effect("runs independent tasks and reports success with metrics", () =>
    Effect.gen(function* () {
      const memory = yield* makeMemoryState()
      const svc = yield* TaskGraphPlanner.Service

      const executed = new Set<string>()
      const executor = (input: { task: TaskNode }): Effect.Effect<{ status: "success" }> =>
        Effect.sync(() => {
          executed.add(input.task.id)
          return { status: "success" }
        })

      const { graph, metrics } = yield* svc.run({
        sessionID,
        messageID,
        goal: "demo",
        tasks: [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })],
        executor,
        config: { maxConcurrency: 2 },
      })

      expect(graph.status).toBe("success")
      expect(executed.size).toBe(3)
      expect(metrics.tasksTotal).toBe(3)
      expect(metrics.tasksSuccess).toBe(3)
      expect(metrics.tasksFailed).toBe(0)
      expect(metrics.peakConcurrency).toBe(1)
    }).pipe(Effect.provide(testLayer(yield* makeMemoryState().pipe(Effect.tap(() => Effect.void)).pipe(Effect.as(memory0()))))),
  )
})
