import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"

const PlanSchema = Schema.Struct({
  goal: Schema.String,
  goals: Schema.optional(Schema.Array(Schema.String)),
  assumptions: Schema.Array(Schema.String),
  tasks: Schema.Array(Schema.String),
  risks: Schema.Array(Schema.String),
  tests: Schema.Array(Schema.String),
  estimate: Schema.Struct({
    costUSD: Schema.optional(Schema.Number),
    sessions: Schema.optional(Schema.Number),
    durationMinutes: Schema.optional(Schema.Number),
  }),
  questions: Schema.optional(Schema.Array(Schema.String)),
})
export type Plan = Schema.Schema.Type<typeof PlanSchema>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PlanState.NotFound", {
  sessionID: Schema.String,
}) {}

export interface Interface {
  readonly write: (input: {
    sessionID: string
    plan: Plan
    slug?: string
  }) => Effect.Effect<{ path: string }>
  readonly read: (input: { sessionID: string }) => Effect.Effect<Plan, NotFoundError>
  readonly path: (input: { sessionID: string; slug?: string }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/PlanState") {}

const readPlan = (file: string) =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(file).text(),
      catch: (cause) => cause,
    })
    return yield* Schema.decodeUnknown(PlanSchema)(JSON.parse(text)).pipe(
      Effect.mapError(() => new NotFoundError({ sessionID: "unknown" })),
    )
  })

const planPath = (sessionID: string, slug?: string) =>
  Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const info = yield* Session.Service
    const session = yield* info.get(sessionID)
    const created = session.time?.created ?? Date.now()
    const usedSlug = slug ?? session.slug ?? sessionID
    return Session.plan({ slug: usedSlug, time: { created } }, instance)
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<Record<string, string>>(
      Effect.succeed({} as Record<string, string>),
    )

    const resolvePath = (sessionID: string, slug?: string) =>
      Effect.gen(function* () {
        const cached = yield* InstanceState.use(state, (map) => map[sessionID])
        if (cached) return cached
        return yield* planPath(sessionID, slug)
      })

    return Service.of({
      path: ({ sessionID, slug }) => resolvePath(sessionID, slug),
      write: ({ sessionID, plan, slug }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionID, slug)
          yield* Effect.tryPromise({
            try: () => Bun.write(target, JSON.stringify(plan, null, 2)),
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
      read: ({ sessionID }) =>
        Effect.gen(function* () {
          const target = yield* resolvePath(sessionID)
          return yield* readPlan(target)
        }),
    })
  }),
)

export * as PlanState from "./state"
