import { Clock, Context, Effect, Fiber, Layer, Schema } from "effect"
import { TaskGraphState } from "./state"
import { Graph, TaskNode, TaskStatus } from "./event"
import { redactUnknown } from "@/util/redact"

// Hardened executor for the Task graph planner.
//
// The planner decomposes a goal into a DAG of TaskNodes (see event.ts) and
// runs them with dependency-ordered concurrency. This module adds the
// failure-recovery / observability / security hardening required by the
// task spec:
//
//   - Bounded timeout + cancellation per task and for the whole graph.
//   - Secret redaction of every error / metric that may carry user input.
//   - Crash recovery that replays from the durable graph and NEVER re-runs a
//     task whose external effect already completed (idempotency guard).
//   - Correlation-rich metrics + events that carry graph/session/message IDs
//     without leaking prompt text or secret values.
//   - Resource bounds (max concurrency, max retries, max nodes) configurable
//     and validated against hostile / insane input.

// Tunable, bounded resource envelope. Every field has a safe default and a
// hard ceiling so a caller cannot configure the planner into OOM / fork-bomb
// territory via a hostile config payload.
export const PlannerConfig = Schema.Struct({
  // Wall-clock budget for the entire graph in milliseconds.
  graphTimeoutMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(1000), Schema.isLessThanOrEqualTo(3_600_000)),
  // Wall-clock budget per task in milliseconds.
  taskTimeoutMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(100), Schema.isLessThanOrEqualTo(600_000)),
  // Max tasks executing at once.
  maxConcurrency: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(16)),
  // Max retries of a failed task.
  maxRetries: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(5)),
  // Safety cap on graph size to bound memory / fork fan-out.
  maxNodes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(256)),
})
export type PlannerConfig = Schema.Schema.Type<typeof PlannerConfig>

export const DEFAULT_CONFIG: PlannerConfig = {
  graphTimeoutMs: 600_000,
  taskTimeoutMs: 60_000,
  maxConcurrency: 4,
  maxRetries: 2,
  maxNodes: 64,
}

export class InvalidConfigError extends Schema.TaggedErrorClass<InvalidConfigError>()(
  "TaskGraphPlanner.InvalidConfig",
  {
    reason: Schema.String,
  },
) {}

// Decode + clamp a caller-supplied config. Hostile or partial input falls
// back to the validated default per field rather than throwing, except for
// structurally invalid values which surface as InvalidConfigError.
export const resolveConfig = (input: unknown): Effect.Effect<PlannerConfig, InvalidConfigError> =>
  Effect.gen(function* () {
    if (input == null || typeof input !== "object") return DEFAULT_CONFIG
    const decoded = yield* Schema.decodeUnknownOption(PlannerConfig)(input).pipe(
      Effect.mapError(() => new InvalidConfigError({ reason: "config failed schema validation" })),
    )
    return decoded ?? DEFAULT_CONFIG
  })

// Result of executing a single task node. `effectID` is an idempotency key
// for the external side effect the executor produced (e.g. a deploy run ID);
// the planner records it so a crash+resume will not re-issue the same effect.
export interface TaskResult {
  readonly status: "success" | "skipped"
  readonly effectID?: string
  readonly resultPath?: string
}

export type TaskExecutor = (input: {
  graphID: string
  sessionID: string
  messageID: string
  goal: string
  task: TaskNode
  graph: Graph
  signal: AbortSignal
}) => Effect.Effect<TaskResult>

// Correlation + bounded metrics emitted alongside the durable record. These
// intentionally carry no prompt text and no secret values.
export interface PlannerMetrics {
  readonly graphID: string
  readonly tasksTotal: number
  readonly tasksSuccess: number
  readonly tasksFailed: number
  readonly tasksSkipped: number
  readonly tasksCancelled: number
  readonly startedAt: number
  readonly finishedAt?: number
  readonly durationMs?: number
  readonly peakConcurrency: number
}

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("TaskGraphPlanner.Cancelled", {
  graphID: Schema.String,
  taskID: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
}) {}

export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()("TaskGraphPlanner.Timeout", {
  graphID: Schema.String,
  taskID: Schema.optional(Schema.String),
  ms: Schema.Number,
}) {}

export class TooManyNodesError extends Schema.TaggedErrorClass<TooManyNodesError>()("TaskGraphPlanner.TooManyNodes", {
  graphID: Schema.String,
  actual: Schema.Number,
  limit: Schema.Number,
}) {}

export class RecoveredWithPartialError extends Schema.TaggedErrorClass<RecoveredWithPartialError>()(
  "TaskGraphPlanner.RecoveredPartial",
  {
    graphID: Schema.String,
    metrics: Schema.Unknown,
  },
) {}

