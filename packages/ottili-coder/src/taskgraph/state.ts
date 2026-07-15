import path from "path"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { TaskNode, TaskStatus } from "./event"

// Durable task graph record. Persisted to disk so a planned graph survives
// process / session boundaries; resume() reloads it and replays the pending
// nodes whose dependencies are satisfied.
const GraphSchema = Schema.Struct({
  graphID: Schema.String,
  sessionID: Schema.String,
  messageID: Schema.String,
  goal: Schema.String,
  status: Schema.Literals(["planning", "awaiting_approval", "running", "success", "partial", "failed", "cancelled"]),
  tasks: Schema.Array(TaskNode),
  startedAt: Schema.optional(Schema.Number),
  finishedAt: Schema.optional(Schema.Number),
  cancelled: Schema.Boolean,
  cancelReason: Schema.optional(Schema.String),
  resultPath: Schema.optional(Schema.String),
  outputPath: Schema.optional(Schema.String),
})
export type Graph = Schema.Schema.Type<typeof GraphSchema>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("TaskGraphState.NotFound", {
  graphID: Schema.String,
}) {}

export class AlreadyRunningError extends Schema.TaggedErrorClass<AlreadyRunningError>()(
  "TaskGraphState.AlreadyRunning",
  {
    graphID: Schema.String,
  },
) {}

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("TaskGraphState.Cancelled", {
  graphID: Schema.String,
  taskID: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
}) {}

export interface Interface {
  readonly write: (input: { sessionID: string; graph: Graph; slug?: string }) => Effect.Effect<{ path: string }>
  readonly read: (input: { graphID: string }) => Effect.Effect<Graph, NotFoundError>
  readonly path: (input: { graphID: string; slug?: string }) => Effect.Effect<string>
  readonly status: (input: { graphID: string }) => Effect.Effect<Graph, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/TaskGraphState") {}

// graphID is derived from session+message in this runtime; resolve via session.
const sessionOf = (graphID: string) => graphID.split(":")[0]

const graphPath = (sessionID: string, slug?: string) =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const info = yield* Session.Service
    const session = yield* info.get(sessionID)
    const created = session.time?.created ?? Date.now()
    const usedSlug = slug ?? session.slug ?? sessionID
    return Session.taskgraph({ slug: usedSlug, time: { created } }, instance)
  })

const readGraph = (file: string) =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(file).text(),
      catch: (cause) => cause,
    })
    return yield* Schema.decodeUnknown(GraphSchema)(JSON.parse(text)).pipe(
      Effect.mapError(() => new NotFoundError({ graphID: path.basename(file) })),
    )
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<Record<string, string>>(Effect.succeed({} as Record<string, string>))

    const resolvePath = (sessionID: string, slug?: string) =>
      Effect.gen(function* () {
        const cached = yield* InstanceState.use(state, (map) => map[sessionID])
        if (cached) return cached
        return yield* graphPath(sessionID, slug)
      })

    const persist = (sessionID: string, graph: Graph) =>
      Effect.gen(function* () {
        const target = yield* resolvePath(sessionID)
        yield* Effect.tryPromise({
          try: () => Bun.write(target, JSON.stringify(graph, null, 2)),
          catch: (cause) => cause,
        })
        yield* InstanceState.useEffect(
          state,
          (map) =>
            Effect.sync(() => {
              map[sessionID] = target
            }),
        )
      })

    return Service.of({
      path: ({ graphID, slug }) =>
        Effect.gen(function* () {
          return yield* resolvePath(sessionOf(graphID), slug)
        }),
      write: ({ sessionID, graph, slug }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionID, slug)
          yield* Effect.tryPromise({
            try: () => Bun.write(target, JSON.stringify(graph, null, 2)),
            catch: (cause) => cause,
          })
          yield* InstanceState.useEffect(
            state,
            (map) =>
              Effect.sync(() => {
                map[sessionID] = target
              }),
          )
          return { path: target }
        }),
      read: ({ graphID }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionOf(graphID))
          return yield* readGraph(target)
        }),
      status: ({ graphID }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionOf(graphID))
          return yield* readGraph(target)
        }),
    })
  }),
)

export * as TaskGraphState from "./state"