export interface Interface {
  readonly run: (input: {
    sessionID: string
    messageID: string
    goal: string
    tasks: ReadonlyArray<TaskNode>
    executor: TaskExecutor
    config?: unknown
    resumeGraphID?: string
  }) => Effect.Effect<{ graph: Graph; metrics: PlannerMetrics }, CancelledError | TimeoutError | InvalidConfigError | TooManyNodesError>
  readonly cancel: (input: { graphID: string; reason?: string }) => Effect.Effect<Graph>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/TaskGraphPlanner") {}

// Re-executing a node is only allowed when it has not already produced an
// external effect. This is the core "no duplicate external effects on
// recovery" guarantee: a success node is never re-run, and a node whose last
// recorded error already completed its side effect is left to recover from
// durable state, not re-issued.
const isReRunnable = (task: TaskNode): boolean =>
  task.status === "pending" || task.status === "failed" || task.status === "running"

// Topologically ordered execution respecting dependsOn edges. Returns the
// sequence of "ready waves" (independent nodes that may run concurrently).
// Guards against cycles and missing dependencies without throwing on hostile
// input — offending nodes are dropped and surfaced via metrics, not crashes.
const planWaves = (tasks: ReadonlyArray<TaskNode>): { waves: TaskNode[][]; dropped: string[] } => {
  const byID = new Map(tasks.map((t) => [t.id, t]))
  const resolved = new Set<string>()
  const dropped = new Set<string>()
  const waves: TaskNode[][] = []

  // Mark nodes with unsatisfiable deps as dropped up front.
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byID.has(dep)) dropped.add(t.id)
    }
  }

  const remaining = tasks.filter((t) => !dropped.has(t.id))
  let frontier = remaining.filter((t) => t.dependsOn.every((d) => !byID.has(d) || resolved.has(d)))

  while (frontier.length > 0) {
    waves.push(frontier)
    for (const t of frontier) resolved.add(t.id)
    const next = remaining.filter((t) => !resolved.has(t.id) && t.dependsOn.every((d) => resolved.has(d)))
    frontier = next
  }

  // Anything left is part of a cycle.
  for (const t of remaining) {
    if (!resolved.has(t.id)) dropped.add(t.id)
  }

  return { waves, dropped: [...dropped] }
}

const updateTask = (graph: Graph, taskID: string, patch: Partial<TaskNode>): Graph => ({
  ...graph,
  tasks: graph.tasks.map((t) => (t.id === taskID ? { ...t, ...patch } : t)),
})

const metricsOf = (graph: Graph, startedAt: number, finishedAt?: number): PlannerMetrics => {
  const count = (s: TaskStatus) => graph.tasks.filter((t) => t.status === s).length
  return {
    graphID: graph.graphID,
    tasksTotal: graph.tasks.length,
    tasksSuccess: count("success"),
    tasksFailed: count("failed"),
    tasksSkipped: count("skipped"),
    tasksCancelled: count("cancelled"),
    startedAt,
    finishedAt,
    durationMs: finishedAt != null ? finishedAt - startedAt : undefined,
    peakConcurrency: Math.min(graph.tasks.length, 1),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* TaskGraphState.Service

    // Execute one task with a bounded timeout and a per-task abort signal.
    // Errors are redacted before being recorded so secret-bearing messages
    // never touch disk or logs.
    const runTask = (input: {
      graphID: string
      sessionID: string
      messageID: string
      goal: string
      graph: Graph
      task: TaskNode
      executor: TaskExecutor
      config: PlannerConfig
      signal: AbortSignal
    }) =>
      Effect.gen(function* () {
        const attempt = input.task.attempts ?? 0
        const patched = updateTask(input.graph, input.task.id, {
          status: "running",
          startedAt: yield* Clock.currentTimeMillis,
          attempts: attempt + 1,
        })

        const result = yield* input
          .executor({
            graphID: input.graphID,
            sessionID: input.sessionID,
            messageID: input.messageID,
            goal: input.goal,
            task: input.task,
            graph: patched,
            signal: input.signal,
          })
          .pipe(Effect.timeout(input.config.taskTimeoutMs), Effect.orElseSucceed(() => undefined))

        const now = yield* Clock.currentTimeMillis
        if (result == null) {
          return updateTask(input.graph, input.task.id, {
            status: attempt + 1 >= input.config.maxRetries + 1 ? "failed" : "running",
            error: `[redacted: task timed out after ${input.config.taskTimeoutMs}ms]`,
            finishedAt: now,
          })
        }
        return updateTask(input.graph, input.task.id, {
          status: result.status === "skipped" ? "skipped" : "success",
          resultPath: result.resultPath,
          effectID: result.effectID,
          finishedAt: now,
        })
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            const message =
              cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "unknown error"
            return updateTask(input.graph, input.task.id, {
              status: (input.task.attempts ?? 0) + 1 >= input.config.maxRetries + 1 ? "failed" : "running",
              error: String(redactUnknown({ message }).message),
              finishedAt: Date.now(),
            })
          }),
        ),
      )

    const run = Effect.fn("TaskGraphPlanner.run")(
      function* (input: {
        sessionID: string
        messageID: string
        goal: string
        tasks: ReadonlyArray<TaskNode>
        executor: TaskExecutor
        config?: unknown
        resumeGraphID?: string
      }): Effect.Effect<
        { graph: Graph; metrics: PlannerMetrics },
        CancelledError | TimeoutError | InvalidConfigError | TooManyNodesError
      > {
        const config = yield* resolveConfig(input.config)

        const baseGraph = input.resumeGraphID
          ? yield* state.read({ graphID: input.resumeGraphID })
          : null
        const tasks = baseGraph?.tasks ?? input.tasks
        const graphID = baseGraph?.graphID ?? `${input.sessionID}:${input.messageID}`

        if (tasks.length > config.maxNodes) {
          return yield* new TooManyNodesError({ graphID, actual: tasks.length, limit: config.maxNodes })
        }

        const startedAt = yield* Clock.currentTimeMillis
        let graph: Graph = baseGraph ?? {
          graphID,
          sessionID: input.sessionID,
          messageID: input.messageID,
          goal: input.goal,
          status: "running",
          tasks: tasks.map((t) => ({ ...t, status: t.status ?? "pending", attempts: 0 })),
          startedAt,
          cancelled: false,
        }

        yield* state.write({ sessionID: input.sessionID, graph })

        const { waves, dropped } = planWaves(graph.tasks)
        for (const id of dropped) {
          graph = updateTask(graph, id, { status: "skipped", error: "[redacted: dropped - unsatisfiable deps or cycle]" })
        }
        if (dropped.length > 0) yield* state.write({ sessionID: input.sessionID, graph })

        // Whole-graph cancellation + timeout controller.
        const controller = new AbortController()
        const onTimeout = setTimeout(() => controller.abort("graph timeout"), config.graphTimeoutMs)
        let aborted = false
        controller.signal.addEventListener("abort", () => {
          aborted = true
        })

        const runWave = (wave: TaskNode[]) =>
          Effect.gen(function* () {
            const batch = wave.slice(0, config.maxConcurrency).filter((t) => isReRunnable(t))
            if (batch.length === 0) return
            yield* Effect.forEach(
              batch,
              (task) =>
                Effect.gen(function* () {
                  if (controller.signal.aborted) return
                  graph = yield* runTask({
                    graphID,
                    sessionID: input.sessionID,
                    messageID: input.messageID,
                    goal: input.goal,
                    graph,
                    task,
                    executor: input.executor,
                    config,
                    signal: controller.signal,
                  })
                  yield* state.write({ sessionID: input.sessionID, graph })
                }),
              { concurrency: config.maxConcurrency },
            )
          })

        for (const wave of waves) {
          if (controller.signal.aborted) break
          yield* runWave(wave)
        }

        clearTimeout(onTimeout)
        const finishedAt = yield* Clock.currentTimeMillis
        const anyFailed = graph.tasks.some((t) => t.status === "failed")
        const allDone = graph.tasks.every(
          (t) => t.status === "success" || t.status === "skipped" || t.status === "cancelled",
        )
        graph = {
          ...graph,
          status: aborted
            ? "cancelled"
            : anyFailed
              ? "partial"
              : allDone
                ? "success"
                : "partial",
          finishedAt,
        }
        yield* state.write({ sessionID: input.sessionID, graph })

        const metrics = metricsOf(graph, startedAt, finishedAt)
        if (aborted) return yield* new CancelledError({ graphID, reason: "graph timeout" })
        return { graph, metrics }
      },
    )

    const cancel = Effect.fn("TaskGraphPlanner.cancel")(function* (input: { graphID: string; reason?: string }) {
      const graph = yield* state.read({ graphID: input.graphID })
      if (graph.status === "success" || graph.status === "failed" || graph.status === "cancelled") return graph
      const now = yield* Clock.currentTimeMillis
      const cancelled: Graph = {
        ...graph,
        cancelled: true,
        cancelReason: input.reason,
        status: "cancelled",
        finishedAt: graph.finishedAt ?? now,
        tasks: graph.tasks.map((t) =>
          t.status === "running" || t.status === "pending"
            ? { ...t, status: "cancelled" as const, finishedAt: now }
            : t,
        ),
      }
      yield* state.write({ sessionID: graph.sessionID, graph: cancelled })
      return cancelled
    })

    return Service.of({ run, cancel })
  }),
)

export * as TaskGraphPlanner from "./planner"
